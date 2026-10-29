/**
 * useCanvasFileSync — the per-project persistence contract that prevents
 * canvas data loss: writes blocked until the project's read settles,
 * project-switch isolation, blocked-on-read-failure, and lastSaved only
 * advancing after a confirmed write.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCanvasFileSync } from "./useCanvasFileSync";
import { useCanvasBuilderStore, setCanvasServerFlush } from "./store";
import { createEmptyDocument, type CanvasDocument } from "./types";

function docWithNode(projectId: string | null, label: string): CanvasDocument {
  const doc = createEmptyDocument(projectId);
  const root = doc.rootNodeIds[0];
  const id = `node-${label}`;
  doc.nodes[id] = {
    id,
    type: "text",
    parentId: root,
    children: [],
    props: { text: label },
    styles: {},
    metadata: { createdAt: 1, updatedAt: 1 },
  };
  doc.nodes[root].children.push(id);
  return doc;
}

function editDocument(label: string) {
  useCanvasBuilderStore.getState().setDocument(docWithNode("p-any", label));
}

interface WriteCall { project: string; content: string }

function stubFilesApi(reads: Record<string, { status: number; content?: string }>, opts: { failWrites?: boolean } = {}) {
  const writes: WriteCall[] = [];
  const readCalls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const m = /\/api\/studio-projects\/([^/]+)\/files/.exec(url);
    const body = JSON.parse(init?.body as string ?? "{}") as { action?: string; path?: string; content?: string };
    const project = m?.[1] ?? "?";
    if (body.action === "read") {
      readCalls.push(project);
      const cfg = reads[project] ?? { status: 404 };
      if (cfg.status !== 200) return { ok: false, status: cfg.status, json: async () => ({}) } as Response;
      return { ok: true, status: 200, json: async () => ({ content: cfg.content }) } as Response;
    }
    if (body.action === "write") {
      writes.push({ project, content: body.content ?? "" });
      if (opts.failWrites) return { ok: false, status: 500, json: async () => ({}) } as Response;
      return { ok: true, status: 200, json: async () => ({ saved: true }) } as Response;
    }
    return { ok: false, status: 400, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { writes, readCalls, fetchMock };
}

function resetStore() {
  localStorage.clear();
  setCanvasServerFlush(null);
  useCanvasBuilderStore.setState({
    document: createEmptyDocument(),
    saveState: "local",
    history: [],
    historyIndex: -1,
  });
}

const savedDoc = (project: string, label: string) => JSON.stringify(docWithNode(project, label));

describe("useCanvasFileSync — per-project persistence contract", () => {
  beforeEach(resetStore);
  afterEach(() => { vi.restoreAllMocks(); setCanvasServerFlush(null); });

  it("loads the saved document for the bound project (server wins)", async () => {
    const api = stubFilesApi({ p1: { status: 200, content: savedDoc("p1", "server-doc") } });
    renderHook(() => useCanvasFileSync("p1"));
    await waitFor(() => expect(useCanvasBuilderStore.getState().document.nodes["node-server-doc"]).toBeTruthy());
    expect(useCanvasBuilderStore.getState().saveState).toBe("saved");
    expect(api.writes).toHaveLength(0);
  });

  it("seeds a fresh empty document on 404 without writing", async () => {
    const api = stubFilesApi({ p1: { status: 404 } });
    renderHook(() => useCanvasFileSync("p1"));
    await waitFor(() => expect(useCanvasBuilderStore.getState().saveState).toBe("saved"));
    expect(useCanvasBuilderStore.getState().document.projectId).toBe("p1");
    expect(api.writes).toHaveLength(0);
  });

  it("never writes an edit made before the project read settles", async () => {
    let resolveRead!: (r: unknown) => void;
    const api = stubFilesApi({});
    api.fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? "{}") as { action?: string; content?: string };
      if (body.action === "read") {
        await new Promise((r) => { resolveRead = r; });
        return { ok: true, status: 200, json: async () => ({ content: savedDoc("p1", "late") }) } as Response;
      }
      api.writes.push({ project: "p1", content: body.content ?? "" });
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    renderHook(() => useCanvasFileSync("p1"));
    // Edit while the read is still in flight — must never reach the wire.
    editDocument("early-edit");
    await new Promise((r) => setTimeout(r, 1400));
    expect(api.writes).toHaveLength(0);
    // Resolve the read: the server document replaces the pre-load edit.
    resolveRead(undefined);
    await waitFor(() => expect(useCanvasBuilderStore.getState().document.nodes["node-late"]).toBeTruthy());
  });

  it("blocks all writes after an unexplained read failure; explicit Save retries the read", async () => {
    const reads: Record<string, { status: number; content?: string }> = { p1: { status: 500 } };
    const api = stubFilesApi(reads);
    renderHook(() => useCanvasFileSync("p1"));
    await waitFor(() => expect(useCanvasBuilderStore.getState().saveState).toBe("error"));
    // Edits while blocked must not write — a stale doc can never clobber.
    editDocument("blocked-edit");
    await new Promise((r) => setTimeout(r, 1400));
    expect(api.writes).toHaveLength(0);
    // Explicit Save retries the READ, which now succeeds and unblocks.
    reads.p1 = { status: 200, content: savedDoc("p1", "recovered") };
    act(() => useCanvasBuilderStore.getState().saveDocument());
    await waitFor(() => expect(useCanvasBuilderStore.getState().document.nodes["node-recovered"]).toBeTruthy());
    expect(useCanvasBuilderStore.getState().saveState).toBe("saved");
    expect(api.readCalls.filter((p) => p === "p1").length).toBeGreaterThanOrEqual(2);
  });

  it("drops pending writes on project switch and isolates each project's canvas", async () => {
    const api = stubFilesApi({
      p1: { status: 200, content: savedDoc("p1", "proj-a") },
      p2: { status: 404 },
    });
    const { rerender } = renderHook(({ id }) => useCanvasFileSync(id), { initialProps: { id: "p1" } });
    await waitFor(() => expect(useCanvasBuilderStore.getState().document.nodes["node-proj-a"]).toBeTruthy());
    // Edit p1's canvas but switch projects before the debounce lands.
    editDocument("p1-dirty");
    rerender({ id: "p2" });
    await waitFor(() => expect(useCanvasBuilderStore.getState().document.projectId).toBe("p2"));
    await new Promise((r) => setTimeout(r, 1400));
    // The p1 edit was never written to p2 (or anywhere — debounce dropped).
    expect(api.writes).toHaveLength(0);
    expect(api.readCalls).toContain("p2");
  });

  it("retries a failed write on the next edit and on explicit Save", async () => {
    const reads: Record<string, { status: number; content?: string }> = { p1: { status: 200, content: savedDoc("p1", "base") } };
    const api = stubFilesApi(reads, { failWrites: true });
    renderHook(() => useCanvasFileSync("p1"));
    await waitFor(() => expect(useCanvasBuilderStore.getState().document.nodes["node-base"]).toBeTruthy());
    editDocument("edit-1");
    await waitFor(() => expect(api.writes.length).toBe(1), { timeout: 2500 });
    await waitFor(() => expect(useCanvasBuilderStore.getState().saveState).toBe("error"));
    // Same-content auto-retry is suppressed (no write loop)…
    await new Promise((r) => setTimeout(r, 1400));
    expect(api.writes.length).toBe(1);
    // …but explicit Save re-attempts it.
    act(() => useCanvasBuilderStore.getState().saveDocument());
    await waitFor(() => expect(api.writes.length).toBe(2));
    // A new edit also retries naturally.
    editDocument("edit-2");
    await waitFor(() => expect(api.writes.length).toBe(3), { timeout: 2500 });
  });

  it("advances lastSaved only after a confirmed write (no silent success)", async () => {
    const api = stubFilesApi({ p1: { status: 200, content: savedDoc("p1", "base") } });
    renderHook(() => useCanvasFileSync("p1"));
    await waitFor(() => expect(useCanvasBuilderStore.getState().document.nodes["node-base"]).toBeTruthy());
    editDocument("real-save");
    await waitFor(() => expect(api.writes.length).toBe(1), { timeout: 2500 });
    await waitFor(() => expect(useCanvasBuilderStore.getState().saveState).toBe("saved"));
    const written = JSON.parse(api.writes[0].content) as CanvasDocument;
    expect(written.nodes["node-real-save"]).toBeTruthy();
  });
});
