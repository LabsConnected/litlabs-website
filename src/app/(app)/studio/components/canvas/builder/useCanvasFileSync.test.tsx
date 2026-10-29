import { renderHook, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useCanvasFileSync } from "./useCanvasFileSync";
import { useCanvasBuilderStore } from "./store";
import { createEmptyDocument } from "./types";
import type { CanvasDocument } from "./types";

const PROJECT_ID = "11111111-2222-3333-4444-555555555555";

function makeDoc(marker: string): CanvasDocument {
  const doc = createEmptyDocument();
  return { ...doc, route: marker, updatedAt: Date.now() };
}

function writesTo(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .map((c) => ({ url: c[0] as string, init: (c[1] ?? {}) as RequestInit }))
    .filter((c) => (c.init.body as string)?.includes('"write"'));
}

/** Let the hook's mount-time load + any initial-doc write settle, then clear the mock. */
async function settleMount(fetchMock: ReturnType<typeof vi.fn>) {
  await act(async () => { await vi.runAllTimersAsync(); });
  fetchMock.mockClear();
}

describe("useCanvasFileSync", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    useCanvasBuilderStore.setState({ document: createEmptyDocument(), saveState: "local" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("writes after the debounce interval", async () => {
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await settleMount(fetchMock);
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("debounced") });
    });
    await act(async () => { await vi.runAllTimersAsync(); });
    const writes = writesTo(fetchMock);
    expect(writes.length).toBe(1);
    expect(writes[0].url).toBe(`/api/studio-projects/${PROJECT_ID}/files`);
    expect(writes[0].init.body).toContain(".litt/canvas.json");
    unmount();
  });

  it("flushes a pending debounced write on unmount with keepalive", async () => {
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await settleMount(fetchMock);
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("pending") });
    });
    // Unmount BEFORE the 1200ms debounce elapses — previously the write was lost.
    unmount();
    const writes = writesTo(fetchMock);
    expect(writes.length).toBe(1);
    // SPA unmount uses a normal request (page still alive); keepalive is
    // reserved for the unload path where the browser requires it.
    expect(writes[0].init.keepalive).toBeUndefined();
    expect(writes[0].init.body).toContain("pending");
  });

  it("retries on content change after a failed write", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await settleMount(fetchMock);
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("retry-me") });
    });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(writesTo(fetchMock).length).toBe(1);
    expect(useCanvasBuilderStore.getState().saveState).toBe("error");
    // A new edit retries even though the previous attempt failed.
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("retry-me-edited") });
    });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(writesTo(fetchMock).length).toBe(2);
    unmount();
  });

  it("flushes unsaved content on unmount after a failed write", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await settleMount(fetchMock);
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("failed-content") });
    });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(writesTo(fetchMock).length).toBe(1);
    // Unmount after the failed write — the flush must retry it so a
    // navigation doesn't lose the edit.
    unmount();
    const writes = writesTo(fetchMock);
    expect(writes.length).toBe(2);
    expect(writes[1].init.body).toContain("failed-content");
  });

  it("flushes on pagehide (full reload path) without unmounting", async () => {
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await settleMount(fetchMock);
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("reload-edit") });
    });
    // Full-page reload never runs React cleanups — only the pagehide event.
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    const writes = writesTo(fetchMock);
    expect(writes.length).toBe(1);
    expect(writes[0].init.keepalive).toBe(true);
    expect(writes[0].init.body).toContain("reload-edit");
    unmount();
  });

  it("server-wins: a saved canvas replaces a newer local document", async () => {
    // Regression (Greptile 4374230813): a freshly initialized empty doc has
    // a newer updatedAt, so the old timestamp comparison let it overwrite
    // real saved work.
    const savedDoc = { ...makeDoc("server-canvas"), updatedAt: 1 };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ content: JSON.stringify(savedDoc) }),
    });
    const local = { ...makeDoc("fresh-local"), updatedAt: Date.now() };
    useCanvasBuilderStore.setState({ document: local });

    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(useCanvasBuilderStore.getState().document.route).toBe("server-canvas");
    // And the adopted document must not be written straight back.
    expect(writesTo(fetchMock).length).toBe(0);
    unmount();
  });

  it("blocks saves until the project's canvas read has settled", async () => {
    // Regression (Greptile 4374230809): a save timer could fire before the
    // load completed and overwrite the saved canvas.
    let resolveRead!: (v: unknown) => void;
    fetchMock.mockImplementation(
      () => new Promise((res) => { resolveRead = res; }),
    );
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));

    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("early-edit") });
      await vi.runAllTimersAsync();
    });
    expect(writesTo(fetchMock).length).toBe(0);

    await act(async () => {
      resolveRead({ ok: false, json: async () => ({}) });
      await vi.runAllTimersAsync();
    });
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("after-load") });
      await vi.runAllTimersAsync();
    });
    expect(writesTo(fetchMock).length).toBe(1);
    unmount();
  });

  it("re-loads on project switch and never leaks the prior canvas", async () => {
    // Regression (Greptile 4374230803): hasLoadedRef was global, so project
    // B never loaded its own canvas and edits wrote A's document into B.
    const PROJECT_B = "99999999-8888-7777-6666-555555555555";
    const docA = makeDoc("project-a-canvas");
    const docB = makeDoc("project-b-canvas");
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (body.action === "read") return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    });

    const { rerender, unmount } = renderHook(
      (id: string) => useCanvasFileSync(id),
      { initialProps: PROJECT_ID },
    );
    await settleMount(fetchMock);
    await act(async () => {
      useCanvasBuilderStore.setState({ document: docA });
      await vi.runAllTimersAsync();
    });
    fetchMock.mockClear();

    // Switch to B mid-flight — B must issue its own read and adopt its doc.
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (body.action === "read") {
        return { ok: true, json: async () => ({ content: JSON.stringify(docB) }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    rerender(PROJECT_B);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(useCanvasBuilderStore.getState().document.route).toBe("project-b-canvas");

    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("b-edit") });
      await vi.runAllTimersAsync();
    });
    const writes = writesTo(fetchMock);
    expect(writes.length).toBe(1);
    expect(writes[0].url).toBe(`/api/studio-projects/${PROJECT_B}/files`);
    expect(writes[0].init.body).not.toContain("project-a-canvas");
    unmount();
  });

  it("does not double-write on rapid navigation (unmount then remount)", async () => {
    const first = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await settleMount(fetchMock);
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("nav-edit") });
    });
    // Rapid navigation: unmount flushes the pending debounce once.
    first.unmount();
    expect(writesTo(fetchMock).length).toBe(1);
    // Remount: server-wins load returns the just-saved content; the same
    // store document must not trigger a redundant second write.
    const flushed = writesTo(fetchMock)[0].init.body as string;
    const content = JSON.parse(JSON.parse(flushed).content as string);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: JSON.stringify(content) }) });
    const second = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(writesTo(fetchMock).length).toBe(1);
    second.unmount();
  });
});
