// @vitest-environment jsdom
/**
 * useCanvasFileSync — the persistence boundary that decides whether the
 * canvas may write .litt/canvas.json.
 *
 * These tests exist because every failure mode here is a *data-loss* mode:
 * writing before the server's document loads, carrying one project's
 * document into another, retrying writes that were revision-rejected, or
 * looping a failed write forever. The assertions pin the timing/ordering
 * contract, not just outcomes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasFileSync } from "@/app/(app)/studio/components/canvas/builder/useCanvasFileSync";
import { useCanvasBuilderStore, docStorageKey } from "@/app/(app)/studio/components/canvas/builder/store";
import { createEmptyDocument, type CanvasDocument, type CanvasNode } from "@/app/(app)/studio/components/canvas/builder/types";

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}
const calls: Call[] = [];

interface Deferred {
  promise: Promise<{ status: number; body: unknown }>;
  resolve: (v: { status: number; body: unknown }) => void;
}
function deferred(): Deferred {
  let resolve!: Deferred["resolve"];
  const promise = new Promise<{ status: number; body: unknown }>((res) => (resolve = res));
  return { promise, resolve };
}

function node(id: string, children: string[] = []): CanvasNode {
  return {
    id,
    type: "section",
    name: id,
    props: {},
    styles: {},
    children,
    parentId: null,
    order: 0,
    isLocked: false,
    isHidden: false,
    metadata: { createdAt: 0, updatedAt: 0 },
  } as unknown as CanvasNode;
}

function docWith(projectId: string | null, extraChild = "s1"): CanvasDocument {
  return {
    id: `doc-${projectId}`,
    projectId,
    conversationId: null,
    route: "/",
    nodes: { root: { ...node("root"), children: [extraChild] }, [extraChild]: node(extraChild) },
    rootNodeIds: ["root"],
    version: 1,
    updatedAt: 1,
  };
}

/** Bump the doc so its serialized form differs → the auto-save effect fires. */
function editDoc() {
  const d = useCanvasBuilderStore.getState().document;
  act(() => {
    useCanvasBuilderStore.getState().setDocument({ ...d, updatedAt: Date.now() + 1 });
  });
}

const readCallsFor = (pid: string) =>
  calls.filter((c) => c.url === `/api/studio-projects/${pid}/files` && c.body.action === "read");
const writeCallsFor = (pid: string) =>
  calls.filter((c) => c.url === `/api/studio-projects/${pid}/files` && c.body.action === "write");

type Handler = (url: string, body: Record<string, unknown>, method: string) =>
  | Promise<{ status: number; body: unknown }>
  | { status: number; body: unknown };

function installFetch(handler: Handler) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url, method, body });
      const r = await handler(url, body, method);
      return new Response(JSON.stringify(r.body), { status: r.status });
    }),
  );
}

