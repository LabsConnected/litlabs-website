import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { WorkspaceService } from "@/lib/terminal-v1/workspace-service";
import type { Workspace } from "@/lib/terminal-v1/types";

const SECRET = "a".repeat(64);

// Mock Supabase client
function createMockSupabase() {
  const mockTable = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  };

  const client = {
    from: vi.fn(() => mockTable),
  };

  return { client, mockTable };
}

describe("Terminal V1 — Workspace Service", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", SECRET);
    vi.stubEnv("TERMINAL_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("create returns existing workspace if one exists for user+project", async () => {
    const { client, mockTable } = createMockSupabase();
    const existingWorkspace: Partial<Workspace> = {
      workspaceId: "ws-existing",
      userId: "user-a",
      projectId: "proj-a",
      state: "ready",
    };

    // First call: getByUserAndProject returns existing
    mockTable.maybeSingle.mockResolvedValueOnce({
      data: {
        workspace_id: "ws-existing",
        user_id: "user-a",
        project_id: "proj-a",
        sandbox_provider: "managed-sandbox",
        current_sandbox_id: null,
        storage_volume_id: null,
        git_source: "blank",
        git_owner: null,
        git_repo: null,
        git_branch: null,
        last_commit_sha: null,
        state: "ready",
        failure_reason: null,
        storage_usage_bytes: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      },
      error: null,
    });

    const service = new WorkspaceService(client as never);
    const result = await service.create({
      userId: "user-a",
      projectId: "proj-a",
      gitSource: "blank",
    });

    expect(result.workspaceId).toBe("ws-existing");
    expect(result.state).toBe("ready");
  });

  it("create creates new workspace when none exists", async () => {
    const { client, mockTable } = createMockSupabase();

    // getByUserAndProject returns null
    mockTable.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    // insert returns the new row
    mockTable.single.mockResolvedValueOnce({
      data: {
        workspace_id: "ws-new",
        user_id: "user-a",
        project_id: "proj-a",
        sandbox_provider: "managed-sandbox",
        current_sandbox_id: null,
        storage_volume_id: null,
        git_source: "github",
        git_owner: "owner",
        git_repo: "repo",
        git_branch: "main",
        last_commit_sha: null,
        state: "initial",
        failure_reason: null,
        storage_usage_bytes: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      },
      error: null,
    });

    const service = new WorkspaceService(client as never);
    const result = await service.create({
      userId: "user-a",
      projectId: "proj-a",
      gitSource: "github",
      gitOwner: "owner",
      gitRepo: "repo",
      gitBranch: "main",
    });

    expect(result.workspaceId).toBe("ws-new");
    expect(result.state).toBe("initial");
    expect(result.gitSource).toBe("github");
    expect(result.gitOwner).toBe("owner");
  });

  it("getById returns null when not found", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.single.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116", message: "Not found" },
    });

    const service = new WorkspaceService(client as never);
    const result = await service.getById("ws-nonexistent");
    expect(result).toBeNull();
  });

  it("getById returns workspace when found", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.single.mockResolvedValueOnce({
      data: {
        workspace_id: "ws-found",
        user_id: "user-a",
        project_id: "proj-a",
        sandbox_provider: "managed-sandbox",
        current_sandbox_id: "sbx-1",
        storage_volume_id: "vol-1",
        git_source: "blank",
        git_owner: null,
        git_repo: null,
        git_branch: null,
        last_commit_sha: null,
        state: "ready",
        failure_reason: null,
        storage_usage_bytes: 1024,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      },
      error: null,
    });

    const service = new WorkspaceService(client as never);
    const result = await service.getById("ws-found");
    expect(result).not.toBeNull();
    expect(result!.workspaceId).toBe("ws-found");
    expect(result!.currentSandboxId).toBe("sbx-1");
  });

  it("update changes workspace state", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.single.mockResolvedValueOnce({
      data: {
        workspace_id: "ws-1",
        user_id: "user-a",
        project_id: "proj-a",
        sandbox_provider: "managed-sandbox",
        current_sandbox_id: "sbx-1",
        storage_volume_id: null,
        git_source: "blank",
        git_owner: null,
        git_repo: null,
        git_branch: null,
        last_commit_sha: "abc123",
        state: "ready",
        failure_reason: null,
        storage_usage_bytes: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      },
      error: null,
    });

    const service = new WorkspaceService(client as never);
    const result = await service.update("ws-1", {
      state: "ready",
      lastCommitSha: "abc123",
    });

    expect(result.state).toBe("ready");
    expect(result.lastCommitSha).toBe("abc123");
  });

  it("softDelete sets state to deleted and clears sandbox", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.single.mockResolvedValueOnce({
      data: {
        workspace_id: "ws-1",
        user_id: "user-a",
        project_id: "proj-a",
        sandbox_provider: "managed-sandbox",
        current_sandbox_id: null,
        storage_volume_id: null,
        git_source: "blank",
        git_owner: null,
        git_repo: null,
        git_branch: null,
        last_commit_sha: null,
        state: "deleted",
        failure_reason: null,
        storage_usage_bytes: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      },
      error: null,
    });

    const service = new WorkspaceService(client as never);
    const result = await service.softDelete("ws-1");
    expect(result.state).toBe("deleted");
    expect(result.currentSandboxId).toBeNull();
  });
});
