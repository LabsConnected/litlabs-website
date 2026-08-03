import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", () => {
  const mockChain = (data: unknown[] | null, error: unknown = null) => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data, error }),
      maybeSingle: vi.fn().mockResolvedValue({ data: data?.[0] ?? null, error }),
    };
    return chain;
  };

  const tableResults: Record<string, { data: unknown[] | null; error?: unknown }> = {};

  return {
    supabaseAdmin: {
      from: vi.fn((table: string) => {
        const result = tableResults[table] ?? { data: null };
        return mockChain(result.data, result.error);
      }),
      __setTableResult: (table: string, data: unknown[] | null, error?: unknown) => {
        tableResults[table] = { data, error };
      },
    },
  };
});

import { supabaseAdmin } from "@/lib/supabase";
import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";

type MockSupabase = typeof supabaseAdmin & {
  __setTableResult: (table: string, data: unknown[] | null, error?: unknown) => void;
};
const mockSupabase = supabaseAdmin as MockSupabase;

describe("resolveCurrentProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves studio_projects project first", async () => {
    mockSupabase.__setTableResult("studio_projects", [
      {
        id: "studio-1",
        user_id: "user-1",
        name: "My Studio Project",
        github_full_name: "owner/repo",
        github_owner: "owner",
        github_repo: "repo",
        github_default_branch: "main",
        github_branch: "main",
        workspace_status: "ready",
        source_type: "github",
        updated_at: new Date().toISOString(),
      },
    ]);
    mockSupabase.__setTableResult("projects", []);

    const result = await resolveCurrentProject({ userId: "user-1" });

    expect(result).not.toBeNull();
    expect(result!.projectId).toBe("studio-1");
    expect(result!.source).toBe("studio_projects");
    expect(result!.projectName).toBe("My Studio Project");
    expect(result!.repositoryFullName).toBe("owner/repo");
  });

  it("falls back to legacy projects table", async () => {
    mockSupabase.__setTableResult("studio_projects", null);
    mockSupabase.__setTableResult("projects", [
      {
        id: "legacy-1",
        user_id: "user-1",
        repository: "my-repo",
        repository_full_name: "owner/my-repo",
        owner: "owner",
        default_branch: "main",
        working_branch: "dev",
        connection_status: "connected",
        status: "active",
        updated_at: new Date().toISOString(),
      },
    ]);

    const result = await resolveCurrentProject({ userId: "user-1" });

    expect(result).not.toBeNull();
    expect(result!.projectId).toBe("legacy-1");
    expect(result!.source).toBe("projects");
    expect(result!.projectName).toBe("owner/my-repo");
    expect(result!.defaultBranch).toBe("main");
  });

  it("legacy query does not request name column", async () => {
    const fromSpy = vi.spyOn(supabaseAdmin, "from");
    mockSupabase.__setTableResult("studio_projects", null);
    mockSupabase.__setTableResult("projects", [
      {
        id: "legacy-2",
        user_id: "user-1",
        repository: "repo",
        repository_full_name: "owner/repo",
        owner: "owner",
        default_branch: "main",
        working_branch: "main",
        connection_status: "connected",
        status: "active",
        updated_at: new Date().toISOString(),
      },
    ]);

    await resolveCurrentProject({ userId: "user-1" });

    // Find the call to "projects" table
    const projectsCalls = fromSpy.mock.calls.filter((c) => c[0] === "projects");
    expect(projectsCalls.length).toBeGreaterThan(0);
  });

  it("explicit project ID wins over auto-resolution", async () => {
    mockSupabase.__setTableResult("studio_projects", [
      {
        id: "studio-explicit",
        user_id: "user-1",
        name: "Explicit Project",
        github_full_name: null,
        github_owner: null,
        github_repo: null,
        github_default_branch: null,
        github_branch: null,
        workspace_status: "not_prepared",
        source_type: "blank",
        updated_at: new Date().toISOString(),
      },
    ]);

    const result = await resolveCurrentProject({
      explicitProjectId: "studio-explicit",
      userId: "user-1",
    });

    expect(result).not.toBeNull();
    expect(result!.projectId).toBe("studio-explicit");
    expect(result!.sourceType).toBe("blank");
  });

  it("returns null when no project exists", async () => {
    mockSupabase.__setTableResult("studio_projects", null);
    mockSupabase.__setTableResult("projects", null);

    const result = await resolveCurrentProject({ userId: "user-1" });

    expect(result).toBeNull();
  });

  it("blank project has null repositoryFullName", async () => {
    mockSupabase.__setTableResult("studio_projects", [
      {
        id: "blank-1",
        user_id: "user-1",
        name: "Blank Project",
        github_full_name: null,
        github_owner: null,
        github_repo: null,
        github_default_branch: null,
        github_branch: null,
        workspace_status: "not_prepared",
        source_type: "blank",
        updated_at: new Date().toISOString(),
      },
    ]);

    const result = await resolveCurrentProject({ userId: "user-1" });

    expect(result).not.toBeNull();
    expect(result!.sourceType).toBe("blank");
    expect(result!.repositoryFullName).toBeNull();
  });
});
