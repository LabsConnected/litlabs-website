/**
 * Versioned spatial workspace document.
 * Pure: no I/O. The service and the client store both apply these actions.
 */

export const WORKSPACE_VERSION = 1;
export const SNAP_GRID = 8;
export const MIN_WINDOW_WIDTH = 280;
export const MIN_WINDOW_HEIGHT = 160;
export const MAX_WORKSPACE_OBJECTS = 200;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;

export const OBJECT_TYPES = ["chat", "task", "note", "terminal", "file", "preview", "artifact"] as const;
export type WorkspaceObjectType = (typeof OBJECT_TYPES)[number];

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkspaceObject {
  id: string;
  type: WorkspaceObjectType;
  title: string;
  z: number;
  collapsed: boolean;
  frame: Frame;
  accent: string | null;
  tags: string[];
  payload: Record<string, unknown>;
}

export interface Relationship {
  id: string;
  kind: "chat-task";
  fromId: string;
  toId: string;
}

export interface WorkspaceDocument {
  version: typeof WORKSPACE_VERSION;
  viewport: Viewport;
  objects: WorkspaceObject[];
  relationships: Relationship[];
}

export type ObjectPatch = Partial<Pick<WorkspaceObject, "title" | "z" | "collapsed" | "frame" | "accent" | "tags" | "payload">>;

export type HttpWorkspaceAction =
  | { type: "workspace.list"; query?: string }
  | { type: "workspace.read"; id: string }
  | { type: "workspace.create"; objectType: "chat" | "task" | "note"; title?: string; linkToId?: string }
  | { type: "workspace.link"; fromId: string; toId: string }
  | { type: "workspace.update"; id: string; title?: string; frame?: Frame; z?: number; collapsed?: boolean; accent?: string | null; tags?: string[]; noteBody?: string; noteLinks?: string[] }
  | { type: "workspace.delete"; id: string }
  | { type: "workspace.unlink"; id: string }
  | { type: "workspace.duplicate"; id: string }
  | { type: "workspace.focus"; id: string }
  | { type: "workspace.viewport"; viewport: Viewport }
  | { type: "workspace.restore"; object: WorkspaceObject; relationships?: Relationship[] };

export type WorkspaceAction =
  | { type: "workspace.create"; object: WorkspaceObject; relationship?: Relationship }
  | { type: "workspace.delete"; id: string }
  | { type: "workspace.restore"; object: WorkspaceObject; relationships: Relationship[] }
  | { type: "workspace.update"; id: string; patch: ObjectPatch }
  | { type: "workspace.link"; relationship: Relationship }
  | { type: "workspace.unlink"; id: string }
  | { type: "workspace.viewport"; viewport: Viewport }
  | { type: "workspace.focus"; id: string };

export function emptyWorkspaceDocument(): WorkspaceDocument {
  return {
    version: WORKSPACE_VERSION,
    viewport: { x: 0, y: 0, zoom: 1 },
    objects: [],
    relationships: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parseFrame(value: unknown, fallback?: Frame): Frame | null {
  if (!isRecord(value)) return fallback ?? null;
  const frame = {
    x: finite(value.x, fallback?.x ?? 0),
    y: finite(value.y, fallback?.y ?? 0),
    width: finite(value.width, fallback?.width ?? MIN_WINDOW_WIDTH),
    height: finite(value.height, fallback?.height ?? MIN_WINDOW_HEIGHT),
  };
  if (frame.width < MIN_WINDOW_WIDTH || frame.height < MIN_WINDOW_HEIGHT) return null;
  return frame;
}

export function parseWorkspaceDocument(value: unknown): WorkspaceDocument {
  const empty = emptyWorkspaceDocument();
  if (!isRecord(value)) return empty;
  const viewportRaw = isRecord(value.viewport) ? value.viewport : {};
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, finite(viewportRaw.zoom, 1)));
  const objects: WorkspaceObject[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.objects)) {
    for (const item of value.objects) {
      if (!isRecord(item)) continue;
      if (typeof item.id !== "string" || !item.id || seen.has(item.id)) continue;
      if (typeof item.type !== "string" || !OBJECT_TYPES.includes(item.type as WorkspaceObjectType)) continue;
      const frame = parseFrame(item.frame);
      if (!frame) continue;
      seen.add(item.id);
      objects.push({
        id: item.id,
        type: item.type as WorkspaceObjectType,
        title: typeof item.title === "string" && item.title.trim() ? item.title.trim().slice(0, 160) : "Untitled",
        z: finite(item.z, objects.length + 1),
        collapsed: item.collapsed === true,
        frame,
        accent: typeof item.accent === "string" ? item.accent.slice(0, 32) : null,
        tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 12) : [],
        payload: isRecord(item.payload) ? item.payload : {},
      });
      if (objects.length >= MAX_WORKSPACE_OBJECTS) break;
    }
  }
  const ids = new Set(objects.map((object) => object.id));
  const relationships: Relationship[] = [];
  if (Array.isArray(value.relationships)) {
    for (const item of value.relationships) {
      if (!isRecord(item)) continue;
      if (item.kind !== "chat-task") continue;
      if (typeof item.id !== "string" || typeof item.fromId !== "string" || typeof item.toId !== "string") continue;
      if (!ids.has(item.fromId) || !ids.has(item.toId)) continue;
      relationships.push({ id: item.id, kind: "chat-task", fromId: item.fromId, toId: item.toId });
    }
  }
  return {
    version: WORKSPACE_VERSION,
    viewport: { x: finite(viewportRaw.x, 0), y: finite(viewportRaw.y, 0), zoom },
    objects,
    relationships,
  };
}

