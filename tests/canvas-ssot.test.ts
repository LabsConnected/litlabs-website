import { describe, it, expect } from "vitest";
import {
  classifyCanvasState,
  canvasDocHash,
  sha256Hex,
  canonicalize,
  injectCanvasMarker,
  extractMarkedDocHash,
  isCanvasDocContentful,
  stateBlocksPublish,
  stateAllowsAutoApply,
  CANVAS_MARKER,
  WELCOME_SCREEN_MARKER,
  type CanvasDocLike,
} from "@/lib/studio/canvas-ssot";

/** Minimal contentful doc: root + one child section. */
function makeDoc(overrides: Partial<CanvasDocLike> = {}): CanvasDocLike {
  return {
    id: "doc-1",
    projectId: "p1",
    route: "/",
    version: 3,
    updatedAt: 123,
    nodes: {
      root: { children: ["s1"] },
      s1: { children: [] },
    },
    rootNodeIds: ["root"],
    ...overrides,
  };
}

const EMPTY_DOC: CanvasDocLike = {
  id: "doc-empty",
  projectId: "p1",
  nodes: { root: { children: [] } },
  rootNodeIds: ["root"],
};

describe("sha256Hex / canonicalize", () => {
  it("is stable and key-order independent", async () => {
    const a = await canvasDocHash(makeDoc({ version: 1, updatedAt: 1 }));
    const b = await canvasDocHash(makeDoc({ version: 9, updatedAt: 999 }));
    // meta fields excluded → same content hash
    expect(a).toBe(b);
  });
  it("changes when real content changes", async () => {
    const a = await canvasDocHash(makeDoc());
    const c = await canvasDocHash(makeDoc({ route: "/about" }));
    expect(a).not.toBe(c);
  });
  it("canonicalize sorts object keys", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it("sha256Hex returns a 64-char hex digest", async () => {
    expect(await sha256Hex("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("marker", () => {
  it("round-trips inject + extract", async () => {
    const h = await sha256Hex("doc");
    const html = injectCanvasMarker("<!doctype html><html></html>", h);
    expect(html.startsWith(`<!-- ${CANVAS_MARKER}:doc=${h} -->`)).toBe(true);
    expect(extractMarkedDocHash(html)).toBe(h);
  });
  it("returns null for unmarked html", () => {
    expect(extractMarkedDocHash("<html><body>hi</body></html>")).toBeNull();
  });
});

describe("classifyCanvasState", () => {
  it("absent when no canvas.json", async () => {
    const r = await classifyCanvasState({ canvasRaw: null, indexRaw: "<html>x</html>" });
    expect(r.state).toBe("absent");
  });

  it("absent (inert) when doc has no content", async () => {
    const r = await classifyCanvasState({ canvasRaw: JSON.stringify(EMPTY_DOC), indexRaw: null });
    expect(r.state).toBe("absent");
    expect(r.doc).not.toBeNull();
  });

  it("conflict when canvas.json is unparseable (fail closed)", async () => {
    const r = await classifyCanvasState({ canvasRaw: "{not json", indexRaw: "<html>x</html>" });
    expect(r.state).toBe("conflict");
    expect(stateBlocksPublish(r.state)).toBe(true);
  });

  it("unapplied when canvas has content and index.html is absent", async () => {
    const r = await classifyCanvasState({ canvasRaw: JSON.stringify(makeDoc()), indexRaw: null });
    expect(r.state).toBe("unapplied");
    expect(stateAllowsAutoApply(r.state)).toBe(true);
    expect(stateBlocksPublish(r.state)).toBe(true);
  });

  it("unapplied when index.html is the welcome seed", async () => {
    const r = await classifyCanvasState({
      canvasRaw: JSON.stringify(makeDoc()),
      indexRaw: `<html><!-- ${WELCOME_SCREEN_MARKER} --><body>welcome</body></html>`,
    });
    expect(r.state).toBe("unapplied");
  });

  it("conflict when a foreign hand-written index.html exists", async () => {
    const r = await classifyCanvasState({
      canvasRaw: JSON.stringify(makeDoc()),
      indexRaw: "<html><body>hand written</body></html>",
    });
    expect(r.state).toBe("conflict");
    expect(stateAllowsAutoApply(r.state)).toBe(false);
    expect(stateBlocksPublish(r.state)).toBe(true);
  });

  it("clean when doc and file match the materialization record", async () => {
    const doc = makeDoc();
    const docHash = await canvasDocHash(doc);
    const html = injectCanvasMarker("<!doctype html><html><body>site</body></html>", docHash);
    const fileHash = await sha256Hex(html);
    const matDoc = { ...doc, materialization: { docHash, fileHash, materializedAt: 1 } };
    const r = await classifyCanvasState({ canvasRaw: JSON.stringify(matDoc), indexRaw: html });
    expect(r.state).toBe("clean");
    expect(stateBlocksPublish(r.state)).toBe(false);
  });

  it("pending when doc changed but file bytes are untouched", async () => {
    const doc = makeDoc();
    const docHash = await canvasDocHash(doc);
    const html = injectCanvasMarker("<!doctype html><html><body>site</body></html>", docHash);
    const fileHash = await sha256Hex(html);
    const changed = { ...doc, route: "/new", materialization: { docHash, fileHash, materializedAt: 1 } };
    const r = await classifyCanvasState({ canvasRaw: JSON.stringify(changed), indexRaw: html });
    expect(r.state).toBe("pending");
    expect(stateAllowsAutoApply(r.state)).toBe(true);
    expect(stateBlocksPublish(r.state)).toBe(true);
  });

  it("CONFLICT when index.html bytes changed even though the marker is intact", async () => {
    // The core hardened requirement: marker + record both present, but the
    // file was edited underneath the marker.
    const doc = makeDoc();
    const docHash = await canvasDocHash(doc);
    const html = injectCanvasMarker("<!doctype html><html><body>site</body></html>", docHash);
    const fileHash = await sha256Hex(html);
    const matDoc = { ...doc, materialization: { docHash, fileHash, materializedAt: 1 } };
    const edited = html.replace("<body>site</body>", "<body>edited by hand</body>");
    expect(edited).toContain(CANVAS_MARKER); // marker survives
    const r = await classifyCanvasState({ canvasRaw: JSON.stringify(matDoc), indexRaw: edited });
    expect(r.state).toBe("conflict");
    expect(stateBlocksPublish(r.state)).toBe(true);
  });

  it("conflict when materialized file vanished", async () => {
    const doc = makeDoc();
    const docHash = await canvasDocHash(doc);
    const matDoc = { ...doc, materialization: { docHash, fileHash: "abc", materializedAt: 1 } };
    const r = await classifyCanvasState({ canvasRaw: JSON.stringify(matDoc), indexRaw: null });
    expect(r.state).toBe("conflict");
  });

  it("superseded doc does not block publish while unchanged", async () => {
    const doc = makeDoc();
    const docHash = await canvasDocHash(doc);
    const sup = { ...doc, status: "superseded" as const, supersededDocHash: docHash, supersededAt: 1, supersededFileHash: "f" };
    const r = await classifyCanvasState({
      canvasRaw: JSON.stringify(sup),
      indexRaw: "<html><body>user files</body></html>",
    });
    expect(r.state).toBe("superseded");
    expect(stateBlocksPublish(r.state)).toBe(false);
  });

  it("superseded exemption ends when the doc is edited again", async () => {
    const doc = makeDoc();
    const docHash = await canvasDocHash(doc);
    const sup = {
      ...doc,
      route: "/edited-after-supersede",
      status: "superseded" as const,
      supersededDocHash: docHash,
      supersededAt: 1,
    };
    const r = await classifyCanvasState({
      canvasRaw: JSON.stringify(sup),
      indexRaw: "<html><body>user files</body></html>",
    });
    // doc changed since supersede → re-evaluated → foreign index → conflict
    expect(r.state).toBe("conflict");
  });

  it("unapplied when marker matches doc but record is missing", async () => {
    const doc = makeDoc();
    const docHash = await canvasDocHash(doc);
    const html = injectCanvasMarker("<!doctype html><html>x</html>", docHash);
    const r = await classifyCanvasState({ canvasRaw: JSON.stringify(doc), indexRaw: html });
    expect(r.state).toBe("unapplied");
  });
});

describe("isCanvasDocContentful", () => {
  it("empty root is not contentful", () => {
    expect(isCanvasDocContentful(EMPTY_DOC)).toBe(false);
  });
  it("root with children is contentful", () => {
    expect(isCanvasDocContentful(makeDoc())).toBe(true);
  });
});
