"use client";

import { create } from "zustand";
import {
  type CanvasDocument,
  type CanvasNode,
  type NodeType,
  type NodeProps,
  type NodeStyles,
  type CanvasHistoryEntry,
  type Breakpoint,
  type SectionTemplate,
  createNode,
  createEmptyDocument,
  PALETTE_ITEMS,
} from "./types";

const STORAGE_KEY = "litt:canvasBuilder:document";
const HISTORY_LIMIT = 50;

interface CanvasBuilderStore {
  document: CanvasDocument;
  selectedNodeId: string | null;
  clipboard: CanvasNode | null;
  history: CanvasHistoryEntry[];
  historyIndex: number;
  dragSource: { type: NodeType; fromPalette: boolean; nodeId?: string } | null;
  dropTargetId: string | null;
  dropPosition: "before" | "after" | "inside" | null;
  zoom: number;
  breakpoint: Breakpoint;
  tool: "select" | "pan";
  previewMode: boolean;
  leftPanelTab: "build" | "blocks" | "components" | "assets" | "layers";

  // Actions
  loadDocument: () => void;
  saveDocument: () => void;
  setDocument: (doc: CanvasDocument) => void;
  selectNode: (nodeId: string | null) => void;
  addNode: (type: NodeType, parentId: string, index?: number) => string;
  addNodeObject: (node: CanvasNode, parentId: string, index?: number) => void;
  removeNode: (nodeId: string) => void;
  moveNode: (nodeId: string, newParentId: string, index?: number) => void;
  updateNodeProps: (nodeId: string, props: Partial<NodeProps>) => void;
  updateNodeStyles: (nodeId: string, styles: Partial<NodeStyles>) => void;
  updateNodeMetadata: (nodeId: string, metadata: Partial<CanvasNode["metadata"]>) => void;
  duplicateNode: (nodeId: string) => void;
  copyNode: (nodeId: string) => void;
  pasteNode: (parentId: string) => void;
  undo: () => void;
  redo: () => void;
  setDragSource: (source: { type: NodeType; fromPalette: boolean; nodeId?: string } | null) => void;
  setDropTarget: (targetId: string | null, position: "before" | "after" | "inside" | null) => void;
  getSelectedNode: () => CanvasNode | null;
  getNode: (nodeId: string) => CanvasNode | null;
  getChildren: (nodeId: string) => CanvasNode[];
  setZoom: (zoom: number) => void;
  setBreakpoint: (bp: Breakpoint) => void;
  setTool: (tool: "select" | "pan") => void;
  setPreviewMode: (preview: boolean) => void;
  setLeftPanelTab: (tab: "build" | "blocks" | "components" | "assets" | "layers") => void;
  addSectionTemplate: (template: SectionTemplate, parentId: string) => void;
  nudgeNode: (nodeId: string, dx: number, dy: number) => void;
  getNodePath: (nodeId: string) => CanvasNode[];
}

function saveToStorage(doc: CanvasDocument) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {}
}

function loadFromStorage(): CanvasDocument | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CanvasDocument;
    if (!parsed.nodes || !parsed.rootNodeIds) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cloneNode(node: CanvasNode, newParentId: string): CanvasNode {
  const now = Date.now();
  const newId = `node-${now}-${Math.random().toString(36).slice(2, 9)}`;
  return {
    ...node,
    id: newId,
    parentId: newParentId,
    children: [],
    props: { ...node.props },
    styles: { ...node.styles },
    metadata: { createdAt: now, updatedAt: now },
  };
}

function cloneSubtree(node: CanvasNode, newParentId: string, allNodes: Record<string, CanvasNode>): { node: CanvasNode; nodes: Record<string, CanvasNode> } {
  const cloned = cloneNode(node, newParentId);
  const nodes: Record<string, CanvasNode> = { [cloned.id]: cloned };
  for (const childId of node.children) {
    const child = allNodes[childId];
    if (!child) continue;
    const { node: childClone, nodes: childNodes } = cloneSubtree(child, cloned.id, allNodes);
    cloned.children.push(childClone.id);
    Object.assign(nodes, childNodes);
  }
  return { node: cloned, nodes };
}

