// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { emptyWorkspaceDocument } from "@/lib/studio/workspace-document";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({ getProject: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/studio/conversation-service", () => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  updateConversation: vi.fn(),
}));
vi.mock("@/lib/studio/task-service", () => ({
  createStudioTask: vi.fn(),
  getStudioTask: vi.fn(),
  updateStudioTask: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getConversation } from "@/lib/studio/conversation-service";
import { getStudioTask } from "@/lib/studio/task-service";
import { GET, PUT } from "./route";

interface Row {
  id: string;
  project_id: string;
  document: unknown;
  revision: number;
}

let row: Row | null = null;
let failPersistence = false;

function supabase() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => (failPersistence ? { data: null, error: { message: "relation studio_workspaces does not exist" } } : { data: row, error: null }),
          }),
        }),
      }),
      insert: (payload: { project_id: string; document: unknown }) => ({
        select: () => ({
          maybeSingle: async () => {
            if (failPersistence) return { data: null, error: { message: "relation studio_workspaces does not exist" } };
            row = { id: "ws-1", project_id: payload.project_id, document: payload.document, revision: 1 };
            return { data: row, error: null };
          },
        }),
      }),
      update: (payload: { document: unknown; revision: number }) => ({
        eq: () => ({
          eq: () => ({
            eq: (_column: string, revision: number) => ({
              select: () => ({
                maybeSingle: async () => {
                  if (!row || row.revision !== revision) return { data: null, error: null };
                  row = { ...row, document: payload.document, revision: payload.revision };
                  return { data: row, error: null };
                },
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

function put(body: unknown) {
  return new NextRequest("http://localhost/api/studio/workspaces", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("/api/studio/workspaces", () => {
  beforeEach(() => {
    row = null;
    failPersistence = false;
    vi.mocked(auth).mockResolvedValue({ userId: "user-1", clerkId: "user-1" });
    vi.mocked(getProject).mockResolvedValue({ id: "project-1" } as never);
    vi.mocked(getSupabaseAdmin).mockReturnValue(supabase() as never);
    vi.mocked(getConversation).mockResolvedValue(null);
    vi.mocked(getStudioTask).mockResolvedValue(null);
  });

  it("returns 401 when the caller is signed out", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null, clerkId: null });
    const response = await GET(new NextRequest("http://localhost/api/studio/workspaces?projectId=project-1"));
    expect(response.status).toBe(401);
  });

  it("returns 403 when the project is not owned by the caller", async () => {
    vi.mocked(getProject).mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/studio/workspaces?projectId=project-1"));
    expect(response.status).toBe(403);
  });

  it("returns 400 when the body is missing a revision or action", async () => {
    const response = await PUT(put({ projectId: "project-1" }));
    expect(response.status).toBe(400);
  });

  it("returns 409 when the revision is stale", async () => {
    row = { id: "ws-1", project_id: "project-1", document: emptyWorkspaceDocument(), revision: 4 };
    const response = await PUT(put({
      projectId: "project-1",
      revision: 1,
      action: { type: "workspace.update", id: "missing", title: "Nope" },
    }));
    expect(response.status).toBe(409);
    expect(row.revision).toBe(4);
  });

  it("creates an empty workspace and saves a note", async () => {
    const loaded = await GET(new NextRequest("http://localhost/api/studio/workspaces?projectId=project-1"));
    expect(loaded.status).toBe(200);
    const saved = await PUT(put({
      projectId: "project-1",
      revision: 1,
      action: { type: "workspace.create", objectType: "note", title: "Scratch" },
    }));
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.revision).toBe(2);
    expect(body.document.objects[0]).toMatchObject({ type: "note", title: "Scratch" });
  });

  it("returns 503 when the workspace table is unavailable", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(null);
    const response = await GET(new NextRequest("http://localhost/api/studio/workspaces?projectId=project-1"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/migration/i);
  });

  it("rejects a conversation or task the caller does not own", async () => {
    row = { id: "ws-1", project_id: "project-1", document: emptyWorkspaceDocument(), revision: 1 };
    const object = {
      id: "chat-foreign",
      type: "chat",
      title: "Foreign",
      z: 1,
      collapsed: false,
      frame: { x: 48, y: 48, width: 360, height: 280 },
      accent: null,
      tags: [],
      payload: { conversationId: "conv-foreign" },
    };
    const response = await PUT(put({
      projectId: "project-1",
      revision: 1,
      action: { type: "workspace.restore", object, relationships: [] },
    }));
    expect(response.status).toBe(403);
    expect((row.document as { objects: unknown[] }).objects).toHaveLength(0);

    const taskResponse = await PUT(put({
      projectId: "project-1",
      revision: 1,
      action: {
        type: "workspace.restore",
        object: { ...object, id: "task-foreign", type: "task", payload: { taskId: "task-foreign" } },
        relationships: [],
      },
    }));
    expect(taskResponse.status).toBe(403);
  });
});
