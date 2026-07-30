import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "user-123" })),
}));

// Mock supabase — only used for github_installations check
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === "github_installations") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: undefined,
          [Symbol.toPrimitive]: undefined,
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
    }),
  },
}));

// Mock resolveCurrentProject
vi.mock("@/lib/projects/resolve-current-project", () => ({
  resolveCurrentProject: vi.fn(),
}));

import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";

describe("/api/capabilities route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns projectId in the repository capability", async () => {
    vi.mocked(resolveCurrentProject).mockResolvedValue({
      projectId: "proj-123",
      projectName: "litlabs-website",
      source: "studio_projects",
      sourceType: "github",
      repositoryFullName: "litlabs/litlabs-website",
      repositoryOwner: "litlabs",
      repositoryName: "litlabs-website",
      defaultBranch: "main",
      workspaceStatus: "ready",
    });

    const { GET } = await import("./route");
    const response = await GET();
    const data = await response.json();

    const repoCap = data.capabilities.find(
      (c: { id: string }) => c.id === "repository",
    );
    expect(repoCap).toBeDefined();
    expect(repoCap.projectId).toBe("proj-123");
    expect(repoCap.projectName).toBe("litlabs-website");
    expect(repoCap.defaultBranch).toBe("main");
    expect(repoCap.status).toBe("ready");
    expect(repoCap.accountName).toBe("litlabs/litlabs-website");
  });

  it("returns a separate project capability", async () => {
    vi.mocked(resolveCurrentProject).mockResolvedValue({
      projectId: "proj-123",
      projectName: "litlabs-website",
      source: "studio_projects",
      sourceType: "github",
      repositoryFullName: "litlabs/litlabs-website",
      repositoryOwner: "litlabs",
      repositoryName: "litlabs-website",
      defaultBranch: "main",
      workspaceStatus: "ready",
    });

    const { GET } = await import("./route");
    const response = await GET();
    const data = await response.json();

    const projectCap = data.capabilities.find(
      (c: { id: string }) => c.id === "project",
    );
    expect(projectCap).toBeDefined();
    expect(projectCap.status).toBe("ready");
    expect(projectCap.projectId).toBe("proj-123");
  });

  it("blank project: repository not_configured but project ready", async () => {
    vi.mocked(resolveCurrentProject).mockResolvedValue({
      projectId: "blank-1",
      projectName: "Blank Project",
      source: "studio_projects",
      sourceType: "blank",
      repositoryFullName: null,
      repositoryOwner: null,
      repositoryName: null,
      defaultBranch: null,
      workspaceStatus: "not_prepared",
    });

    const { GET } = await import("./route");
    const response = await GET();
    const data = await response.json();

    const repoCap = data.capabilities.find(
      (c: { id: string }) => c.id === "repository",
    );
    const projectCap = data.capabilities.find(
      (c: { id: string }) => c.id === "project",
    );
    expect(repoCap.status).toBe("not_configured");
    expect(projectCap.status).toBe("ready");
    expect(projectCap.projectId).toBe("blank-1");
  });

  it("returns all four capability IDs", async () => {
    vi.mocked(resolveCurrentProject).mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET();
    const data = await response.json();

    const ids = data.capabilities.map((c: { id: string }) => c.id);
    expect(ids).toContain("auth");
    expect(ids).toContain("repository");
    expect(ids).toContain("project");
    expect(ids).toContain("runtime.sandbox");
  });
});
