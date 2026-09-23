import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCanvasPersistence } from "./useCanvasPersistence";

/**
 * Regression tests: CanvasTool persistence must treat Supabase as the
 * source of truth —
 *  - mount resolves/creates the canvas server-side and loads file blocks,
 *  - edits are pushed through the blocks API (debounced),
 *  - failures are surfaced honestly (never a fake "saved"),
 *  - an unreachable server on load falls back to the local cache, labeled.
 */

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-response", () => ({ apiFetch: apiFetchMock }));

type FetchOpts = { method?: string; body?: string };
type FetchImpl = (url: string, opts?: FetchOpts) => Promise<unknown>;

interface FakeCanvas {
  id: string;
  title: string;
  projectId: string | null;
  status: "active" | "archived";
  updatedAt: string;
}

interface FakeBlock {
  id: string;
  type: string;
  content: Record<string, unknown>;
  position: number;
}

interface BlockPayload {
  type: string;
  content: Record<string, unknown>;
  position?: number;
}

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

/** Tiny in-memory fake of the /api/canvases REST surface. */
function makeServer() {
  let seq = 0;
  const canvases: Record<string, FakeCanvas> = {};
  const blocks: Record<string, FakeBlock[]> = {};
  const calls: Call[] = [];
  const ts = "2026-09-20T12:00:00.000Z";

  const canvasShape = (c: FakeCanvas) => ({
    id: c.id,
    userId: "user-1",
    projectId: c.projectId,
    missionId: null,
    conversationId: null,
    title: c.title,
    type: "code",
    status: c.status,
    version: 1,
    metadata: {},
    createdAt: ts,
    updatedAt: c.updatedAt,
  });
  const blockShape = (cid: string, b: FakeBlock) => ({
    id: b.id,
    canvasId: cid,
    userId: "user-1",
    type: b.type,
    content: b.content,
    position: b.position,
    metadata: {},
    createdAt: ts,
    updatedAt: ts,
  });

  const server = {
    calls,
    canvases,
    blocks,
    seedCanvas(
      id: string,
      projectId: string | null,
      fileBlocks: Array<{ path: string; content: string; language: string }>,
      updatedAt = ts,
    ) {
      canvases[id] = { id, title: "Seed", projectId, status: "active", updatedAt };
      blocks[id] = fileBlocks.map((f, i) => ({
        id: `seed-block-${i}`,
        type: "file",
        content: { path: f.path, content: f.content, language: f.language },
        position: i,
      }));
    },
    install() {
      const impl: FetchImpl = async (url: string, opts: FetchOpts = {}) => {
        const method = (opts.method ?? "GET").toUpperCase();
        const body = (
          opts.body ? (JSON.parse(opts.body) as Record<string, unknown>) : undefined
        );
        calls.push({ url, method, body });
        const u = new URL(url, "http://test.local");

        if (u.pathname === "/api/canvases" && method === "GET") {
          const pid = u.searchParams.get("projectId");
          const list = Object.values(canvases)
            .filter((c) => c.status === "active")
            .filter((c) => !pid || c.projectId === pid);
          return { canvases: list.map(canvasShape) };
        }
        if (u.pathname === "/api/canvases" && method === "POST") {
          const id = `canvas-${++seq}`;
          canvases[id] = {
            id,
            title: typeof body?.title === "string" ? body.title : "Canvas",
            projectId: typeof body?.projectId === "string" ? body.projectId : null,
            status: "active",
            updatedAt: ts,
          };
          blocks[id] = [];
          return { canvas: canvasShape(canvases[id]), blocks: [] };
        }
        const m = u.pathname.match(/^\/api\/canvases\/([^/]+)(\/blocks(?:\/([^/]+))?)?$/);
        if (m) {
          const cid = decodeURIComponent(m[1]);
          const bid = m[3] ? decodeURIComponent(m[3]) : null;
          const canvas = canvases[cid];
          if (!canvas) throw new Error("Canvas not found");
          if (!bid && method === "GET") {
            return {
              canvas: canvasShape(canvas),
              blocks: (blocks[cid] ?? []).map((b) => blockShape(cid, b)),
            };
          }
          if (!bid && method === "PATCH" && body?.status === "archived") {
            canvas.status = "archived";
            return { ok: true };
          }
          if (!bid && method === "POST") {
            const payloads = body?.blocks as BlockPayload[] | undefined;
            const added = (payloads ?? []).map((b, i) => {
              const nb: FakeBlock = {
                id: `block-${++seq}`,
                type: b.type,
                content: b.content,
                position: b.position ?? (blocks[cid]?.length ?? 0) + i,
              };
              (blocks[cid] ??= []).push(nb);
              return nb;
            });
            return { blocks: added.map((b) => blockShape(cid, b)) };
          }
          if (bid && method === "PATCH") {
            const b = (blocks[cid] ?? []).find((x) => x.id === bid);
            if (!b) throw new Error("Block not found");
            b.content = { ...b.content, ...((body?.patch as Record<string, unknown>) ?? {}) };
            return { block: blockShape(cid, b) };
          }
          if (bid && method === "DELETE") {
            const list = blocks[cid] ?? [];
            const idx = list.findIndex((x) => x.id === bid);
            if (idx === -1) throw new Error("Block not found");
            list.splice(idx, 1);
            return { ok: true };
          }
        }
        throw new Error(`unmocked ${method} ${url}`);
      };
      apiFetchMock.mockImplementation(impl);
    },
  };
  return server;
}

