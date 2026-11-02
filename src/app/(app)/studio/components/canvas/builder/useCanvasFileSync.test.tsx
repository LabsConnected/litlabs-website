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
