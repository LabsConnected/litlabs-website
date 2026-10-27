import { describe, it, expect } from "vitest";
import { evaluateCanvasGate } from "@/lib/studio/canvas-publish-gate";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { injectCanvasMarker, sha256Hex, canvasDocHash, type CanvasDocLike } from "@/lib/studio/canvas-ssot";

/** Fake transport over an in-memory file map — throws like the real impl. */
function fakeTransport(files: Record<string, string>, failOn?: string): WorkspaceTransport {
  return {
    readFile: async (path: string) => {
      if (failOn === path) throw new Error("readFile failed (500): terminal unreachable");
      if (!(path in files)) throw new Error("readFile failed (404): not found");
      return { content: files[path], size: files[path].length };
    },
  } as unknown as WorkspaceTransport;
}

const doc: CanvasDocLike = {
  id: "d",
  projectId: "p1",
  conversationId: null,
  route: "/",
  nodes: { root: { children: ["s1"] }, s1: { children: [] } },
  rootNodeIds: ["root"],
  version: 1,
  updatedAt: 1,
};

describe("evaluateCanvasGate", () => {
  it("passes legacy projects with no canvas.json", async () => {
    const g = await evaluateCanvasGate(fakeTransport({ "index.html": "<html>site</html>" }));
    expect(g.blocked).toBe(false);
  });

  it("passes legacy projects when missing files surface as ENOENT (local fs transport)", async () => {
    const enoent: WorkspaceTransport = {
      readFile: async (path: string) => {
        if (path === "index.html") return { content: "<html>site</html>", size: 16 };
        throw new Error(`readFile failed (500): {"error":"ENOENT: no such file or directory, stat 'workspace/.litt/canvas.json'"}`);
      },
    } as unknown as WorkspaceTransport;
    const g = await evaluateCanvasGate(enoent);
    expect(g.state).toBe("absent");
    expect(g.blocked).toBe(false);
  });

  it("passes a clean (materialized + unchanged) canvas project", async () => {
    const dh = await canvasDocHash(doc);
    const html = injectCanvasMarker("<html>site</html>", dh);
    const fh = await sha256Hex(html);
    const matDoc = { ...doc, materialization: { docHash: dh, fileHash: fh, materializedAt: 1 } };
    const g = await evaluateCanvasGate(fakeTransport({
      ".litt/canvas.json": JSON.stringify(matDoc),
      "index.html": html,
    }));
    expect(g.blocked).toBe(false);
    expect(g.state).toBe("clean");
  });

  it("blocks pending canvas (doc changed, file untouched)", async () => {
    const dh = await canvasDocHash(doc);
    const html = injectCanvasMarker("<html>site</html>", dh);
    const fh = await sha256Hex(html);
    const changed = { ...doc, route: "/x", materialization: { docHash: dh, fileHash: fh, materializedAt: 1 } };
    const g = await evaluateCanvasGate(fakeTransport({
      ".litt/canvas.json": JSON.stringify(changed),
      "index.html": html,
    }));
    expect(g.blocked).toBe(true);
    expect(g.state).toBe("pending");
  });

  it("blocks conflict (external edit, intact marker)", async () => {
    const dh = await canvasDocHash(doc);
    const html = injectCanvasMarker("<html>site</html>", dh);
    const fh = await sha256Hex(html);
    const matDoc = { ...doc, materialization: { docHash: dh, fileHash: fh, materializedAt: 1 } };
    const g = await evaluateCanvasGate(fakeTransport({
      ".litt/canvas.json": JSON.stringify(matDoc),
      "index.html": html + "<!-- hand edit -->",
    }));
    expect(g.blocked).toBe(true);
    expect(g.state).toBe("conflict");
  });

  it("passes a user-resolved superseded project", async () => {
    const dh = await canvasDocHash(doc);
    const sup = { ...doc, status: "superseded", supersededDocHash: dh, supersededAt: 1 };
    const g = await evaluateCanvasGate(fakeTransport({
      ".litt/canvas.json": JSON.stringify(sup),
      "index.html": "<html>hand edited</html>",
    }));
    expect(g.blocked).toBe(false);
    expect(g.state).toBe("superseded");
  });

  it("fails closed (blocked, state=unavailable) when reads error", async () => {
    const g = await evaluateCanvasGate(fakeTransport({}, ".litt/canvas.json"));
    expect(g.blocked).toBe(true);
    expect(g.state).toBe("unavailable");
  });
});