beforeEach(() => {
  localStorage.clear();
  apiFetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCanvasPersistence", () => {
  it("creates the canvas server-side on mount when none exists", async () => {
    const server = makeServer();
    server.install();

    const { result } = renderHook(() => useCanvasPersistence("proj-1", { debounceMs: 20 }));
    await waitFor(() => expect(result.current.loadState).toBe("ready"));

    expect(result.current.canvasId).toMatch(/^canvas-/);
    expect(result.current.files).toEqual([]);
    const post = server.calls.find((c) => c.method === "POST" && c.url === "/api/canvases");
    expect(post?.body).toMatchObject({ title: "Canvas", type: "code", projectId: "proj-1" });
    // Pointer cached for next mount (hint only).
    expect(localStorage.getItem("litlabs:canvas:id")).toBe(result.current.canvasId);
  });

  it("loads the most recent active code canvas and its file blocks", async () => {
    const server = makeServer();
    server.seedCanvas(
      "canvas-old",
      "proj-1",
      [{ path: "old.html", content: "old", language: "html" }],
      "2026-09-19T12:00:00.000Z",
    );
    server.seedCanvas("canvas-new", "proj-1", [
      { path: "index.html", content: "<h1>x</h1>", language: "html" },
      { path: "app.css", content: "body{}", language: "css" },
    ]);
    server.install();

    const { result } = renderHook(() => useCanvasPersistence("proj-1", { debounceMs: 20 }));
    await waitFor(() => expect(result.current.loadState).toBe("ready"));

    expect(result.current.canvasId).toBe("canvas-new");
    expect(result.current.files).toEqual([
      { name: "index.html", content: "<h1>x</h1>", language: "html", blockId: "seed-block-0" },
      { name: "app.css", content: "body{}", language: "css", blockId: "seed-block-1" },
    ]);
  });

  it("persists added files through the blocks API and reports saved", async () => {
    const server = makeServer();
    server.install();

    const { result } = renderHook(() => useCanvasPersistence("proj-1", { debounceMs: 20 }));
    await waitFor(() => expect(result.current.loadState).toBe("ready"));

    act(() => {
      result.current.setFiles([{ name: "a.html", content: "A", language: "html" }]);
    });
    // Debounced: not saved synchronously.
    expect(result.current.saveState).toBe("idle");

    await waitFor(() => expect(result.current.saveState).toBe("saved"));
    const post = server.calls.find((c) => c.method === "POST" && c.url.endsWith("/blocks"));
    const payloads = post?.body?.blocks as BlockPayload[] | undefined;
    expect(payloads).toHaveLength(1);
    expect(payloads?.[0]).toMatchObject({
      type: "file",
      content: { path: "a.html", content: "A", language: "html" },
    });
    // Server round-trip re-attaches the block id.
    expect(result.current.files[0].blockId).toMatch(/^block-/);
    // Server actually holds the file.
    const stored = server.blocks[result.current.canvasId as string];
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toMatchObject({ path: "a.html", content: "A" });
  });

  it("syncs updates and deletes as a diff, not a rewrite", async () => {
    const server = makeServer();
    server.seedCanvas("canvas-1", "proj-1", [
      { path: "keep.html", content: "same", language: "html" },
      { path: "edit.html", content: "old", language: "html" },
      { path: "gone.html", content: "x", language: "html" },
    ]);
    server.install();

    const { result } = renderHook(() => useCanvasPersistence("proj-1", { debounceMs: 20 }));
    await waitFor(() => expect(result.current.loadState).toBe("ready"));

    act(() => {
      result.current.setFiles([
        { name: "keep.html", content: "same", language: "html", blockId: "seed-block-0" },
        { name: "edit.html", content: "new", language: "html", blockId: "seed-block-1" },
        { name: "fresh.html", content: "fresh", language: "html" },
      ]);
    });
    await waitFor(() => expect(result.current.saveState).toBe("saved"));

    const patch = server.calls.find(
      (c) => c.method === "PATCH" && c.url.includes("/blocks/seed-block-1"),
    );
    expect(patch?.body?.patch).toMatchObject({ path: "edit.html", content: "new" });
    const del = server.calls.find(
      (c) => c.method === "DELETE" && c.url.includes("/blocks/seed-block-2"),
    );
    expect(del).toBeTruthy();
    // Unchanged block was never touched.
    expect(
      server.calls.filter((c) => c.url.includes("seed-block-0") && c.method !== "GET"),
    ).toHaveLength(0);
    // Final server state matches the file list.
    const stored = server.blocks["canvas-1"];
    expect(stored.map((b) => String(b.content.path)).sort()).toEqual(
      ["edit.html", "fresh.html", "keep.html"].sort(),
    );
  });

  it("surfaces save failures honestly and recovers on retry", async () => {
    const server = makeServer();
    server.install();

    const { result } = renderHook(() => useCanvasPersistence("proj-1", { debounceMs: 20 }));
    await waitFor(() => expect(result.current.loadState).toBe("ready"));

    // Fail the next blocks POST.
    const impl = apiFetchMock.getMockImplementation() as unknown as FetchImpl;
    const failing: FetchImpl = async (url: string, opts: FetchOpts = {}) => {
      if (url.endsWith("/blocks") && (opts.method ?? "GET").toUpperCase() === "POST") {
        throw new Error("network down");
      }
      return impl(url, opts);
    };
    apiFetchMock.mockImplementation(failing);

    act(() => {
      result.current.setFiles([{ name: "a.html", content: "A", language: "html" }]);
    });
    await waitFor(() => expect(result.current.saveState).toBe("error"));
    expect(result.current.saveError).toMatch(/network down/);
    // Local edits are kept (not silently dropped), server has nothing.
    expect(result.current.files).toHaveLength(1);
    expect(server.blocks[result.current.canvasId as string]).toHaveLength(0);

    // Retry with a healthy server recovers.
    apiFetchMock.mockImplementation(impl);
    act(() => {
      result.current.retrySave();
    });
    await waitFor(() => expect(result.current.saveState).toBe("saved"));
    expect(server.blocks[result.current.canvasId as string]).toHaveLength(1);
  });

  it("falls back to the local cache with an honest error when the server is unreachable on load", async () => {
    localStorage.setItem(
      "litlabs:canvas:files",
      JSON.stringify([{ name: "cached.html", content: "C", language: "html" }]),
    );
    apiFetchMock.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useCanvasPersistence("proj-1", { debounceMs: 20 }));
    await waitFor(() => expect(result.current.loadState).toBe("error"));

    expect(result.current.files).toEqual([{ name: "cached.html", content: "C", language: "html" }]);
    expect(result.current.loadError).toMatch(/couldn't reach the canvas server/i);
  });

  it("resetCanvas archives the current canvas and starts a fresh one", async () => {
    const server = makeServer();
    server.install();

    const { result } = renderHook(() => useCanvasPersistence("proj-1", { debounceMs: 20 }));
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    const firstId = result.current.canvasId as string;

    act(() => {
      result.current.setFiles([{ name: "a.html", content: "A", language: "html" }]);
    });
    await waitFor(() => expect(result.current.saveState).toBe("saved"));

    await act(async () => {
      await result.current.resetCanvas();
    });
    await waitFor(() => expect(result.current.loadState).toBe("ready"));

    expect(result.current.canvasId).not.toBe(firstId);
    expect(result.current.files).toEqual([]);
    const archived = server.calls.find(
      (c) =>
        c.method === "PATCH" &&
        c.url === `/api/canvases/${firstId}` &&
        c.body?.status === "archived",
    );
    expect(archived).toBeTruthy();
    expect(server.canvases[firstId].status).toBe("archived");
  });
});
