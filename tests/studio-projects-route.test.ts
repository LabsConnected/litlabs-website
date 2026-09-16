// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createBlankProject: vi.fn(),
  createGithubProject: vi.fn(),
  getProject: vi.fn(),
  provisionWorkspaceForProject: vi.fn(),
  getInstallationOctokit: vi.fn(),
  getRepository: vi.fn(),
  supabaseFrom: vi.fn(),
  selectInstallation: vi.fn(),
  filterInstallation: vi.fn(),
  singleInstallation: vi.fn(),
  installationResult: {
    data: { installation_id: 123 },
    error: null as { message: string } | null,
  },
  PROJECT_TEMPLATES: {
    "blank-static": { name: "Blank Static" },
    "empty-static": { name: "Empty Static" },
  } as Record<string, { name: string }>,
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/github-app", () => ({
  getInstallationOctokit: mocks.getInstallationOctokit,
}));
vi.mock("@/lib/projects/project-repository", () => ({
  createBlankProject: mocks.createBlankProject,
  createGithubProject: mocks.createGithubProject,
  getProject: mocks.getProject,
  listProjects: vi.fn(),
  PROJECT_TEMPLATES: mocks.PROJECT_TEMPLATES,
}));
vi.mock("@/lib/studio/workspace-recovery", () => ({
  provisionWorkspaceForProject: mocks.provisionWorkspaceForProject,
}));
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: (() => {
    const query = {
      select: mocks.selectInstallation,
      eq: mocks.filterInstallation,
      single: mocks.singleInstallation,
    };
    mocks.supabaseFrom.mockReturnValue(query);
    mocks.selectInstallation.mockReturnValue(query);
    mocks.filterInstallation.mockReturnValue(query);
    mocks.singleInstallation.mockImplementation(() =>
      Promise.resolve(mocks.installationResult),
    );
    return { from: mocks.supabaseFrom };
  })(),
}));

const { POST } = await import("@/app/api/studio-projects/route");

const githubProject = {
  sourceType: "github",
  name: "Private project",
  githubInstallationId: 123,
  githubRepositoryId: 456,
  githubOwner: "acme",
  githubRepo: "private-repo",
  githubFullName: "acme/private-repo",
};

function request(body: Record<string, unknown> = githubProject) {
  return new NextRequest("http://localhost/api/studio-projects", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "user-1", clerkId: "user-1" });
  mocks.installationResult.data = { installation_id: 123 };
  mocks.installationResult.error = null;
  mocks.getRepository.mockResolvedValue({
    data: {
      id: 456,
      owner: { login: "canonical-owner" },
      name: "canonical-repo",
      full_name: "canonical-owner/canonical-repo",
      default_branch: "trunk",
    },
  });
  mocks.getInstallationOctokit.mockResolvedValue({
    rest: { repos: { get: mocks.getRepository } },
  });
  mocks.createGithubProject.mockResolvedValue({ id: "project-1" });
});

describe("POST /api/studio-projects GitHub authorization", () => {
  it("rejects an installation not owned by the authenticated user", async () => {
    mocks.installationResult.data = null as unknown as { installation_id: number };
    mocks.installationResult.error = { message: "not found" };

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Installation not found" });
    expect(mocks.getInstallationOctokit).not.toHaveBeenCalled();
    expect(mocks.createGithubProject).not.toHaveBeenCalled();
  });

  it("rejects a repository ID that does not match the accessible repository", async () => {
    mocks.getRepository.mockResolvedValue({ data: { id: 999 } });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Repository ID mismatch" });
    expect(mocks.createGithubProject).not.toHaveBeenCalled();
  });

  it("rejects a repository the installation cannot access", async () => {
    mocks.getRepository.mockRejectedValue(new Error("forbidden"));

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Repository not accessible through this installation",
    });
    expect(mocks.createGithubProject).not.toHaveBeenCalled();
  });

  it("creates a project only after ownership and repository access are verified", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.supabaseFrom).toHaveBeenCalledWith("github_installations");
    expect(mocks.filterInstallation).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(mocks.filterInstallation).toHaveBeenNthCalledWith(2, "installation_id", 123);
    expect(mocks.getInstallationOctokit).toHaveBeenCalledWith(123);
    expect(mocks.getRepository).toHaveBeenCalledWith({
      owner: "acme",
      repo: "private-repo",
    });
    expect(mocks.getRepository.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createGithubProject.mock.invocationCallOrder[0],
    );
    expect(mocks.createGithubProject).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        githubInstallationId: 123,
        githubRepositoryId: 456,
        githubOwner: "canonical-owner",
        githubRepo: "canonical-repo",
        githubFullName: "canonical-owner/canonical-repo",
        githubDefaultBranch: "trunk",
        githubBranch: "trunk",
      }),
    );
  });
});

describe("POST /api/studio-projects managed create-time provisioning", () => {
  const managedBody = {
    sourceType: "managed",
    name: "Managed Project",
    templateId: "blank-static",
  };

  it("provisions durable source as part of project creation", async () => {
    mocks.createBlankProject.mockResolvedValue({ id: "proj-managed-1" });
    mocks.provisionWorkspaceForProject.mockResolvedValue("ws-proj-managed-1");
    mocks.getProject.mockResolvedValue({
      id: "proj-managed-1",
      workspaceId: "ws-proj-managed-1",
      workspaceStatus: "ready",
      workspaceBranch: "main",
    });

    const response = await POST(request(managedBody));

    expect(response.status).toBe(201);
    expect(mocks.createBlankProject).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", name: "Managed Project" }),
    );
    expect(mocks.provisionWorkspaceForProject).toHaveBeenCalledWith(
      "proj-managed-1",
      "user-1",
    );
    const body = await response.json();
    expect(body.project.workspaceStatus).toBe("ready");
    expect(body.project.workspaceBranch).toBe("main");
  });

  it("still accepts sourceType blank and provisions it", async () => {
    mocks.createBlankProject.mockResolvedValue({ id: "proj-blank-1" });
    mocks.provisionWorkspaceForProject.mockResolvedValue("ws-proj-blank-1");
    mocks.getProject.mockResolvedValue({
      id: "proj-blank-1",
      workspaceStatus: "ready",
    });

    const response = await POST(request({ ...managedBody, sourceType: "blank" }));

    expect(response.status).toBe(201);
    expect(mocks.provisionWorkspaceForProject).toHaveBeenCalledWith(
      "proj-blank-1",
      "user-1",
    );
  });

  it("accepts the explicit empty-static template without changing project routing", async () => {
    mocks.createBlankProject.mockResolvedValue({ id: "proj-empty-1" });
    mocks.provisionWorkspaceForProject.mockResolvedValue("ws-proj-empty-1");
    mocks.getProject.mockResolvedValue({
      id: "proj-empty-1",
      workspaceStatus: "ready",
    });

    const response = await POST(request({
      ...managedBody,
      templateId: "empty-static",
    }));

    expect(response.status).toBe(201);
    expect(mocks.createBlankProject).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: "empty-static" }),
    );
  });

  it("returns the project truthfully when provisioning fails", async () => {
    mocks.createBlankProject.mockResolvedValue({ id: "proj-fail-1" });
    mocks.provisionWorkspaceForProject.mockRejectedValue(
      new Error("terminal-server unreachable"),
    );
    mocks.getProject.mockResolvedValue({
      id: "proj-fail-1",
      workspaceStatus: "failed",
      workspaceError: "terminal-server unreachable",
    });

    const response = await POST(request(managedBody));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.project.workspaceStatus).toBe("failed");
  });
});
