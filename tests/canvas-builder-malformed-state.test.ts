// @vitest-environment jsdom
/**
 * Regression tests for the Studio visual canvas builder.
 *
 * Covers the "Cannot read properties of undefined (reading 'type')" crash that
 * occurred when persisted localStorage state contained stale child IDs, missing
 * node records, or malformed node objects. The store's loadFromStorage() now
 * validates and normalizes each node, and mutation functions guard against
 * stale parent references.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasBuilderStore } from "@/app/studio/components/canvas/builder/store";
import { createEmptyDocument, createNode, type CanvasDocument } from "@/app/studio/components/canvas/builder/types";

const STORAGE_KEY = "litt:canvasBuilder:document";

function seedStorage(raw: unknown) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
}

describe("canvas builder — malformed persisted state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Reset the store to a fresh empty document between tests
    useCanvasBuilderStore.setState({ document: createEmptyDocument(), selectedNodeId: null });
  });

  it("rejects persisted state with no nodes", () => {
    seedStorage({ rootNodeIds: ["root-1"] });
    useCanvasBuilderStore.getState().loadDocument();
    // Should fall back to the empty default document, not crash
    const doc = useCanvasBuilderStore.getState().document;
    expect(doc.nodes).toBeDefined();
    expect(Object.keys(doc.nodes).length).toBeGreaterThan(0);
  });

  it("rejects persisted state with no rootNodeIds", () => {
    seedStorage({ nodes: { "root-1": { id: "root-1", type: "section", children: [] } } });
    useCanvasBuilderStore.getState().loadDocument();
    const doc = useCanvasBuilderStore.getState().document;
    expect(doc.rootNodeIds.length).toBeGreaterThan(0);
  });

  it("drops node records that are missing a valid type", () => {
    const rootId = "root-1";
    seedStorage({
      id: "doc-1",
      nodes: {
        [rootId]: { id: rootId, type: "section", parentId: null, children: ["bad-1", "good-1"], props: {}, styles: {}, metadata: {} },
        "bad-1": { id: "bad-1", type: "not-a-real-type", parentId: rootId, children: [], props: {}, styles: {}, metadata: {} },
        "good-1": { id: "good-1", type: "heading", parentId: rootId, children: [], props: { text: "Hi" }, styles: {}, metadata: {} },
      },
      rootNodeIds: [rootId],
      version: 2,
      updatedAt: Date.now(),
    });
    useCanvasBuilderStore.getState().loadDocument();
    const doc = useCanvasBuilderStore.getState().document;
    // The bad node should be dropped
    expect(doc.nodes["bad-1"]).toBeUndefined();
    // The good node should remain
    expect(doc.nodes["good-1"]).toBeDefined();
    expect(doc.nodes["good-1"].type).toBe("heading");
    // The root should have its stale child reference repaired
    expect(doc.nodes[rootId].children).not.toContain("bad-1");
    expect(doc.nodes[rootId].children).toContain("good-1");
  });

  it("drops rootNodeIds that do not exist in nodes", () => {
    seedStorage({
      nodes: { "root-1": { id: "root-1", type: "section", parentId: null, children: [], props: {}, styles: {}, metadata: {} } },
      rootNodeIds: ["missing-root", "root-1"],
      version: 1,
      updatedAt: Date.now(),
    });
    useCanvasBuilderStore.getState().loadDocument();
    const doc = useCanvasBuilderStore.getState().document;
    expect(doc.rootNodeIds).toEqual(["root-1"]);
  });

  it("returns null (falls back to default) when no root IDs resolve", () => {
    seedStorage({
      nodes: { "orphan-1": { id: "orphan-1", type: "heading", parentId: null, children: [], props: {}, styles: {}, metadata: {} } },
      rootNodeIds: ["missing-root"],
      version: 1,
      updatedAt: Date.now(),
    });
    useCanvasBuilderStore.getState().loadDocument();
    const doc = useCanvasBuilderStore.getState().document;
    // Should fall back to a fresh empty document with a valid root
    expect(doc.rootNodeIds.length).toBeGreaterThan(0);
    expect(doc.nodes[doc.rootNodeIds[0]]).toBeDefined();
  });

  it("normalizes nodes missing props/styles/metadata into empty objects", () => {
    const rootId = "root-1";
    seedStorage({
      nodes: {
        [rootId]: { id: rootId, type: "section", parentId: null, children: [] },
      },
      rootNodeIds: [rootId],
      version: 1,
      updatedAt: Date.now(),
    });
    useCanvasBuilderStore.getState().loadDocument();
    const doc = useCanvasBuilderStore.getState().document;
    const root = doc.nodes[rootId];
    expect(root.props).toEqual({});
    expect(root.styles).toEqual({});
    expect(root.metadata).toBeDefined();
  });
});

describe("canvas builder — stale parent references in mutations", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useCanvasBuilderStore.setState({ document: createEmptyDocument(), selectedNodeId: null });
  });

  it("removeNode does not crash when parentId points to a missing parent", () => {
    // Construct a document where a node's parentId references a non-existent node
    const doc: CanvasDocument = {
      id: "doc-x",
      projectId: null,
      conversationId: null,
      route: "/",
      nodes: {
        "root": { id: "root", type: "section", parentId: null, children: ["orphan"], props: {}, styles: {}, metadata: { createdAt: 1, updatedAt: 1 } },
        "orphan": { id: "orphan", type: "heading", parentId: "ghost-parent", children: [], props: {}, styles: {}, metadata: { createdAt: 1, updatedAt: 1 } },
      },
      rootNodeIds: ["root"],
      version: 1,
      updatedAt: 1,
    };
    useCanvasBuilderStore.setState({ document: doc });
    // Should not throw and should leave state intact
    expect(() => useCanvasBuilderStore.getState().removeNode("orphan")).not.toThrow();
    // The orphan should still be present because the parent was missing
    const after = useCanvasBuilderStore.getState().document;
    expect(after.nodes["orphan"]).toBeDefined();
  });

  it("moveNode does not crash when old parent is missing", () => {
    const doc: CanvasDocument = {
      id: "doc-y",
      projectId: null,
      conversationId: null,
      route: "/",
      nodes: {
        "root": { id: "root", type: "section", parentId: null, children: [], props: {}, styles: {}, metadata: { createdAt: 1, updatedAt: 1 } },
        "mover": { id: "mover", type: "heading", parentId: "ghost", children: [], props: {}, styles: {}, metadata: { createdAt: 1, updatedAt: 1 } },
      },
      rootNodeIds: ["root"],
      version: 1,
      updatedAt: 1,
    };
    useCanvasBuilderStore.setState({ document: doc });
    expect(() => useCanvasBuilderStore.getState().moveNode("mover", "root")).not.toThrow();
    // The mover should not have been moved because the old parent was missing
    const after = useCanvasBuilderStore.getState().document;
    expect(after.nodes["mover"].parentId).toBe("ghost");
  });
});