export const useCanvasBuilderStore = create<CanvasBuilderStore>((set, get) => ({
  document: createEmptyDocument(),
  selectedNodeId: null,
  clipboard: null,
  history: [],
  historyIndex: -1,
  dragSource: null,
  dropTargetId: null,
  dropPosition: null,
  zoom: 100,
  breakpoint: "desktop",
  tool: "select",
  previewMode: false,
  leftPanelTab: "components",

  loadDocument: () => {
    const stored = loadFromStorage();
    if (stored) {
      set({ document: stored, history: [{ document: stored, description: "Loaded", timestamp: Date.now() }], historyIndex: 0 });
    }
  },

  saveDocument: () => {
    saveToStorage(get().document);
  },

  setDocument: (doc) => {
    set({ document: doc });
    saveToStorage(doc);
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  addNode: (type, parentId, index) => {
    const node = createNode(type);
    get().addNodeObject(node, parentId, index);
    return node.id;
  },

  addNodeObject: (node, parentId, index) => {
    const doc = get().document;
    const parent = doc.nodes[parentId];
    if (!parent) return;

    const updatedNode = { ...node, parentId };
    const updatedParent: CanvasNode = {
      ...parent,
      children: index != null
        ? [...parent.children.slice(0, index), node.id, ...parent.children.slice(index)]
        : [...parent.children, node.id],
      metadata: { ...parent.metadata, updatedAt: Date.now() },
    };

    const newDoc: CanvasDocument = {
      ...doc,
      nodes: { ...doc.nodes, [node.id]: updatedNode, [parentId]: updatedParent },
      version: doc.version + 1,
      updatedAt: Date.now(),
    };

    pushHistory(set, get, newDoc, `Add ${node.type}`);
    set({ document: newDoc, selectedNodeId: node.id });
    saveToStorage(newDoc);
  },

  removeNode: (nodeId) => {
    const doc = get().document;
    const node = doc.nodes[nodeId];
    if (!node || !node.parentId) return;

    // Collect all descendant IDs
    const toRemove = new Set<string>();
    function collect(id: string) {
      toRemove.add(id);
      const n = doc.nodes[id];
      if (n) n.children.forEach(collect);
    }
    collect(nodeId);

    const parent = doc.nodes[node.parentId];
    const updatedParent: CanvasNode = {
      ...parent,
      children: parent.children.filter((c) => c !== nodeId),
      metadata: { ...parent.metadata, updatedAt: Date.now() },
    };

    const newNodes = { ...doc.nodes, [parent.id]: updatedParent };
    for (const id of toRemove) delete newNodes[id];

    const newDoc: CanvasDocument = {
      ...doc,
      nodes: newNodes,
      version: doc.version + 1,
      updatedAt: Date.now(),
    };

    pushHistory(set, get, newDoc, `Delete ${node.type}`);
    const wasSelected = get().selectedNodeId === nodeId;
    set({ document: newDoc, ...(wasSelected ? { selectedNodeId: null } : {}) });
    saveToStorage(newDoc);
  },

  moveNode: (nodeId, newParentId, index) => {
    const doc = get().document;
    const node = doc.nodes[nodeId];
    const newParent = doc.nodes[newParentId];
    if (!node || !newParent || !node.parentId) return;
    if (nodeId === newParentId) return;
    // Prevent moving a node into its own descendant
    let ancestor: string | null = newParentId;
    while (ancestor) {
      if (ancestor === nodeId) return;
      ancestor = doc.nodes[ancestor]?.parentId ?? null;
    }

    const oldParent = doc.nodes[node.parentId];

    // Remove from old parent
    const updatedOldParent: CanvasNode = {
      ...oldParent,
      children: oldParent.children.filter((c) => c !== nodeId),
      metadata: { ...oldParent.metadata, updatedAt: Date.now() },
    };

    // Add to new parent
    const updatedNewParent: CanvasNode = {
      ...newParent,
      children: index != null
        ? [...newParent.children.slice(0, index), nodeId, ...newParent.children.slice(index)]
        : [...newParent.children, nodeId],
      metadata: { ...newParent.metadata, updatedAt: Date.now() },
    };

    const updatedNode: CanvasNode = {
      ...node,
      parentId: newParentId,
      metadata: { ...node.metadata, updatedAt: Date.now() },
    };

    const newDoc: CanvasDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [oldParent.id]: updatedOldParent,
        [newParentId]: updatedNewParent,
        [nodeId]: updatedNode,
      },
      version: doc.version + 1,
      updatedAt: Date.now(),
    };

    pushHistory(set, get, newDoc, `Move ${node.type}`);
    set({ document: newDoc });
    saveToStorage(newDoc);
  },

  updateNodeProps: (nodeId, props) => {
    const doc = get().document;
    const node = doc.nodes[nodeId];
    if (!node) return;
    const updatedNode: CanvasNode = {
      ...node,
      props: { ...node.props, ...props },
      metadata: { ...node.metadata, updatedAt: Date.now() },
    };
    const newDoc: CanvasDocument = {
      ...doc,
      nodes: { ...doc.nodes, [nodeId]: updatedNode },
      version: doc.version + 1,
      updatedAt: Date.now(),
    };
    pushHistory(set, get, newDoc, `Update ${node.type} props`);
    set({ document: newDoc });
    saveToStorage(newDoc);
  },

  updateNodeStyles: (nodeId, styles) => {
    const doc = get().document;
    const node = doc.nodes[nodeId];
    if (!node) return;
    const updatedNode: CanvasNode = {
      ...node,
      styles: { ...node.styles, ...styles },
      metadata: { ...node.metadata, updatedAt: Date.now() },
    };
    const newDoc: CanvasDocument = {
      ...doc,
      nodes: { ...doc.nodes, [nodeId]: updatedNode },
      version: doc.version + 1,
      updatedAt: Date.now(),
    };
    pushHistory(set, get, newDoc, `Update ${node.type} styles`);
    set({ document: newDoc });
    saveToStorage(newDoc);
  },

  updateNodeMetadata: (nodeId, metadata) => {
    const doc = get().document;
    const node = doc.nodes[nodeId];
    if (!node) return;
    const updatedNode: CanvasNode = {
      ...node,
      metadata: { ...node.metadata, ...metadata, updatedAt: Date.now() },
    };
    const newDoc: CanvasDocument = {
      ...doc,
      nodes: { ...doc.nodes, [nodeId]: updatedNode },
      version: doc.version + 1,
      updatedAt: Date.now(),
    };
    set({ document: newDoc });
    saveToStorage(newDoc);
  },

  duplicateNode: (nodeId) => {
    const doc = get().document;
    const node = doc.nodes[nodeId];
    if (!node || !node.parentId) return;
    const { node: cloned, nodes: clonedNodes } = cloneSubtree(node, node.parentId, doc.nodes);
    const parent = doc.nodes[node.parentId];
    const idx = parent.children.indexOf(nodeId);
    const updatedParent: CanvasNode = {
      ...parent,
      children: [...parent.children.slice(0, idx + 1), cloned.id, ...parent.children.slice(idx + 1)],
      metadata: { ...parent.metadata, updatedAt: Date.now() },
    };
    const newDoc: CanvasDocument = {
      ...doc,
      nodes: { ...doc.nodes, ...clonedNodes, [parent.id]: updatedParent },
      version: doc.version + 1,
      updatedAt: Date.now(),
    };
    pushHistory(set, get, newDoc, `Duplicate ${node.type}`);
    set({ document: newDoc, selectedNodeId: cloned.id });
    saveToStorage(newDoc);
  },

  copyNode: (nodeId) => {
    const doc = get().document;
    const node = doc.nodes[nodeId];
    if (!node) return;
    // Deep copy the subtree for clipboard
    const { node: cloned } = cloneSubtree(node, "", doc.nodes);
    set({ clipboard: cloned });
  },

  pasteNode: (parentId) => {
    const { clipboard } = get();
    if (!clipboard) return;
    const { node: cloned, nodes: clonedNodes } = cloneSubtree(clipboard, parentId, get().document.nodes);
    get().addNodeObject(cloned, parentId);
    // Also add all descendant nodes
    const doc = get().document;
    const newNodes = { ...doc.nodes, ...clonedNodes };
    const newDoc = { ...doc, nodes: newNodes, version: doc.version + 1, updatedAt: Date.now() };
    set({ document: newDoc });
    saveToStorage(newDoc);
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const entry = history[newIndex];
    set({ document: entry.document, historyIndex: newIndex, selectedNodeId: null });
    saveToStorage(entry.document);
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const entry = history[newIndex];
    set({ document: entry.document, historyIndex: newIndex, selectedNodeId: null });
    saveToStorage(entry.document);
  },

  setDragSource: (source) => set({ dragSource: source }),
  setDropTarget: (targetId, position) => set({ dropTargetId: targetId, dropPosition: position }),

  getSelectedNode: () => {
    const { document, selectedNodeId } = get();
    if (!selectedNodeId) return null;
    return document.nodes[selectedNodeId] ?? null;
  },

  getNode: (nodeId) => {
    return get().document.nodes[nodeId] ?? null;
  },

  getChildren: (nodeId) => {
    const doc = get().document;
    const node = doc.nodes[nodeId];
    if (!node) return [];
    return node.children.map((id) => doc.nodes[id]).filter(Boolean);
  },

  setZoom: (zoom) => set({ zoom: Math.max(25, Math.min(200, zoom)) }),
  setBreakpoint: (bp) => set({ breakpoint: bp }),
  setTool: (tool) => set({ tool }),
  setPreviewMode: (preview) => set({ previewMode: preview }),
  setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),

  addSectionTemplate: (template, parentId) => {
    const { node: section, children } = template.build();
    const doc = get().document;
    const parent = doc.nodes[parentId];
    if (!parent) return;
    const allNewNodes: Record<string, CanvasNode> = { [section.id]: section };
    for (const child of children) {
      allNewNodes[child.id] = child;
    }
    const updatedParent: CanvasNode = {
      ...parent,
      children: [...parent.children, section.id],
      metadata: { ...parent.metadata, updatedAt: Date.now() },
    };
    const newDoc: CanvasDocument = {
      ...doc,
      nodes: { ...doc.nodes, ...allNewNodes, [parentId]: updatedParent },
      version: doc.version + 1,
      updatedAt: Date.now(),
    };
    pushHistory(set, get, newDoc, `Add ${template.label} section`);
    set({ document: newDoc, selectedNodeId: section.id });
    saveToStorage(newDoc);
  },

  nudgeNode: (nodeId, dx, dy) => {
    const doc = get().document;
    const node = doc.nodes[nodeId];
    if (!node) return;
    const currentMarginTop = node.styles.marginTop ?? 0;
    const currentMarginLeft = node.styles.marginLeft ?? 0;
    const updatedNode: CanvasNode = {
      ...node,
      styles: {
        ...node.styles,
        marginTop: currentMarginTop + dy,
        marginLeft: currentMarginLeft + dx,
      },
      metadata: { ...node.metadata, updatedAt: Date.now() },
    };
    const newDoc: CanvasDocument = {
      ...doc,
      nodes: { ...doc.nodes, [nodeId]: updatedNode },
      version: doc.version + 1,
      updatedAt: Date.now(),
    };
    set({ document: newDoc });
    saveToStorage(newDoc);
  },

  getNodePath: (nodeId) => {
    const doc = get().document;
    const path: CanvasNode[] = [];
    let currentId: string | null = nodeId;
    while (currentId) {
      const n: CanvasNode | undefined = doc.nodes[currentId];
      if (!n) break;
      path.unshift(n);
      currentId = n.parentId;
    }
    return path;
  },
}));

function pushHistory(
  set: (partial: Partial<CanvasBuilderStore>) => void,
  get: () => CanvasBuilderStore,
  doc: CanvasDocument,
  description: string,
) {
  const { history, historyIndex } = get();
  const entry: CanvasHistoryEntry = { document: doc, description, timestamp: Date.now() };
  // Truncate any redo entries
  const truncated = history.slice(0, historyIndex + 1);
  truncated.push(entry);
  // Keep within limit
  const trimmed = truncated.slice(-HISTORY_LIMIT);
  set({ history: trimmed, historyIndex: trimmed.length - 1 });
}
