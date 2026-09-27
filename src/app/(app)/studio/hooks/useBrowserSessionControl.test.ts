/**
 * useBrowserSessionControl — the session-scoped takeover contract:
 * server-persisted ownership, actions POST + re-poll (no optimistic
 * flips), and truthful error surfacing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useBrowserSessionControl } from "./useBrowserSessionControl";

const SESSION = (controller: string, status = "active") => ({
  session: {
    status,
    controller,
    liveViewUrl: "https://live.example/session",
    metadata: { liveEmbedUrl: "https://embed.example/session" },
  },
});

describe("useBrowserSessionControl", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchSequence(responses: { status?: number; json: unknown }[]) {
    const fn = vi.fn();
    for (const r of responses) {
      fn.mockResolvedValueOnce({
        ok: (r.status ?? 200) < 400,
        status: r.status ?? 200,
        json: async () => r.json,
      } as Response);
    }
    // Polling tail: keep serving the last response.
    const last = responses[responses.length - 1];
    fn.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => last.json,
    } as Response);
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("reads the server-side controller (ownership survives remount)", async () => {
    mockFetchSequence([{ json: SESSION("human") }]);
    const { result } = renderHook(() => useBrowserSessionControl("sess-1"));
    await waitFor(() => expect(result.current.controller).toBe("human"));
    expect(result.current.isLive).toBe(true);
    expect(result.current.liveUrl).toBe("https://embed.example/session");
  });

  it("take_control POSTs then reflects the server's reply — not an optimistic flip", async () => {
    const fetchMock = mockFetchSequence([
      { json: SESSION("agent") },          // initial poll
      { json: { ok: true } },              // POST response
      { json: SESSION("human") },          // re-poll after action
    ]);
    const { result } = renderHook(() => useBrowserSessionControl("sess-9"));
    await waitFor(() => expect(result.current.controller).toBe("agent"));

    await act(async () => { await result.current.takeControl(); });

    const postCall = fetchMock.mock.calls.find(([url]) => url === "/api/litt/browser/session");
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body).toEqual({ action: "take_control", sessionId: "sess-9" });
    await waitFor(() => expect(result.current.controller).toBe("human"));
  });

  it("return_control hands the same session back to the agent", async () => {
    const fetchMock = mockFetchSequence([
      { json: SESSION("human") },
      { json: { ok: true } },
      { json: SESSION("agent", "agent_control") },
    ]);
    const { result } = renderHook(() => useBrowserSessionControl("sess-2"));
    await waitFor(() => expect(result.current.controller).toBe("human"));

    await act(async () => { await result.current.returnControl(); });
    await waitFor(() => expect(result.current.controller).toBe("agent"));

    const postCall = fetchMock.mock.calls.find(([url]) => url === "/api/litt/browser/session");
    expect(JSON.parse((postCall![1] as RequestInit).body as string).action).toBe("return_control");
  });

  it("reports errors truthfully instead of flipping state", async () => {
    mockFetchSequence([
      { json: SESSION("agent") },
      { status: 500, json: { error: "boom" } },
    ]);
    const { result } = renderHook(() => useBrowserSessionControl("sess-3"));
    await waitFor(() => expect(result.current.controller).toBe("agent"));
    await act(async () => { await result.current.stop(); });
    await waitFor(() => expect(result.current.error).toMatch(/close 500|boom/i));
    expect(result.current.controller).toBe("agent"); // unchanged — server refused
  });
});
