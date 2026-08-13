import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

/**
 * Integration tests for the Studio rollback API route.
 *
 * These tests verify the route logic without a real Clerk session.
 * We mock auth() and executeProjectTool() to test:
 *   - Auth enforcement
 *   - Input validation
 *   - Successful rollback
 *   - Tool failure handling
 *   - Invalid SHA rejection
 */

// Mock Clerk auth
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

// Mock executeProjectTool
vi.mock("@/lib/project-tools/registry", () => ({
  executeProjectTool: vi.fn(),
}));

// Mock studioLog
vi.mock("@/lib/studio/logger", () => ({
  studioLog: vi.fn(),
}));

import { auth } from "@clerk/nextjs/server";
import { executeProjectTool } from "@/lib/project-tools/registry";

describe("POST /api/studio/rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as any);

    const req = new Request("http://localhost/api/studio/rollback", {
      method: "POST",
      body: JSON.stringify({ projectId: "test", sha: "abc1234" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when projectId is missing", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as any);

    const req = new Request("http://localhost/api/studio/rollback", {
      method: "POST",
      body: JSON.stringify({ sha: "abc1234" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("projectId is required");
  });

  it("returns 400 when sha is missing", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as any);

    const req = new Request("http://localhost/api/studio/rollback", {
      method: "POST",
      body: JSON.stringify({ projectId: "test-uuid" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("sha is required");
  });

  it("returns 400 when sha is invalid (not hex)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as any);

    const req = new Request("http://localhost/api/studio/rollback", {
      method: "POST",
      body: JSON.stringify({ projectId: "test-uuid", sha: "not-a-hash" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid commit hash");
  });

  it("returns 200 and success when tool succeeds", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as any);
    vi.mocked(executeProjectTool).mockResolvedValue({
      success: true,
      message: "Restored to checkpoint abc12345.",
      data: { sha: "abc12345" },
    } as any);

    const req = new Request("http://localhost/api/studio/rollback", {
      method: "POST",
      body: JSON.stringify({ projectId: "test-uuid", sha: "abc1234567" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sha).toBe("abc1234567");
    expect(executeProjectTool).toHaveBeenCalledWith("restore_checkpoint", "user_123", {
      project_id: "test-uuid",
      sha: "abc1234567",
    });
  });

  it("returns 400 when tool fails (e.g. project not found)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as any);
    vi.mocked(executeProjectTool).mockResolvedValue({
      success: false,
      message: "Project test-uuid not found.",
    } as any);

    const req = new Request("http://localhost/api/studio/rollback", {
      method: "POST",
      body: JSON.stringify({ projectId: "test-uuid", sha: "abc1234567" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Project test-uuid not found.");
  });

  it("returns 500 when executeProjectTool throws", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as any);
    vi.mocked(executeProjectTool).mockRejectedValue(new Error("Workspace unavailable"));

    const req = new Request("http://localhost/api/studio/rollback", {
      method: "POST",
      body: JSON.stringify({ projectId: "test-uuid", sha: "abc1234567" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Workspace unavailable");
  });

  it("accepts 7-character SHA (minimum valid length)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as any);
    vi.mocked(executeProjectTool).mockResolvedValue({
      success: true,
      message: "Restored.",
      data: { sha: "abc1234" },
    } as any);

    const req = new Request("http://localhost/api/studio/rollback", {
      method: "POST",
      body: JSON.stringify({ projectId: "test-uuid", sha: "abc1234" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("accepts 40-character SHA (full git hash)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as any);
    vi.mocked(executeProjectTool).mockResolvedValue({
      success: true,
      message: "Restored.",
      data: { sha: "a".repeat(40) },
    } as any);

    const req = new Request("http://localhost/api/studio/rollback", {
      method: "POST",
      body: JSON.stringify({ projectId: "test-uuid", sha: "a".repeat(40) }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("handles malformed JSON body gracefully", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as any);

    const req = new Request("http://localhost/api/studio/rollback", {
      method: "POST",
      body: "not json",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("projectId is required");
  });
});
