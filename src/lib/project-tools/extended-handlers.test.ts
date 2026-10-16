/**
 * Agent create_project tool — regression test.
 *
 * The tool must provision the durable workspace at create time, matching
 * POST /api/studio-projects — an unprovisioned project opens broken.
 *
 * Run: npx vitest run src/lib/project-tools/extended-handlers.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/projects/project-repository", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/projects/project-repository")>();
  return {
    ...actual,
    createBlankProject: vi.fn(),
    listProjects: vi.fn(),
    getProject: vi.fn(),
  };
});
vi.mock("@/lib/studio/workspace-recovery", () => ({
  provisionWorkspaceForProject: vi.fn(),
}));
vi.mock("@/lib/file-audit", () => ({ logFileOperation: vi.fn() }));
vi.mock("@/lib/github-pat", () => ({ getUserGitHubOctokit: vi.fn() }));
vi.mock("@/lib/studio/memory-service", () => ({ recallMemories: vi.fn() }));
vi.mock("@/lib/project-tools/registry", () => ({
  runWorkspaceCommand: vi.fn(),
  workspaceDeleteFile: vi.fn(),
  workspaceMkdir: vi.fn(),
  workspaceRename: vi.fn(),
  workspaceApplyPatch: vi.fn(),
}));

import { toolCreateProject } from "./extended-handlers";
import { createBlankProject } from "@/lib/projects/project-repository";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";

const mockCreate = vi.mocked(createBlankProject);
const mockProvision = vi.mocked(provisionWorkspaceForProject);

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ id: "proj-1", name: "My Site" } as never);
  mockProvision.mockResolvedValue(undefined as never);
});

describe("toolCreateProject", () => {
  it("creates a project and provisions its workspace", async () => {
    const result = await toolCreateProject("user-A", { name: "My Site", template_id: "blank-static" });
    expect(result.success).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-A", name: "My Site", templateId: "blank-static" }),
    );
    expect(mockProvision).toHaveBeenCalledWith("proj-1", "user-A");
    expect(result.projectId).toBe("proj-1");
  });

  it("still reports success when provisioning fails — workspace_status carries it", async () => {
    mockProvision.mockRejectedValue(new Error("terminal down"));
    const result = await toolCreateProject("user-A", { name: "My Site" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid template before touching the database", async () => {
    const result = await toolCreateProject("user-A", { name: "My Site", template_id: "business-site" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid template_id");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing name", async () => {
    const result = await toolCreateProject("user-A", {});
    expect(result.success).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
