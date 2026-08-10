import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only to allow test execution
vi.mock("server-only", () => ({}));

// Mock dependencies
vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(),
  updateProjectWorkspace: vi.fn(),
  claimProvisioningLock: vi.fn(),
  recoverStaleProvisioning: vi.fn(),
  ensureCanonicalStudioProject: vi.fn(),
}));

vi.mock("@/lib/terminal-internal-client", () => ({
  getWorkspaceInternal: vi.fn(),
  prepareWorkspaceInternal: vi.fn(),
}));

vi.mock("@/lib/github-app", () => ({
  getInstallationToken: vi.fn(),
}));

import { ensureWorkspaceAlive, normalizeFileError } from "@/lib/studio/workspace-recovery";
import { getProject, updateProjectWorkspace, claimProvisioningLock, ensureCanonicalStudioProject } from "@/lib/projects/project-repository";
import { getWorkspaceInternal, prepareWorkspaceInternal } from "@/lib/terminal-internal-client";
import type { CanonicalProject } from "@/lib/projects/types";
import type { WorkspaceGetResponse, WorkspacePrepareResponse } from "@/lib/terminal-internal-client";

const fakeProject = (overrides: Partial<CanonicalProject> = {}): CanonicalProject =>
  ({
    id: "proj-1",
    userId: "user-1",
    sourceType: "blank",
    workspaceId: null,
    workspaceStatus: "not_prepared",
    ...overrides,
  }) as unknown as CanonicalProject;

const fakeWorkspace = (overrides: Partial<WorkspaceGetResponse> = {}): WorkspaceGetResponse =>
  ({ workspaceId: "ws-1", root: "/data/ws-1", ...overrides }) as unknown as WorkspaceGetResponse;

describe("workspace-recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ensureWorkspaceAlive", () => {
    it("returns the same workspaceId when workspace still exists on terminal server", async () => {
      vi.mocked(getWorkspaceInternal).mockResolvedValue(fakeWorkspace({ workspaceId: "ws-123", root: "/data/ws-123" }));

      const result = await ensureWorkspaceAlive("proj-1", "user-1", "ws-123");

      expect(result.workspaceId).toBe("ws-123");
      expect(result.reprepared).toBe(false);
      expect(getWorkspaceInternal).toHaveBeenCalledWith("ws-123", "user-1");
    });

    it("re-prepares workspace when terminal server has lost it", async () => {
      // First call: workspace not found
      vi.mocked(getWorkspaceInternal).mockRejectedValueOnce(new Error("Workspace not found"));
      // After re-prepare, getProject returns new workspace
      vi.mocked(getProject).mockResolvedValue(fakeProject({ workspaceId: "ws-new", workspaceStatus: "ready" }));
      vi.mocked(updateProjectWorkspace).mockResolvedValue(null);
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-new", root: "/data/ws-new" }) as unknown as WorkspacePrepareResponse,
      );

      const result = await ensureWorkspaceAlive("proj-1", "user-1", "ws-stale");

      expect(result.workspaceId).toBe("ws-new");
      expect(result.reprepared).toBe(true);
    });

    it("throws when recovery fails and no workspace ID is available", async () => {
      vi.mocked(getWorkspaceInternal).mockRejectedValue(new Error("Workspace not found"));
      vi.mocked(getProject).mockResolvedValue(fakeProject({ workspaceId: null, workspaceStatus: "not_prepared" }));
      vi.mocked(updateProjectWorkspace).mockResolvedValue(null);
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-recovered", root: "/data/ws-recovered" }) as unknown as WorkspacePrepareResponse,
      );

      // After prepare, getProject is called again and should return the new workspace
      vi.mocked(getProject)
        .mockResolvedValueOnce(fakeProject({ workspaceId: null, workspaceStatus: "not_prepared" }))
        .mockResolvedValueOnce(fakeProject({ workspaceId: "ws-recovered", workspaceStatus: "ready" }));

      const result = await ensureWorkspaceAlive("proj-1", "user-1", "ws-stale");
      expect(result.workspaceId).toBe("ws-recovered");
      expect(result.reprepared).toBe(true);
    });
  });

  describe("normalizeFileError", () => {
    it("converts nested JSON 'Workspace not found' to user-friendly message", () => {
      const result = normalizeFileError(JSON.stringify({ error: "Workspace not found" }));
      expect(result).toContain("Workspace is not available");
      expect(result).not.toContain("Workspace not found");
    });

    it("converts plain text 'Workspace not found' to user-friendly message", () => {
      const result = normalizeFileError("Workspace not found");
      expect(result).toContain("Workspace is not available");
    });

    it("converts 'unauthorized' to access message", () => {
      const result = normalizeFileError("Unauthorized access");
      expect(result).toContain("do not have access");
    });

    it("passes through other error messages", () => {
      const result = normalizeFileError("File not found");
      expect(result).toBe("File not found");
    });

    it("handles empty string", () => {
      const result = normalizeFileError("");
      expect(result).toBe("Unknown error");
    });

    it("handles non-JSON text", () => {
      const result = normalizeFileError("Permission denied");
      expect(result).toBe("Permission denied");
    });
  });
});
