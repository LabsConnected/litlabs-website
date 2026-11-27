import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({
  deleteProject: vi.fn(),
  getProject: vi.fn(),
  renameProject: vi.fn(),
}));

import { DELETE } from "./route";
import { auth } from "@/lib/auth";
import { deleteProject, getProject } from "@/lib/projects/project-repository";

const mockAuth = vi.mocked(auth);
const mockGetProject = vi.mocked(getProject);
const mockDeleteProject = vi.mocked(deleteProject);
const PROJECT_ID = "project-owned-by-user";
const USER_ID = "user-owner";
const params = { params: Promise.resolve({ projectId: PROJECT_ID }) };

function request(): NextRequest {
  return new NextRequest(`http://localhost/api/studio-projects/${PROJECT_ID}`, {
    method: "DELETE",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: USER_ID, clerkId: "clerk-owner" });
  mockGetProject.mockResolvedValue({ id: PROJECT_ID, userId: USER_ID } as never);
  mockDeleteProject.mockResolvedValue(true);
});

describe("DELETE /api/studio-projects/[projectId]", () => {
  it("rejects unauthenticated requests before looking up or deleting a project", async () => {
    mockAuth.mockResolvedValue({ userId: null, clerkId: null });

    const response = await DELETE(request(), params);

    expect(response.status).toBe(401);
    expect(mockGetProject).not.toHaveBeenCalled();
    expect(mockDeleteProject).not.toHaveBeenCalled();
  });

  it("returns a non-disclosing 404 for a project the caller does not own", async () => {
    mockGetProject.mockResolvedValue(null);

    const response = await DELETE(request(), params);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Project not found" });
    expect(mockGetProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
    expect(mockDeleteProject).not.toHaveBeenCalled();
  });

  it("deletes only after the caller-owned project has been verified", async () => {
    const response = await DELETE(request(), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mockGetProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
    expect(mockDeleteProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
  });

  it("returns 404 when the canonical registration cannot be removed", async () => {
    mockDeleteProject.mockResolvedValue(false);

    const response = await DELETE(request(), params);

    expect(response.status).toBe(404);
    expect(mockDeleteProject).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
  });
});