export function nextZ(doc: WorkspaceDocument): number {
  return doc.objects.reduce((max, object) => Math.max(max, object.z), 0) + 1;
}

export function defaultFrame(index: number): Frame {
  const column = index % 4;
  const row = Math.floor(index / 4);
  return {
    x: 48 + column * (MIN_WINDOW_WIDTH + 32),
    y: 48 + row * (MIN_WINDOW_HEIGHT + 32),
    width: 360,
    height: 280,
  };
}

function clone(doc: WorkspaceDocument): WorkspaceDocument {
  return {
    version: WORKSPACE_VERSION,
    viewport: { ...doc.viewport },
    objects: doc.objects.map((object) => ({ ...object, frame: { ...object.frame }, tags: [...object.tags], payload: { ...object.payload } })),
    relationships: doc.relationships.map((item) => ({ ...item })),
  };
}

export function applyWorkspaceAction(doc: WorkspaceDocument, action: WorkspaceAction): { doc: WorkspaceDocument; error?: string } {
  const next = clone(doc);
  switch (action.type) {
    case "workspace.create": {
      if (next.objects.some((object) => object.id === action.object.id)) return { doc, error: "Object already exists" };
      if (next.objects.length >= MAX_WORKSPACE_OBJECTS) return { doc, error: "Workspace is full" };
      if (!parseFrame(action.object.frame)) return { doc, error: "Invalid frame" };
      next.objects.push({
        ...action.object,
        frame: { ...action.object.frame },
        tags: [...action.object.tags],
        payload: { ...action.object.payload },
        z: action.object.z || nextZ(next),
      });
      if (action.relationship) next.relationships.push({ ...action.relationship });
      return { doc: next };
    }
    case "workspace.delete": {
      if (!next.objects.some((object) => object.id === action.id)) return { doc, error: "Object not found" };
      next.objects = next.objects.filter((object) => object.id !== action.id);
      next.relationships = next.relationships.filter((item) => item.fromId !== action.id && item.toId !== action.id);
      return { doc: next };
    }
    case "workspace.restore": {
      if (next.objects.some((object) => object.id === action.object.id)) return { doc, error: "Object already exists" };
      next.objects.push({ ...action.object, frame: { ...action.object.frame }, tags: [...action.object.tags], payload: { ...action.object.payload } });
      for (const relationship of action.relationships) {
        if (next.objects.some((object) => object.id === relationship.fromId) && next.objects.some((object) => object.id === relationship.toId)) {
          next.relationships.push({ ...relationship });
        }
      }
      return { doc: next };
    }
    case "workspace.update": {
      const object = next.objects.find((item) => item.id === action.id);
      if (!object) return { doc, error: "Object not found" };
      if (action.patch.title !== undefined) object.title = action.patch.title.trim().slice(0, 160) || object.title;
      if (action.patch.z !== undefined) object.z = action.patch.z;
      if (action.patch.collapsed !== undefined) object.collapsed = action.patch.collapsed;
      if (action.patch.accent !== undefined) object.accent = action.patch.accent;
      if (action.patch.tags !== undefined) object.tags = [...action.patch.tags];
      if (action.patch.frame) {
        const frame = parseFrame(action.patch.frame, object.frame);
        if (!frame) return { doc, error: "Invalid frame" };
        object.frame = frame;
      }
      if (action.patch.payload) object.payload = { ...object.payload, ...action.patch.payload };
      return { doc: next };
    }
    case "workspace.link": {
      const from = next.objects.find((object) => object.id === action.relationship.fromId);
      const to = next.objects.find((object) => object.id === action.relationship.toId);
      if (!from || !to) return { doc, error: "Link endpoints are missing" };
      const chat = from.type === "chat" ? from : to.type === "chat" ? to : null;
      const task = from.type === "task" ? from : to.type === "task" ? to : null;
      if (!chat || !task) return { doc, error: "A link joins a chat and a task" };
      if (next.relationships.some((item) => item.fromId === chat.id && item.toId === task.id)) return { doc: next };
      next.relationships.push({ id: action.relationship.id, kind: "chat-task", fromId: chat.id, toId: task.id });
      return { doc: next };
    }
    case "workspace.unlink": {
      if (!next.relationships.some((item) => item.id === action.id)) return { doc, error: "Link not found" };
      next.relationships = next.relationships.filter((item) => item.id !== action.id);
      return { doc: next };
    }
    case "workspace.viewport": {
      next.viewport = {
        x: finite(action.viewport.x, next.viewport.x),
        y: finite(action.viewport.y, next.viewport.y),
        zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, finite(action.viewport.zoom, next.viewport.zoom))),
      };
      return { doc: next };
    }
    case "workspace.focus": {
      const object = next.objects.find((item) => item.id === action.id);
      if (!object) return { doc, error: "Object not found" };
      object.z = nextZ(next);
      object.collapsed = false;
      return { doc: next };
    }
    default:
      return { doc, error: "Unknown action" };
  }
}

