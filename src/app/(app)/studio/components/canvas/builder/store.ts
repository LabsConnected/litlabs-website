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
  collectCreatedNodes,
  PALETTE_ITEMS,
} from "./types";
import {
  type ProjectType,
  type HtmlProject,
  type HtmlFile,
  createEmptyHtmlProject,
} from "./projectTypes";

const STORAGE_KEY_PREFIX = "litt:canvasBuilder:document";
/** Pre-namespacing key — kept only so a legacy document can be adopted by the
 *  project it actually belongs to; never written to anymore. */
const LEGACY_STORAGE_KEY = "litt:canvasBuilder:document";
const PROJECT_TYPE_STORAGE_KEY = "litt:canvasBuilder:projectType";
const HISTORY_LIMIT = 50;

/** Per-project document key. `null` = the project-less creation session. */
export function docStorageKey(projectId: string | null): string {
  return `${STORAGE_KEY_PREFIX}:${projectId ?? "local"}`;
}

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
  rightPanelTab: "properties" | "litt";

  // Save state — truthful persistence tracking
  saveState: "local" | "dirty" | "saving" | "saved" | "error";
  serverCanvasId: string | null;
  setSaveState: (state: "local" | "dirty" | "saving" | "saved" | "error") => void;
  setServerCanvasId: (id: string | null) => void;

  // Project type system
  projectType: ProjectType;
  htmlProject: HtmlProject;
  setProjectType: (type: ProjectType) => void;
  updateHtmlFile: (name: string, content: string) => void;
  setActiveHtmlFile: (name: string) => void;
  setHtmlProject: (project: HtmlProject) => void;

  /** Classified canvas↔file state for the bound project (set by
   *  useCanvasFileSync after reads/applies). Drives the conflict banner. */
  canvasFileState: import("@/lib/studio/canvas-ssot").CanvasFileState | null;
  setCanvasFileState: (state: import("@/lib/studio/canvas-ssot").CanvasFileState | null) => void;
  /** A server write was rejected because the file changed elsewhere — the
   *  local document is preserved in localStorage but not overwriting. */
  syncConflict: string | null;
  setSyncConflict: (detail: string | null) => void;

  // Actions
  loadDocument: (projectId: string | null) => void;
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
  setRightPanelTab: (tab: "properties" | "litt") => void;
  addSectionTemplate: (template: SectionTemplate, parentId: string) => void;
  nudgeNode: (nodeId: string, dx: number, dy: number) => void;
  getNodePath: (nodeId: string) => CanvasNode[];
}

function saveToStorage(doc: CanvasDocument) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(docStorageKey(doc.projectId), JSON.stringify(doc));
  } catch {}
}

/**
 * Server-side canvas flush, registered by useCanvasFileSync while it is
 * mounted. saveDocument() invokes it so the toolbar Save button performs a
 * real workspace write — not just a localStorage update that can never be
 * retried.
 */
let canvasServerFlush: (() => void) | null = null;

export function setCanvasServerFlush(fn: (() => void) | null): void {
  canvasServerFlush = fn;
}

/**
 * Save to localStorage AND mark the document as dirty (unsaved to server).
 * Used by all mutation actions so the save badge stays truthful.
 */
function saveAndMarkDirty(doc: CanvasDocument) {
  saveToStorage(doc);
  // Mark as dirty unless we're already in "saving" state
  const current = useCanvasBuilderStore.getState();
  if (current.saveState !== "saving") {
    useCanvasBuilderStore.setState({ saveState: "dirty" });
  }
}

function saveProjectTypeToStorage(type: ProjectType) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PROJECT_TYPE_STORAGE_KEY, type);
  } catch {}
}

function loadProjectTypeFromStorage(): ProjectType | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROJECT_TYPE_STORAGE_KEY);
    if (!raw) return null;
    const valid: ProjectType[] = ["website", "html", "game2d", "game3d", "app", "component"];
    return valid.includes(raw as ProjectType) ? (raw as ProjectType) : null;
  } catch {
    return null;
  }
}

function isValidNodeType(type: unknown): type is NodeType {
  return typeof type === "string" && PALETTE_ITEMS.some((p) => p.type === type);
}

function normalizeNode(raw: unknown): CanvasNode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !isValidNodeType(r.type)) return null;
  const now = Date.now();
  return {
    id: r.id,
    type: r.type,
    parentId: typeof r.parentId === "string" ? r.parentId : null,
    children: Array.isArray(r.children) ? r.children.filter((c): c is string => typeof c === "string") : [],
    props: (r.props && typeof r.props === "object" ? r.props : {}) as CanvasNode["props"],
    styles: (r.styles && typeof r.styles === "object" ? r.styles : {}) as CanvasNode["styles"],
    metadata: (r.metadata && typeof r.metadata === "object" ? r.metadata : { createdAt: now, updatedAt: now }) as CanvasNode["metadata"],
  };
}

