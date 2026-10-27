// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";

// Minimal stubs so the store module evaluates cleanly in jsdom.
import { docStorageKey, loadFromStorage, useCanvasBuilderStore } from "@/app/(app)/studio/components/canvas/builder/store";
import type { CanvasDocument, CanvasNode } from "@/app/(app)/studio/components/canvas/builder/types";

const LEGACY_KEY = "litt:canvasBuilder:document";

function makeNode(id: string, children: string[] = []): CanvasNode {
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

function makeDoc(projectId: string | null): CanvasDocument {
  return {
    id: `doc-${projectId}`,
    projectId,
    conversationId: null,
    route: "/",
    nodes: { root: { ...makeNode("root"), children: ["s1"] }, s1: makeNode("s1") },
    rootNodeIds: ["root"],
    version: 1,
    updatedAt: 1,
  };
}

function seedLegacy(doc: CanvasDocument) {
  localStorage.setItem(LEGACY_KEY, JSON.stringify(doc));
}

beforeEach(() => {
  localStorage.clear();
});

describe("docStorageKey", () => {
  it("namespaces per project, 'local' for project-less", () => {
    expect(docStorageKey("p1")).toBe("litt:canvasBuilder:document:p1");
    expect(docStorageKey("p2")).toBe("litt:canvasBuilder:document:p2");
    expect(docStorageKey(null)).toBe("litt:canvasBuilder:document:local");
    expect(docStorageKey("p1")).not.toBe(docStorageKey("p2"));
  });
});

describe("loadFromStorage", () => {
  it("reads only the project's own namespaced document", () => {
    localStorage.setItem(docStorageKey("p1"), JSON.stringify(makeDoc("p1")));
    expect(loadFromStorage("p1")?.id).toBe("doc-p1");
    expect(loadFromStorage("p2")).toBeNull();
  });

  it("rejects a namespaced doc whose embedded projectId disagrees", () => {
    // Foreign doc planted under this project's key — never adopted.
    localStorage.setItem(docStorageKey("p2"), JSON.stringify(makeDoc("p1")));
    expect(loadFromStorage("p2")).toBeNull();
  });

  it("never reads the legacy key directly", () => {
    seedLegacy(makeDoc("p1"));
    expect(loadFromStorage("p1")).toBeNull();
  });
});

describe("store.loadDocument — legacy migration + isolation", () => {
  it("adopts the legacy doc only for the project it belongs to", () => {
    seedLegacy(makeDoc("p1"));
    useCanvasBuilderStore.getState().loadDocument("p2");
    // p2 must NOT receive p1's legacy document
    expect(useCanvasBuilderStore.getState().document.id).not.toBe("doc-p1");
    // legacy key still intact for its owner
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    // now the real owner loads
    useCanvasBuilderStore.getState().loadDocument("p1");
    expect(useCanvasBuilderStore.getState().document.id).toBe("doc-p1");
    // migrated out of the legacy key, namespaced now
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(localStorage.getItem(docStorageKey("p1"))).not.toBeNull();
  });

  it("does not migrate legacy when a namespaced doc already exists", () => {
    localStorage.setItem(docStorageKey("p1"), JSON.stringify(makeDoc("p1")));
    seedLegacy({ ...makeDoc("p1"), id: "legacy" });
    useCanvasBuilderStore.getState().loadDocument("p1");
    expect(useCanvasBuilderStore.getState().document.id).toBe("doc-p1");
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it("undo never crosses a project boundary", () => {
    // Simulate: p1 doc edited (history), then p2's doc installed — an undo
    // must not resurrect p1's document into p2's context.
    const p1doc = makeDoc("p1");
    const p1edited = { ...p1doc, route: "/p1-edited" };
    const p2doc = makeDoc("p2");
    useCanvasBuilderStore.setState({
      document: p2doc,
      history: [
        { document: p1doc, description: "Loaded", timestamp: 1 },
        { document: p1edited, description: "Edit", timestamp: 2 },
        { document: p2doc, description: "Loaded", timestamp: 3 },
      ],
      historyIndex: 2,
    });
    useCanvasBuilderStore.getState().undo();
    // Still p2's document — the p1 entry was not adopted.
    expect(useCanvasBuilderStore.getState().document.projectId).toBe("p2");
    expect(useCanvasBuilderStore.getState().historyIndex).toBe(2);
  });

  it("preserves materialization + supersede metadata on load", () => {
    const doc = {
      ...makeDoc("p1"),
      materialization: { docHash: "d", fileHash: "f", materializedAt: 5 },
      status: "superseded",
      supersededDocHash: "d",
      supersededAt: 6,
      supersededFileHash: "f",
    };
    localStorage.setItem(docStorageKey("p1"), JSON.stringify(doc));
    useCanvasBuilderStore.getState().loadDocument("p1");
    const loaded = useCanvasBuilderStore.getState().document;
    expect(loaded.materialization?.docHash).toBe("d");
    expect(loaded.status).toBe("superseded");
    expect(loaded.supersededDocHash).toBe("d");
  });
});
