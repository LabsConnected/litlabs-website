import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase";
import { getProject } from "@/lib/projects/project-repository";
import { createConversation, getConversation, updateConversation } from "./conversation-service";
import { createStudioTask, getStudioTask, updateStudioTask } from "./task-service";
import {
  applyWorkspaceAction,
  defaultFrame,
  emptyWorkspaceDocument,
  nextZ,
  parseFrame,
  parseWorkspaceDocument,
  type Frame,
  type Relationship,
  type HttpWorkspaceAction,
  type ObjectPatch,
  type Viewport,
  type WorkspaceDocument,
  type WorkspaceObject,
} from "./workspace-document";

export type { HttpWorkspaceAction };

export class WorkspacePersistenceError extends Error {
  constructor(message = "The workspace table is not available yet. Apply the studio_workspaces migration, then reload.") {
    super(message);
    this.name = "WorkspacePersistenceError";
  }
}

export interface WorkspaceRecord {
  id: string;
  projectId: string;
  document: WorkspaceDocument;
  revision: number;
}

function admin() {
  const client = getSupabaseAdmin();
  if (!client) throw new WorkspacePersistenceError();
  return client;
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function getWorkspace(userId: string, projectId: string): Promise<WorkspaceRecord | null> {
  if (!(await getProject(projectId, userId))) return null;
  const { data, error } = await admin()
    .from("studio_workspaces")
    .select("id,project_id,document,revision")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new WorkspacePersistenceError();
  if (!data) {
    const created = await admin()
      .from("studio_workspaces")
      .insert({ user_id: userId, project_id: projectId, document: emptyWorkspaceDocument(), revision: 1 })
      .select("id,project_id,document,revision")
      .maybeSingle();
    if (created.error || !created.data) throw new WorkspacePersistenceError();
    return mapRow(created.data as Row);
  }
  return mapRow(data as Row);
}

interface Row {
  id: string;
  project_id: string;
  document: unknown;
  revision: number;
}

function mapRow(row: Row): WorkspaceRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    document: parseWorkspaceDocument(row.document),
    revision: Number(row.revision) || 1,
  };
}

async function save(userId: string, projectId: string, revision: number, document: WorkspaceDocument): Promise<WorkspaceRecord | "conflict" | null> {
  const { data, error } = await admin()
    .from("studio_workspaces")
    .update({ document, revision: revision + 1 })
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("revision", revision)
    .select("id,project_id,document,revision")
    .maybeSingle();
  if (error) throw new WorkspacePersistenceError();
  if (!data) return "conflict";
  return mapRow(data as Row);
}

export async function applyHttpWorkspaceAction(
  userId: string,
  projectId: string,
  revision: number,
  action: HttpWorkspaceAction,
): Promise<{ record: WorkspaceRecord; result: unknown } | { error: string; status: number; record?: WorkspaceRecord }> {
  const current = await getWorkspace(userId, projectId);
  if (!current) return { error: "Project not found", status: 403 };
  if (current.revision !== revision) return { error: "Stale revision", status: 409, record: current };

  if (action.type === "workspace.list") {
    const query = action.query?.trim().toLowerCase() ?? "";
    const objects = query
      ? current.document.objects.filter((object) => object.title.toLowerCase().includes(query) || object.type.includes(query))
      : current.document.objects;
    return { record: current, result: { objects, relationships: current.document.relationships } };
  }
  if (action.type === "workspace.read") {
    const object = current.document.objects.find((item) => item.id === action.id);
    if (!object) return { error: "Object not found", status: 404, record: current };
    const relationships = current.document.relationships.filter((item) => item.fromId === object.id || item.toId === object.id);
    return { record: current, result: { object, relationships } };
  }

  const resolved = await resolveAction(userId, projectId, current.document, action);
  if ("error" in resolved) return { error: resolved.error, status: resolved.status, record: current };
  const applied = applyWorkspaceAction(current.document, resolved.action);
  if (applied.error) return { error: applied.error, status: 400, record: current };
  const saved = await save(userId, projectId, revision, applied.doc);
  if (saved === "conflict") {
    const latest = await getWorkspace(userId, projectId);
    return { error: "Stale revision", status: 409, record: latest ?? current };
  }
  if (!saved) return { error: "Workspace save failed", status: 500, record: current };
  return { record: saved, result: resolved.result };
}

