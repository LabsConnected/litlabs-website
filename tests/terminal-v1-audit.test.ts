import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { AuditService, createWorkspaceSnapshot } from "@/lib/terminal-v1/audit-service";
import type { AuditAction } from "@/lib/terminal-v1/audit-service";

const SECRET = "a".repeat(64);

// Mock Supabase client
function createMockSupabase() {
  const mockTable = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };

  const client = {
    from: vi.fn(() => mockTable),
  };

  return { client, mockTable };
}

describe("Terminal V1 — Audit Service", () => {
  beforeEach(() => {
    vi.stubEnv("TERMINAL_AUTH_SECRET", SECRET);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("log calls insert with correct fields", async () => {
    const { client, mockTable } = createMockSupabase();
    const service = new AuditService(client as never);

    await service.log({
      userId: "user-a",
      workspaceId: "ws-1",
      sandboxId: "sbx-1",
      action: "sandbox.create",
      details: { limits: { cpuVcpus: 1 } },
      ipAddress: "127.0.0.1",
    });

    expect(mockTable.insert).toHaveBeenCalledTimes(1);
    const insertArg = mockTable.insert.mock.calls[0][0];
    expect(insertArg.user_id).toBe("user-a");
    expect(insertArg.workspace_id).toBe("ws-1");
    expect(insertArg.sandbox_id).toBe("sbx-1");
    expect(insertArg.action).toBe("sandbox.create");
    expect(insertArg.details).toEqual({ limits: { cpuVcpus: 1 } });
    expect(insertArg.ip_address).toBe("127.0.0.1");
    expect(insertArg.audit_id).toMatch(/^audit-/);
  });

  it("log does not throw on error (best-effort)", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.insert.mockRejectedValueOnce(new Error("DB down"));

    const service = new AuditService(client as never);
    await expect(
      service.log({ userId: "user-a", action: "sandbox.create" }),
    ).resolves.toBeUndefined();
  });

  it("log with minimal fields (only required)", async () => {
    const { client, mockTable } = createMockSupabase();
    const service = new AuditService(client as never);

    await service.log({ userId: "user-a", action: "terminal.connect" });

    const insertArg = mockTable.insert.mock.calls[0][0];
    expect(insertArg.user_id).toBe("user-a");
    expect(insertArg.workspace_id).toBeNull();
    expect(insertArg.sandbox_id).toBeNull();
    expect(insertArg.details).toBeNull();
    expect(insertArg.ip_address).toBeNull();
  });

  it("listByUser calls query with user_id filter", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.limit.mockResolvedValueOnce({
      data: [
        {
          audit_id: "audit-1",
          user_id: "user-a",
          workspace_id: null,
          sandbox_id: "sbx-1",
          action: "sandbox.create",
          details: null,
          ip_address: null,
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    const service = new AuditService(client as never);
    const entries = await service.listByUser("user-a");

    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe("user-a");
    expect(entries[0].action).toBe("sandbox.create");
  });

  it("listBySandbox calls query with sandbox_id filter", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.limit.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const service = new AuditService(client as never);
    const entries = await service.listBySandbox("sbx-1");
    expect(entries).toHaveLength(0);
    expect(mockTable.eq).toHaveBeenCalledWith("sandbox_id", "sbx-1");
  });

  it("listByAction calls query with action filter", async () => {
    const { client, mockTable } = createMockSupabase();
    mockTable.limit.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const service = new AuditService(client as never);
    const action: AuditAction = "quota.exceeded";
    await service.listByAction(action);
    expect(mockTable.eq).toHaveBeenCalledWith("action", "quota.exceeded");
  });
});

describe("Terminal V1 — Workspace Snapshot", () => {
  it("createWorkspaceSnapshot captures workspace metadata", async () => {
    const snapshot = await createWorkspaceSnapshot({
      workspaceId: "ws-1",
      userId: "user-a",
      projectId: "proj-a",
      gitSource: "github",
      gitOwner: "owner",
      gitRepo: "repo",
      gitBranch: "main",
      lastCommitSha: "abc123",
      state: "ready",
    });

    expect(snapshot.workspaceId).toBe("ws-1");
    expect(snapshot.gitSource).toBe("github");
    expect(snapshot.gitOwner).toBe("owner");
    expect(snapshot.lastCommitSha).toBe("abc123");
    expect(snapshot.snapshotAt).toBeTruthy();
  });

  it("createWorkspaceSnapshot handles blank workspace", async () => {
    const snapshot = await createWorkspaceSnapshot({
      workspaceId: "ws-2",
      userId: "user-b",
      projectId: "proj-b",
      gitSource: "blank",
      gitOwner: null,
      gitRepo: null,
      gitBranch: null,
      lastCommitSha: null,
      state: "ready",
    });

    expect(snapshot.gitSource).toBe("blank");
    expect(snapshot.gitOwner).toBeNull();
    expect(snapshot.gitRepo).toBeNull();
  });
});