const APPLY_OK = { status: 200, body: { state: "clean" } };

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  vi.useFakeTimers();
  useCanvasBuilderStore.setState({
    document: createEmptyDocument(null),
    saveState: "local",
    canvasFileState: null,
    syncConflict: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Let pending fetch promises + React effects settle. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useCanvasFileSync", () => {
  it("never writes before the project's server read settles", async () => {
    const read = deferred();
    installFetch((url, body, method) => {
      if (url.endsWith("/canvas/apply")) return APPLY_OK;
      if (body.action === "read") return read.promise;
      return { status: 200, body: { saved: true, sha256: "w" } };
    });

    renderHook(() => useCanvasFileSync("p1"));
    await flush();

    // Edit while the read is in flight — must NOT produce a write.
    editDoc();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(writeCallsFor("p1")).toHaveLength(0);

    // Now the read settles → writes become possible.
    read.resolve({ status: 200, body: { content: JSON.stringify(docWith("p1")), sha256: "rev1" } });
    await flush();
    editDoc();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(writeCallsFor("p1").length).toBeGreaterThan(0);
  });

  it("discards a stale load that resolves after a project switch", async () => {
    const p1Read = deferred();
    installFetch((url, body) => {
      if (url.endsWith("/canvas/apply")) return APPLY_OK;
      if (body.action === "read" && url.includes("/p1/")) return p1Read.promise;
      if (body.action === "read") return { status: 404, body: { error: "not found" } };
      return { status: 200, body: { saved: true, sha256: "w" } };
    });

    const view = renderHook(({ pid }) => useCanvasFileSync(pid), { initialProps: { pid: "p1" } });
    await flush();

    // Switch before p1's read resolves → p1's late answer must be discarded.
    view.rerender({ pid: "p2" });
    await flush();
    p1Read.resolve({ status: 200, body: { content: JSON.stringify(docWith("p1")), sha256: "revA" } });
    await flush();

    // p2 404'd → fresh doc bound to p2, NOT p1's document.
    const doc = useCanvasBuilderStore.getState().document;
    expect(doc.projectId).toBe("p2");
    expect(doc.id).not.toBe("doc-p1");
  });

  it("adopts only THIS project's localStorage draft when the server has none", async () => {
    // p1's draft + p2's draft both present; binding p1 must not adopt p2's.
    localStorage.setItem(docStorageKey("p1"), JSON.stringify(docWith("p1")));
    localStorage.setItem(docStorageKey("p2"), JSON.stringify(docWith("p2")));
    installFetch((url, body) => {
      if (url.endsWith("/canvas/apply")) return APPLY_OK;
      if (body.action === "read") return { status: 404, body: { error: "not found" } };
      return { status: 200, body: { saved: true, sha256: "w" } };
    });

    const first = renderHook(() => useCanvasFileSync("p1"));
    await flush();
    expect(useCanvasBuilderStore.getState().document.id).toBe("doc-p1");
    first.unmount();

    // Fresh hook for p2 — its draft, not p1's, is adopted.
    useCanvasBuilderStore.setState({ document: createEmptyDocument(null) });
    renderHook(() => useCanvasFileSync("p2"));
    await flush();
    expect(useCanvasBuilderStore.getState().document.id).toBe("doc-p2");
  });

  it("marks failed saves honestly and never retry-loops the same content", async () => {
    installFetch((url, body) => {
      if (url.endsWith("/canvas/apply")) return APPLY_OK;
      if (body.action === "read") {
        return { status: 200, body: { content: JSON.stringify(docWith("p1")), sha256: "rev1" } };
      }
      return { status: 500, body: { error: "disk full" } };
    });

    renderHook(() => useCanvasFileSync("p1"));
    await flush();
    editDoc();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(useCanvasBuilderStore.getState().saveState).toBe("error");
    const writes = writeCallsFor("p1").length;
    expect(writes).toBe(1);

    // Long quiet period — a failed write must not spin forever.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(writeCallsFor("p1").length).toBe(1);
  });

  it("sends the server's revision hash with every write (CAS)", async () => {
    installFetch((url, body) => {
      if (url.endsWith("/canvas/apply")) return APPLY_OK;
      if (body.action === "read") {
        return { status: 200, body: { content: JSON.stringify(docWith("p1")), sha256: "rev-server" } };
      }
      return { status: 200, body: { saved: true, sha256: "rev-next" } };
    });

    renderHook(() => useCanvasFileSync("p1"));
    await flush();
    editDoc();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    const w = writeCallsFor("p1");
    expect(w).toHaveLength(1);
    expect(w[0].body.expectedSha256).toBe("rev-server");

    // Second write carries the sha256 returned by the first — revision advances.
    editDoc();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(writeCallsFor("p1")[1].body.expectedSha256).toBe("rev-next");
  });

  it("CAS rejection blocks further writes; explicit Save retries via re-read, never a blind write", async () => {
    let writesRejected = false;
    installFetch((url, body) => {
      if (url.endsWith("/canvas/apply")) return APPLY_OK;
      if (body.action === "read") {
        return { status: 200, body: { content: JSON.stringify(docWith("p1")), sha256: "rev1" } };
      }
      // Reject every write as stale — simulating a concurrent editor.
      writesRejected = true;
      return {
        status: 409,
        body: { error: "revision conflict", code: "REVISION_CONFLICT", currentSha256: "rev-other" },
      };
    });

    renderHook(() => useCanvasFileSync("p1"));
    await flush();
    editDoc();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(writesRejected).toBe(true);
    expect(useCanvasBuilderStore.getState().saveState).toBe("error");
    expect(useCanvasBuilderStore.getState().syncConflict).not.toBeNull();

    // Further edits must NOT write — the phase is blocked.
    editDoc();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(writeCallsFor("p1").length).toBe(1);

    // Explicit Save re-reads instead of rewriting stale content.
    const readsBefore = readCallsFor("p1").length;
    act(() => {
      useCanvasBuilderStore.getState().saveDocument();
    });
    await flush();
    expect(readCallsFor("p1").length).toBeGreaterThan(readsBefore);
    expect(useCanvasBuilderStore.getState().syncConflict).toBeNull();
  });
});
