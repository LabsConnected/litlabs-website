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

/** A doc with real user content — a root section holding a text child. */
function makeContentDoc(marker: string): CanvasDocument {
  const doc = makeDoc(marker);
  const rootId = doc.rootNodeIds[0];
  const now = Date.now();
  doc.nodes[`${rootId}-text`] = {
    id: `${rootId}-text`,
    type: "text",
    parentId: rootId,
    children: [],
    props: { text: marker },
    styles: {},
    metadata: { createdAt: now, updatedAt: now },
  };
  doc.nodes[rootId].children = [`${rootId}-text`];
  return doc;
}

function resp(status: number, json: Record<string, unknown> = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => json } as Response;
}

/**
 * Action-aware files API stub. `reads` maps projectId → read outcome;
 * `writes` controls the write outcome (default: 200 with a fresh sha).
 */
function stubFilesApi(
  reads: Record<string, { status: number; content?: string; sha256?: string }> = {},
  writeResp: { status: number; json?: Record<string, unknown> } = {
    status: 200,
    json: { saved: true, sha256: "sha-written" },
  },
) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}") as { action?: string; path?: string };
    const project = /\/api\/studio-projects\/([^/]+)\/files/.exec(_url)?.[1] ?? "?";
    if (body.action === "read") {
      const cfg = reads[project] ?? { status: 200 };
      if (cfg.status !== 200) return resp(cfg.status);
      return resp(200, { content: cfg.content, sha256: cfg.sha256 });
    }
    if (body.action === "write") {
      return resp(writeResp.status, writeResp.json ?? {});
    }
    return resp(400);
  });
}

function calls(fetchMock: ReturnType<typeof vi.fn>, action: string) {
  return fetchMock.mock.calls
    .map((c) => ({ url: c[0] as string, init: (c[1] ?? {}) as RequestInit }))
    .filter((c) => (c.init.body as string)?.includes(`"${action}"`));
}

function writesTo(fetchMock: ReturnType<typeof vi.fn>) {
  return calls(fetchMock, "write");
}

function writeBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return writesTo(fetchMock).map((c) => JSON.parse(c.init.body as string));
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
    fetchMock = stubFilesApi();
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
    fetchMock = stubFilesApi({}, { status: 500 });
    vi.stubGlobal("fetch", fetchMock);
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
    fetchMock = stubFilesApi({}, { status: 500 });
    vi.stubGlobal("fetch", fetchMock);
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
    fetchMock = stubFilesApi({
      [PROJECT_ID]: { status: 200, content: JSON.stringify(savedDoc), sha256: "sha-server" },
    });
    vi.stubGlobal("fetch", fetchMock);
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
    let firstCall = true;
    fetchMock.mockImplementation(
      () => {
        if (firstCall) {
          firstCall = false;
          return new Promise((res) => { resolveRead = res; });
        }
        // After the (failed) initial read, probes see a confirmed-absent file.
        return Promise.resolve(resp(404));
      },
    );
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));

    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("early-edit") });
      await vi.runAllTimersAsync();
    });
    expect(writesTo(fetchMock).length).toBe(0);

    await act(async () => {
      resolveRead(resp(500));
      await vi.runAllTimersAsync();
    });
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("after-load") });
      await vi.runAllTimersAsync();
    });
    // The unverified baseline re-probes; the probe sees 404 → CAS "absent".
    const bodies = writeBodies(fetchMock);
    expect(bodies.length).toBe(1);
    expect(bodies[0].expectedSha256).toBe("absent");
    unmount();
  });

  it("re-loads on project switch and never leaks the prior canvas", async () => {
    // Regression (Greptile 4374230803): hasLoadedRef was global, so project
    // B never loaded its own canvas and edits wrote A's document into B.
    const PROJECT_B = "99999999-8888-7777-6666-555555555555";
    const docA = makeDoc("project-a-canvas");
    const docB = makeDoc("project-b-canvas");
    fetchMock = stubFilesApi({
      [PROJECT_ID]: { status: 404 },
      [PROJECT_B]: { status: 200, content: JSON.stringify(docB), sha256: "sha-b" },
    });
    vi.stubGlobal("fetch", fetchMock);

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

  it("an in-flight save completing after a project switch stamps nothing into the new project", async () => {
    // Regression (4f1cd688): saveToFile had no post-await stale-project
    // guard, so a resolving save could stamp the old project's CAS baseline
    // into the new project's sync state.
    const PROJECT_B = "99999999-8888-7777-6666-555555555555";
    const docA = makeDoc("a-doc");
    let resolveWrite!: (v: unknown) => void;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const project = /\/api\/studio-projects\/([^/]+)\/files/.exec(url)?.[1];
      const body = JSON.parse((init?.body as string) ?? "{}") as { action?: string };
      if (body.action === "read") {
        return project === PROJECT_B
          ? resp(404) // B's canvas is confirmed absent
          : resp(200, { content: JSON.stringify(docA), sha256: "sha-a" });
      }
      if (body.action === "write") {
        // Hold A's write in flight until after the switch.
        return new Promise((res) => { resolveWrite = res; });
      }
      return resp(400);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender, unmount } = renderHook(
      (id: string) => useCanvasFileSync(id),
      { initialProps: PROJECT_ID },
    );
    await settleMount(fetchMock);

    // Start an A save and switch to B while it is in flight.
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("a-edit") });
    });
    await act(async () => { await vi.runAllTimersAsync(); });
    rerender(PROJECT_B);
    await act(async () => { await vi.runAllTimersAsync(); });
    fetchMock.mockClear();

    // A's write resolves late — its sha must NOT become B's CAS baseline.
    await act(async () => {
      resolveWrite(resp(200, { saved: true, sha256: "sha-a2" }));
      await vi.runAllTimersAsync();
    });
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("b-edit") });
      await vi.runAllTimersAsync();
    });
    const bodies = writeBodies(fetchMock);
    expect(bodies.length).toBe(1);
    // B's baseline is still "absent" — A's resolved write leaked nothing.
    expect(bodies[0].expectedSha256).toBe("absent");
    unmount();
  });

  it("first-syncs real local work into a workspace with no canvas file (404)", async () => {
    // Regression (run 40967251750): a missing canvas file must write the
    // local document — baseline-adopting it left the workspace empty and
    // the Create→Save journey timed out waiting for a write that never came.
    fetchMock = stubFilesApi({ [PROJECT_ID]: { status: 404 } });
    vi.stubGlobal("fetch", fetchMock);
    useCanvasBuilderStore.setState({ document: makeContentDoc("seeded-work") });
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await act(async () => { await vi.runAllTimersAsync(); });
    const bodies = writeBodies(fetchMock);
    expect(bodies.length).toBe(1);
    expect(bodies[0].content).toContain("seeded-work");
    expect(bodies[0].expectedSha256).toBe("absent");
    unmount();
  });

  it("does not write an untouched empty doc into an empty workspace", async () => {
    fetchMock = stubFilesApi({ [PROJECT_ID]: { status: 404 } });
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(writesTo(fetchMock).length).toBe(0);
    unmount();
  });

  it("fails closed when the read fails and the server state is unverified", async () => {
    // A 5xx read cannot confirm the workspace is empty — auto-writing the
    // local doc could clobber real saved work. Saves probe first; a still-
    // failing probe is an error, never a write.
    fetchMock = stubFilesApi({ [PROJECT_ID]: { status: 500 } });
    vi.stubGlobal("fetch", fetchMock);
    useCanvasBuilderStore.setState({ document: makeContentDoc("risky-local") });
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(writesTo(fetchMock).length).toBe(0);
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("explicit-edit") });
      await vi.runAllTimersAsync();
    });
    expect(writesTo(fetchMock).length).toBe(0);
    expect(useCanvasBuilderStore.getState().saveState).toBe("error");
    unmount();
  });

  it("surfaces a conflict when the server file moved since our baseline", async () => {
    // Concurrent-save detection: another writer changed canvas.json after
    // we adopted sha-a — the CAS write is rejected (409) and surfaced as
    // "conflict", never a silent overwrite.
    const docA = makeDoc("a-doc");
    fetchMock = stubFilesApi(
      { [PROJECT_ID]: { status: 200, content: JSON.stringify(docA), sha256: "sha-a" } },
      { status: 409, json: { code: "REVISION_CONFLICT", currentSha256: "sha-other" } },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await settleMount(fetchMock);
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("racing-edit") });
      await vi.runAllTimersAsync();
    });
    const bodies = writeBodies(fetchMock);
    expect(bodies.length).toBe(1);
    expect(bodies[0].expectedSha256).toBe("sha-a");
    expect(useCanvasBuilderStore.getState().saveState).toBe("conflict");
    unmount();
  });

  it("guards the unload flush with the CAS revision — newer server content is never clobbered", async () => {
    // 4f1cd688: the pagehide/unmount flush carries expectedSha256 so a file
    // changed on the server rejects instead of being silently overwritten.
    const docA = makeDoc("a-doc");
    fetchMock = stubFilesApi({
      [PROJECT_ID]: { status: 200, content: JSON.stringify(docA), sha256: "sha-a" },
    });
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await settleMount(fetchMock);
    await act(async () => {
      useCanvasBuilderStore.setState({ document: makeDoc("unload-edit") });
    });
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    const bodies = writeBodies(fetchMock);
    expect(bodies.length).toBe(1);
    expect(bodies[0].expectedSha256).toBe("sha-a");
    unmount();
  });

  it("never flush-writes when the server revision was never verified", async () => {
    fetchMock = stubFilesApi({ [PROJECT_ID]: { status: 500 } });
    vi.stubGlobal("fetch", fetchMock);
    useCanvasBuilderStore.setState({ document: makeContentDoc("local-draft") });
    const { unmount } = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await act(async () => { await vi.runAllTimersAsync(); });
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(writesTo(fetchMock).length).toBe(0);
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
    fetchMock = stubFilesApi({
      [PROJECT_ID]: { status: 200, content: JSON.stringify(content), sha256: "sha-nav" },
    });
    vi.stubGlobal("fetch", fetchMock);
    const second = renderHook(() => useCanvasFileSync(PROJECT_ID));
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(writesTo(fetchMock).length).toBe(0);
    second.unmount();
  });
});