function normalizeDocument(parsed: Partial<CanvasDocument>): CanvasDocument | null {
  if (!parsed.nodes || !parsed.rootNodeIds) return null;
  if (!Array.isArray(parsed.rootNodeIds)) return null;

  // Validate and normalize each node record
  const normalizedNodes: Record<string, CanvasNode> = {};
  for (const [id, rawNode] of Object.entries(parsed.nodes)) {
    const normalized = normalizeNode(rawNode);
    if (normalized) normalizedNodes[id] = normalized;
  }

  // Filter root IDs to only those that exist in nodes
  const validRootIds = parsed.rootNodeIds.filter((id) => normalizedNodes[id]);
  if (validRootIds.length === 0) return null;

  // Repair: remove stale child references that point to non-existent nodes
  for (const node of Object.values(normalizedNodes)) {
    node.children = node.children.filter((childId) => normalizedNodes[childId]);
  }

  return {
    id: typeof parsed.id === "string" ? parsed.id : `doc-${Date.now()}`,
    projectId: parsed.projectId ?? null,
    conversationId: parsed.conversationId ?? null,
    route: parsed.route ?? "/",
    nodes: normalizedNodes,
    rootNodeIds: validRootIds,
    version: typeof parsed.version === "number" ? parsed.version : 1,
    updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    // Materialization/supersede records must survive the round-trip — dropping
    // them would make a clean canvas look unapplied and block publishing.
    materialization: parsed.materialization,
    status: parsed.status,
    supersededAt: parsed.supersededAt,
    supersededDocHash: parsed.supersededDocHash,
    supersededFileHash: parsed.supersededFileHash,
  };
}

/**
 * Read THIS project's localStorage document only. A namespaced entry whose
 * embedded projectId disagrees is foreign state — rejected, not adopted.
 */
export function loadFromStorage(projectId: string | null): CanvasDocument | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(docStorageKey(projectId));
    if (!raw) return null;
    const doc = normalizeDocument(JSON.parse(raw) as Partial<CanvasDocument>);
    if (!doc) return null;
    if (doc.projectId !== (projectId ?? null)) return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * One-time adoption of the pre-namespacing global document — only when its
 * embedded projectId matches the project asking for it. A foreign or
 * anonymous legacy doc is left in place, never attached to another project.
 */
function migrateLegacyDocument(projectId: string | null): CanvasDocument | null {
  if (typeof window === "undefined") return null;
  if (localStorage.getItem(docStorageKey(projectId))) return null;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const doc = normalizeDocument(JSON.parse(raw) as Partial<CanvasDocument>);
    if (!doc || doc.projectId !== (projectId ?? null)) return null;
    localStorage.setItem(docStorageKey(projectId), JSON.stringify(doc));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return doc;
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
  leftPanelTab: "build",
  rightPanelTab: "properties",

  // Save state — starts as "local" (localStorage only, not server-persisted)
  saveState: "local",
  serverCanvasId: null,
  setSaveState: (state) => set({ saveState: state }),
  setServerCanvasId: (id) => set({ serverCanvasId: id }),

  canvasFileState: null,
  setCanvasFileState: (state) => set({ canvasFileState: state }),
  syncConflict: null,
  setSyncConflict: (detail) => set({ syncConflict: detail }),

  // Project type system — load persisted project type from localStorage
  // (HTML project files are managed by useHtmlProjectSync, not here)
  projectType: loadProjectTypeFromStorage() ?? "website",
  htmlProject: createEmptyHtmlProject(),
  setProjectType: (type) => {
    saveProjectTypeToStorage(type);
    set({ projectType: type });
  },
  updateHtmlFile: (name, content) =>
    set((state) => ({
      htmlProject: {
        ...state.htmlProject,
        files: state.htmlProject.files.map((f) =>
          f.name === name ? { ...f, content } : f,
        ),
      },
    })),
  setActiveHtmlFile: (name) =>
    set((state) => ({
      htmlProject: { ...state.htmlProject, activeFile: name },
    })),
  setHtmlProject: (project) => set({ htmlProject: project }),

  loadDocument: (projectId) => {
    const stored = loadFromStorage(projectId) ?? migrateLegacyDocument(projectId);
    if (stored) {
      set({ document: stored, history: [{ document: stored, description: "Loaded", timestamp: Date.now() }], historyIndex: 0 });
    }
  },

  saveDocument: () => {
    saveToStorage(get().document);
    // Mark as saved locally — server save is a separate explicit action
    set({ saveState: get().serverCanvasId ? "saved" : "local" });
    canvasServerFlush?.();
  },

  setDocument: (doc) => {
    set({ document: doc, saveState: "dirty" });
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
    saveAndMarkDirty(newDoc);
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
    if (!parent) return;

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
    saveAndMarkDirty(newDoc);
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
    if (!oldParent) return;

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
    saveAndMarkDirty(newDoc);
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
    saveAndMarkDirty(newDoc);
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
    saveAndMarkDirty(newDoc);
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
    saveAndMarkDirty(newDoc);
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
    saveAndMarkDirty(newDoc);
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
    saveAndMarkDirty(newDoc);
  },

  undo: () => {
    const { history, historyIndex, document } = get();
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const entry = history[newIndex];
    // Never undo across a project boundary — a stale history entry from
    // another project would otherwise write that project's doc into this
    // project's canvas.
    if ((entry.document.projectId ?? null) !== (document.projectId ?? null)) return;
    set({ document: entry.document, historyIndex: newIndex, selectedNodeId: null });
    saveAndMarkDirty(entry.document);
  },

  redo: () => {
    const { history, historyIndex, document } = get();
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const entry = history[newIndex];
    if ((entry.document.projectId ?? null) !== (document.projectId ?? null)) return;
    set({ document: entry.document, historyIndex: newIndex, selectedNodeId: null });
    saveAndMarkDirty(entry.document);
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
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  addSectionTemplate: (template, parentId) => {
    // Collect every node the template creates — build() returns only
    // top-level children, and nested nodes would otherwise be silently
    // dropped from the document.
    const created: CanvasNode[] = [];
    const section = collectCreatedNodes(created, () => template.build().node);
    const doc = get().document;
    const parent = doc.nodes[parentId];
    if (!parent) return;
    const allNewNodes: Record<string, CanvasNode> = {};
    for (const node of created) {
      allNewNodes[node.id] = node;
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
    saveAndMarkDirty(newDoc);
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
    saveAndMarkDirty(newDoc);
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