export function inverseWorkspaceAction(doc: WorkspaceDocument, action: WorkspaceAction): WorkspaceAction | null {
  switch (action.type) {
    case "workspace.create":
      return { type: "workspace.delete", id: action.object.id };
    case "workspace.delete": {
      const object = doc.objects.find((item) => item.id === action.id);
      if (!object) return null;
      return {
        type: "workspace.restore",
        object,
        relationships: doc.relationships.filter((item) => item.fromId === action.id || item.toId === action.id),
      };
    }
    case "workspace.restore":
      return { type: "workspace.delete", id: action.object.id };
    case "workspace.update": {
      const object = doc.objects.find((item) => item.id === action.id);
      if (!object || !action.patch) return null;
      const patch: ObjectPatch = {};
      if (action.patch.title !== undefined) patch.title = object.title;
      if (action.patch.z !== undefined) patch.z = object.z;
      if (action.patch.collapsed !== undefined) patch.collapsed = object.collapsed;
      if (action.patch.accent !== undefined) patch.accent = object.accent;
      if (action.patch.tags !== undefined) patch.tags = [...object.tags];
      if (action.patch.frame) patch.frame = { ...object.frame };
      if (action.patch.payload) {
        const payload: Record<string, unknown> = {};
        for (const key of Object.keys(action.patch.payload)) payload[key] = object.payload[key];
        patch.payload = payload;
      }
      return { type: "workspace.update", id: action.id, patch };
    }
    case "workspace.link":
      return { type: "workspace.unlink", id: action.relationship.id };
    case "workspace.unlink": {
      const relationship = doc.relationships.find((item) => item.id === action.id);
      return relationship ? { type: "workspace.link", relationship } : null;
    }
    case "workspace.viewport":
      return { type: "workspace.viewport", viewport: { ...doc.viewport } };
    case "workspace.focus": {
      const object = doc.objects.find((item) => item.id === action.id);
      if (!object) return null;
      return { type: "workspace.update", id: action.id, patch: { z: object.z, collapsed: object.collapsed } };
    }
    default:
      return null;
  }
}

const FENCE = /```workspace-action\s*\n([\s\S]*?)```/;

export function parseHttpWorkspaceAction(value: unknown): HttpWorkspaceAction | null {
  if (!value || typeof value !== "object") return null;
  const action = value as Record<string, unknown>;
  if (action.type === "workspace.create" && (action.objectType === "chat" || action.objectType === "task" || action.objectType === "note")) {
    return {
      type: "workspace.create",
      objectType: action.objectType,
      title: typeof action.title === "string" ? action.title : undefined,
      linkToId: typeof action.linkToId === "string" ? action.linkToId : undefined,
    };
  }
  if (action.type === "workspace.link" && typeof action.fromId === "string" && typeof action.toId === "string") {
    return { type: "workspace.link", fromId: action.fromId, toId: action.toId };
  }
  if (action.type === "workspace.focus" && typeof action.id === "string") return { type: "workspace.focus", id: action.id };
  if (action.type === "workspace.update" && typeof action.id === "string") {
    const frame = action.frame && typeof action.frame === "object" ? parseFrame(action.frame) : null;
    return {
      type: "workspace.update",
      id: action.id,
      title: typeof action.title === "string" ? action.title : undefined,
      frame: frame ?? undefined,
    };
  }
  return null;
}

export function extractWorkspaceActionBlock(text: string): unknown | null {
  const match = text.match(FENCE);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export const WORKSPACE_ACTION_INSTRUCTIONS = `Workspace canvas: when the user asks you to create, link, move, or focus a chat, task, or note on the Studio workspace, end your reply with one fenced block and nothing after it:
\`\`\`workspace-action
{"type":"workspace.create","objectType":"chat","title":"Name"}
\`\`\`
Allowed types are workspace.create (objectType chat, task, or note; optional title and linkToId), workspace.link (fromId, toId), workspace.focus (id), and workspace.update (id plus title or frame). Do not claim the window exists until the workspace confirms the action. Do not invent terminal output, files, diffs, or previews.`;
