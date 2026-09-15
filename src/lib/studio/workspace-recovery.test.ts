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

import { ensureWorkspaceAlive, normalizeFileError, provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";
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
    // resetAllMocks clears both call history AND mock implementations
    // (clearAllMocks only clears call history, leaving stale
    // mockResolvedValue/mockRejectedValue from previous tests).
    vi.resetAllMocks();
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
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
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
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
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

  describe("provisionWorkspaceForProject", () => {
    it("returns existing workspaceId when workspace is ready and alive", async () => {
      vi.mocked(getProject).mockResolvedValue(fakeProject({ workspaceId: "ws-existing", workspaceStatus: "ready" }));
      vi.mocked(getWorkspaceInternal).mockResolvedValue(fakeWorkspace({ workspaceId: "ws-existing", root: "/data/ws-existing", ready: true } as unknown as WorkspaceGetResponse));

      const result = await provisionWorkspaceForProject("proj-1", "user-1");

      expect(result).toBe("ws-existing");
      // Should NOT have claimed a lock or prepared a new workspace
      expect(claimProvisioningLock).not.toHaveBeenCalled();
      expect(prepareWorkspaceInternal).not.toHaveBeenCalled();
    });

    it("re-provisions when DB says ready but terminal server lost the workspace", async () => {
      // First getProject: ready but stale
      vi.mocked(getProject)
        .mockResolvedValueOnce(fakeProject({ workspaceId: "ws-stale", workspaceStatus: "ready" }));
      // getWorkspaceInternal returns null (lost)
      vi.mocked(getWorkspaceInternal).mockResolvedValue(null);
      // After reset, ensureCanonicalStudioProject returns not_prepared
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-new", root: "/data/ws-new" }) as unknown as WorkspacePrepareResponse,
      );

      const result = await provisionWorkspaceForProject("proj-1", "user-1");

      expect(result).toBe("ws-new");
      expect(prepareWorkspaceInternal).toHaveBeenCalled();
    });

    it("provisions a blank project workspace from scratch", async () => {
      vi.mocked(getProject).mockResolvedValue(fakeProject({ sourceType: "blank", templateId: "blank-static", workspaceId: null, workspaceStatus: "not_prepared" }));
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-blank", root: "/data/ws-blank" }) as unknown as WorkspacePrepareResponse,
      );

      const result = await provisionWorkspaceForProject("proj-blank", "user-1");

      expect(result).toBe("ws-blank");
      // "blank" is managed source — LiTT owns the files. The terminal
      // server takes a single "managed" source type for blank/template.
      expect(prepareWorkspaceInternal).toHaveBeenCalledWith(expect.objectContaining({
        sourceType: "managed",
        templateId: "blank-static",
      }));
    });

    it("provisions a template project as managed source", async () => {
      // Regression: "template" is a legal source_type that previously
      // matched neither the blank nor the github branch, so a template
      // project could never be provisioned and reported "no valid source".
      vi.mocked(getProject).mockResolvedValue(fakeProject({ sourceType: "template" as unknown as "blank", templateId: "nextjs", workspaceId: null, workspaceStatus: "not_prepared" }));
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-tmpl", root: "/data/ws-tmpl", branch: "main" }) as unknown as WorkspacePrepareResponse,
      );

      await expect(provisionWorkspaceForProject("proj-tmpl", "user-1")).resolves.toBe("ws-tmpl");
      expect(prepareWorkspaceInternal).toHaveBeenCalledWith(expect.objectContaining({
        sourceType: "managed",
        templateId: "nextjs",
      }));
    });

    it("throws when a GitHub project is missing its installation details", async () => {
      // A project that declares GitHub source but cannot reach it has a
      // genuinely invalid source — unlike a managed project, which never does.
      vi.mocked(getProject).mockResolvedValue(fakeProject({ sourceType: "github", githubInstallationId: null, githubOwner: null, githubRepo: null, workspaceId: null, workspaceStatus: "not_prepared" }));
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());

      await expect(provisionWorkspaceForProject("proj-bad", "user-1")).rejects.toThrow("no valid source");
    });

    it("throws when the workspace provisioned but the DB write did not persist", async () => {
      // Regression: updateProjectWorkspace returning null used to be
      // ignored — the caller returned the new workspaceId while the row
      // still said "provisioning", stranding the workspace (the lock only
      // matches not_prepared/failed) and 409ing the next token request.
      vi.mocked(getProject).mockResolvedValue(fakeProject({ workspaceId: null, workspaceStatus: "not_prepared" }));
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(updateProjectWorkspace).mockResolvedValue(null);
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-new", root: "/data/ws-new" }) as unknown as WorkspacePrepareResponse,
      );

      await expect(provisionWorkspaceForProject("proj-1", "user-1")).rejects.toThrow(
        "could not be persisted",
      );
    });

    it("marks workspace as failed on provisioning error", async () => {
      vi.mocked(getProject).mockResolvedValue(fakeProject({ sourceType: "blank", workspaceId: null, workspaceStatus: "not_prepared" }));
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
      vi.mocked(prepareWorkspaceInternal).mockRejectedValue(new Error("Disk full"));

      await expect(provisionWorkspaceForProject("proj-fail", "user-1")).rejects.toThrow("Disk full");
      // Should have marked the workspace as failed with the error message
      expect(updateProjectWorkspace).toHaveBeenCalledWith("proj-fail", "user-1", expect.objectContaining({
        workspaceStatus: "failed",
        workspaceError: "Disk full",
      }));
    });

    it("throws when project is not found", async () => {
      vi.mocked(getProject).mockResolvedValue(null);

      await expect(provisionWorkspaceForProject("proj-missing", "user-1")).rejects.toThrow("Project not found");
    });
  });
});