async function resolveAction(
  userId: string,
  projectId: string,
  doc: WorkspaceDocument,
  action: HttpWorkspaceAction,
): Promise<{ action: Parameters<typeof applyWorkspaceAction>[1]; result: unknown } | { error: string; status: number }> {
  switch (action.type) {
    case "workspace.create":
      return createObject(userId, projectId, doc, action);
    case "workspace.link": {
      const relationship = "fromId" in action
        ? { id: action.relationship?.id ?? newId("rel"), kind: "chat-task" as const, fromId: action.fromId, toId: action.toId }
        : { ...action.relationship, kind: "chat-task" as const };
      const linked = await syncTaskLink(userId, projectId, doc, relationship);
      if (linked.error) return { error: linked.error, status: linked.status ?? 400 };
      return { action: { type: "workspace.link", relationship }, result: { relationship } };
    }
    case "workspace.update": {
      const object = doc.objects.find((item) => item.id === action.id);
      if (!object) return { error: "Object not found", status: 404 };
      const title = action.title ?? action.patch?.title;
      if (title && object.type === "task" && typeof object.payload.taskId === "string") {
        const task = await getStudioTask(userId, object.payload.taskId);
        if (!task || task.projectId !== projectId) return { error: "Task not found", status: 403 };
        await updateStudioTask(userId, object.payload.taskId, { title });
      }
      if (title && object.type === "chat" && typeof object.payload.conversationId === "string") {
        const conversation = await getConversation(object.payload.conversationId, userId);
        if (!conversation || conversation.projectId !== projectId) return { error: "Conversation not found", status: 403 };
        await updateConversation(conversation.id, userId, conversation.revision, { title });
      }
      const patch: ObjectPatch = { ...(action.patch ?? {}) };
      if (action.title !== undefined) patch.title = action.title;
      if (action.frame) {
        const frame = parseFrame(action.frame);
        if (!frame) return { error: "Invalid frame", status: 400 };
        patch.frame = frame;
      }
      if (action.z !== undefined) patch.z = action.z;
      if (action.collapsed !== undefined) patch.collapsed = action.collapsed;
      if (action.accent !== undefined) patch.accent = action.accent;
      if (action.tags) patch.tags = action.tags;
      if (object.type === "note" && (action.noteBody !== undefined || action.noteLinks)) {
        patch.payload = {
          ...(patch.payload ?? {}),
          ...(action.noteBody !== undefined ? { body: action.noteBody.slice(0, 8000) } : {}),
          ...(action.noteLinks ? { links: action.noteLinks.slice(0, 20) } : {}),
        };
      }
      const owned = await assertOwnedPayload(userId, projectId, patch.payload);
      if (owned) return owned;
      return { action: { type: "workspace.update", id: action.id, patch }, result: { id: action.id } };
    }
    case "workspace.reorder":
      return { action: { type: "workspace.reorder", id: action.id, direction: action.direction }, result: { id: action.id } };
    case "workspace.delete":
      return { action: { type: "workspace.delete", id: action.id }, result: { id: action.id, unlinked: true } };
    case "workspace.unlink":
      return { action: { type: "workspace.unlink", id: action.id }, result: { id: action.id } };
    case "workspace.duplicate":
      return duplicateObject(userId, projectId, doc, action.id);
    case "workspace.focus":
      return { action: { type: "workspace.focus", id: action.id }, result: { id: action.id } };
    case "workspace.viewport":
      return { action: { type: "workspace.viewport", viewport: action.viewport }, result: { viewport: action.viewport } };
    case "workspace.restore": {
      const owned = await assertOwnedPayload(userId, projectId, action.object.payload);
      if (owned) return owned;
      return { action: { type: "workspace.restore", object: action.object, relationships: action.relationships ?? [] }, result: { id: action.object.id } };
    }
    default:
      return { error: "Unsupported action", status: 400 };
  }
}

