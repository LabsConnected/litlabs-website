/**
 * useElementEdits — CAS-pinned writes + project-switch isolation.
 *
 * Every file write must carry expectedSha256 = sha256 of the exact bytes
 * the patch was computed from; a 409 REVISION_CONFLICT must surface as an
 * honest "conflict" state (never a silent overwrite), and switching
 * projects must drop cache/selection/history so nothing bleeds across.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useElementEdits } from "./useElementEdits";
import { sha256HexUtf8 } from "../lib/element-edits";

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: async () => "test-token" }),
}));

const DOC = `<!DOCTYPE html>
<html><body><h1 id="t">Hello</h1><p>para</p></body></html>`;

const SELECTION = { selector: "#t", tagName: "h1", attrs: { id: "t" } };

interface FetchCall { url: string; method: string; body?: Record<string, unknown> }

function mockFetch(handlers: {
  list?: unknown;
  read?: string | null;
  writeStatus?: number;
  onWrite?: (body: Record<string, unknown>) => void;
}) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

    if (method === "GET" && url.includes("/files")) {
      return json(handlers.list ?? { entries: [{ name: "index.html", type: "file" }] });
    }
    if (body?.action === "read") {
      return json({ content: handlers.read ?? DOC });
    }
    if (body?.action === "write") {
      handlers.onWrite?.(body);
      if ((handlers.writeStatus ?? 200) === 409) {
        return json({ error: "Revision conflict", code: "REVISION_CONFLICT" }, 409);
      }
      return json({ saved: true });
    }
    return json({ error: "unexpected" }, 500);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

describe("useElementEdits CAS writes", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.localStorage?.clear?.();
  });

  it("pins writes with expectedSha256 of the patched-from bytes", async () => {
    const writes: Record<string, unknown>[] = [];
    mockFetch({ onWrite: (b) => writes.push(b) });
    const { result } = renderHook(() => useElementEdits("p1"));

    await act(async () => { await result.current.resolve(SELECTION, "/"); });
    expect(result.current.status).toBe("ready");

    let ok = false;
    await act(async () => { ok = await result.current.applyPatch({ text: "Changed" }); });
    expect(ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].expectedSha256).toBe(await sha256HexUtf8(DOC));
    expect(String(writes[0].content)).toContain("Changed");
  });

  it("surfaces a 409 as conflict and drops the stale cache", async () => {
    mockFetch({ writeStatus: 409 });
    const { result } = renderHook(() => useElementEdits("p1"));

    await act(async () => { await result.current.resolve(SELECTION, "/"); });
    let ok = true;
    await act(async () => { ok = await result.current.applyPatch({ text: "Changed" }); });
    expect(ok).toBe(false);
    expect(result.current.status).toBe("conflict");
    expect(result.current.statusReason).toMatch(/changed on disk/i);

    // Cache was invalidated — a further patch cannot write stale bytes.
    let again = true;
    await act(async () => { again = await result.current.applyPatch({ text: "Again" }); });
    expect(again).toBe(false);
  });

  it("resets cache, selection and history when projectId changes", async () => {
    mockFetch({});
    const { result, rerender } = renderHook(
      ({ pid }) => useElementEdits(pid),
      { initialProps: { pid: "p1" as string | null } },
    );

    await act(async () => { await result.current.resolve(SELECTION, "/"); });
    await act(async () => { await result.current.applyPatch({ text: "Changed" }); });
    expect(result.current.history.length).toBe(1);
    expect(result.current.canUndo).toBe(true);

    rerender({ pid: "p2" });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.history).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.filePath).toBeNull();
  });
});
