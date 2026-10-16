/**
 * POST /api/studio-projects — creation contract tests.
 *
 * Mocks auth, the repository layer, the GitHub App client, supabase, and
 * workspace provisioning; the request validation and error mapping stay
 * real.
 *
 * Run: npx vitest run src/app/api/studio-projects/route.create.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockSingle, mockGetRepos } = vi.hoisted(() => ({
  mockSingle: vi.fn(),
  mockGetRepos: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/project-repository", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/projects/project-repository")>();
  return {
    ...actual,
    createBlankProject: vi.fn(),
    createGithubProject: vi.fn(),
    listProjects: vi.fn(),
    getProject: vi.fn(),
  };
});
vi.mock("@/lib/github-app", () => ({
  getInstallationOctokit: vi.fn(async () => ({
    rest: { repos: { get: mockGetRepos } },
  })),
}));
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: mockSingle }) }) }),
    }),
  },
}));
vi.mock("@/lib/studio/workspace-recovery", () => ({
  provisionWorkspaceForProject: vi.fn(),
}));

// Route registers post-response provisioning via next/server after(). The
// real runtime drains it after the response is sent; tests run the callback
// eagerly (unawaited) so registration stays observable.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (callback: () => unknown) => {
      void callback();
    },
  };
});

import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import {
  createBlankProject,
  createGithubProject,
  getProject,
  listProjects,
  ProjectConflictError,
} from "@/lib/projects/project-repository";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";

const mockAuth = vi.mocked(auth);
const mockCreateBlank = vi.mocked(createBlankProject);
const mockCreateGithub = vi.mocked(createGithubProject);
const mockGetProject = vi.mocked(getProject);
const mockListProjects = vi.mocked(listProjects);
const mockProvision = vi.mocked(provisionWorkspaceForProject);

const USER = "user_123";

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/studio-projects", {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const GITHUB_BODY = {
  sourceType: "github",
  name: "acme/site",
  githubInstallationId: 111,
  githubRepositoryId: 4242,
  githubOwner: "acme",
  githubRepo: "site",
  githubFullName: "acme/site",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: USER, clerkId: "clerk_1" });
  mockListProjects.mockResolvedValue({ projects: [], legacyOnly: [] });
  mockCreateBlank.mockResolvedValue({ id: "p1", name: "My Site" } as never);
  mockCreateGithub.mockResolvedValue({ id: "p2", name: "acme/site" } as never);
  mockGetProject.mockResolvedValue({ id: "p1", name: "My Site", workspaceStatus: "ready" } as never);
  mockProvision.mockResolvedValue(undefined as never);
  mockSingle.mockResolvedValue({ data: { installation_id: 111 }, error: null });
  mockGetRepos.mockResolvedValue({
    data: {
      id: 4242,
      name: "site",
      full_name: "acme/site",
      owner: { login: "acme" },
      default_branch: "main",
    },
  });
});

describe("authentication", () => {
  it("401s GET when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null, clerkId: null });
    expect((await GET(req("GET"))).status).toBe(401);
  });

  it("401s POST when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null, clerkId: null });
    const res = await POST(req("POST", { sourceType: "blank", name: "x", templateId: "blank-static" }));
    expect(res.status).toBe(401);
    expect(mockCreateBlank).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  it("400s on an unparseable body", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/studio-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json{",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400s with an actionable message when sourceType is missing", async () => {
    const res = await POST(req("POST", { name: "x" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("sourceType");
  });

  it("400s on an empty name", async () => {
    const res = await POST(req("POST", { sourceType: "blank", name: "  ", templateId: "blank-static" }));
    expect(res.status).toBe(400);
    expect(mockCreateBlank).not.toHaveBeenCalled();
  });

  it("400s when templateId is missing for a managed create", async () => {
    const res = await POST(req("POST", { sourceType: "managed", name: "x" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("templateId");
  });

  it("400s on an unknown templateId and lists valid options", async () => {
    const res = await POST(req("POST", { sourceType: "blank", name: "x", templateId: "business-site" }));
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain("blank-static");
    expect(error).toContain("nextjs");
  });
});

describe("blank creation", () => {
  it("creates a project and provisions its workspace", async () => {
    const res = await POST(
      req("POST", { sourceType: "blank", name: "My Site", templateId: "blank-static" }),
    );
    expect(res.status).toBe(201);
    expect(mockCreateBlank).toHaveBeenCalledWith({
      userId: USER,
      name: "My Site",
      templateId: "blank-static",
      accessMode: "private",
      dedupeWithinMs: 30_000,
    });
    expect(mockProvision).toHaveBeenCalledWith("p1", USER);
    const payload = await res.json();
    expect(payload.project.workspaceStatus).toBe("ready");
  });

  it("still returns 201 truthfully when provisioning fails — workspace_status carries the failure", async () => {
    mockProvision.mockRejectedValue(new Error("terminal unreachable"));
    mockGetProject.mockResolvedValue({ id: "p1", workspaceStatus: "failed" } as never);
    const res = await POST(
      req("POST", { sourceType: "blank", name: "My Site", templateId: "blank-static" }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).project.workspaceStatus).toBe("failed");
  });
});

describe("github creation", () => {
  it("400s when required github fields are missing", async () => {
    const res = await POST(req("POST", { sourceType: "github", name: "x" }));
    expect(res.status).toBe(400);
    expect(mockCreateGithub).not.toHaveBeenCalled();
  });

  it("404s when the installation does not belong to the user", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "not found" } });
    const res = await POST(req("POST", GITHUB_BODY));
    expect(res.status).toBe(404);
  });

  it("400s when the verified repository id does not match", async () => {
    mockGetRepos.mockResolvedValue({ data: { id: 9999, name: "site", owner: { login: "acme" } } });
    const res = await POST(req("POST", GITHUB_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("mismatch");
  });

  it("409s with the existing project when the repository is already connected", async () => {
    mockCreateGithub.mockRejectedValue(
      new ProjectConflictError({ id: "p-existing", name: "acme/site", githubFullName: "acme/site" } as never),
    );
    const res = await POST(req("POST", GITHUB_BODY));
    expect(res.status).toBe(409);
    const payload = await res.json();
    expect(payload.error).toContain("already connected");
    expect(payload.projectId).toBe("p-existing");
  });

  it("creates a canonical github project with verified repo metadata", async () => {
    const res = await POST(req("POST", GITHUB_BODY));
    expect(res.status).toBe(201);
    expect(mockCreateGithub).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        githubInstallationId: 111,
        githubRepositoryId: 4242,
        githubOwner: "acme",
        githubRepo: "site",
        githubFullName: "acme/site",
        githubDefaultBranch: "main",
      }),
    );
  });
});