async function createObject(
  userId: string,
  projectId: string,
  doc: WorkspaceDocument,
  action: Extract<HttpWorkspaceAction, { type: "workspace.create" }>,
): Promise<{ action: Parameters<typeof applyWorkspaceAction>[1]; result: unknown } | { error: string; status: number }> {
  const title = action.title?.trim().slice(0, 160) || (action.objectType === "chat" ? "Chat" : action.objectType === "task" ? "Task" : "Note");
  const frame = defaultFrame(doc.objects.length);
  const object: WorkspaceObject = {
    id: newId(action.objectType),
    type: action.objectType,
    title,
    z: nextZ(doc),
    collapsed: false,
    frame,
    accent: null,
    tags: [],
    payload: {},
  };
  let relationship: Relationship | undefined;
  if (action.objectType === "chat") {
    const conversation = await createConversation(userId, projectId, title, "litt");
    if (!conversation) return { error: "Conversation could not be created", status: 403 };
    object.payload = { conversationId: conversation.id };
  } else if (action.objectType === "task") {
    const link = action.linkToId ? doc.objects.find((item) => item.id === action.linkToId && item.type === "chat") : undefined;
    const conversationId = typeof link?.payload.conversationId === "string" ? link.payload.conversationId : null;
    const task = await createStudioTask(userId, { projectId, title, conversationId });
    if (!task) return { error: "Task could not be created", status: 403 };
    object.payload = { taskId: task.id };
    if (link) relationship = { id: newId("rel"), kind: "chat-task", fromId: link.id, toId: object.id };
  } else {
    object.payload = { body: "", links: [] };
  }
  return { action: { type: "workspace.create", object, relationship }, result: { object, relationship: relationship ?? null } };
}

async function duplicateObject(
  userId: string,
  projectId: string,
  doc: WorkspaceDocument,
  id: string,
): Promise<{ action: Parameters<typeof applyWorkspaceAction>[1]; result: unknown } | { error: string; status: number }> {
  const source = doc.objects.find((object) => object.id === id);
  if (!source) return { error: "Object not found", status: 404 };
  const copy: WorkspaceObject = {
    ...source,
    id: newId(source.type),
    title: `Copy of ${source.title}`.slice(0, 160),
    z: nextZ(doc),
    frame: { ...source.frame, x: source.frame.x + SNAP_OFFSET, y: source.frame.y + SNAP_OFFSET },
    tags: [...source.tags],
    payload: { ...source.payload },
  };
  if (source.type === "chat") {
    const conversation = await createConversation(userId, projectId, copy.title, "litt");
    if (!conversation) return { error: "Conversation could not be created", status: 403 };
    copy.payload = { conversationId: conversation.id };
  } else if (source.type === "task") {
    const task = await createStudioTask(userId, { projectId, title: copy.title });
    if (!task) return { error: "Task could not be created", status: 403 };
    copy.payload = { taskId: task.id };
  }
  return { action: { type: "workspace.create", object: copy }, result: { object: copy } };
}

const SNAP_OFFSET = 32;

async function syncTaskLink(
  userId: string,
  projectId: string,
  doc: WorkspaceDocument,
  relationship: Relationship,
): Promise<{ error?: string; status?: number }> {
  const from = doc.objects.find((object) => object.id === relationship.fromId);
  const to = doc.objects.find((object) => object.id === relationship.toId);
  const chat = from?.type === "chat" ? from : to?.type === "chat" ? to : null;
  const task = from?.type === "task" ? from : to?.type === "task" ? to : null;
  if (!chat || !task) return { error: "A link joins a chat and a task", status: 400 };
  const conversationId = chat.payload.conversationId;
  const taskId = task.payload.taskId;
  if (typeof conversationId !== "string" || typeof taskId !== "string") return { error: "Link is missing a conversation or task id", status: 400 };
  const conversation = await getConversation(conversationId, userId);
  if (!conversation || conversation.projectId !== projectId) return { error: "Conversation not found", status: 403 };
  const taskRow = await getStudioTask(userId, taskId);
  if (!taskRow || taskRow.projectId !== projectId) return { error: "Task not found", status: 403 };
  const updated = await updateStudioTask(userId, taskId, { conversationId });
  if (!updated) return { error: "Task link was rejected", status: 403 };
  relationship.fromId = chat.id;
  relationship.toId = task.id;
  return {};
}

async function assertOwnedPayload(
  userId: string,
  projectId: string,
  payload: Record<string, unknown> | undefined,
): Promise<{ error: string; status: number } | null> {
  if (!payload) return null;
  if (typeof payload.conversationId === "string") {
    const conversation = await getConversation(payload.conversationId, userId);
    if (!conversation || conversation.projectId !== projectId) return { error: "Conversation not found", status: 403 };
  }
  if (typeof payload.taskId === "string") {
    const task = await getStudioTask(userId, payload.taskId);
    if (!task || task.projectId !== projectId) return { error: "Task not found", status: 403 };
  }
  return null;
}

export async function readLinkedTask(userId: string, taskId: string) {
  return getStudioTask(userId, taskId);
}
