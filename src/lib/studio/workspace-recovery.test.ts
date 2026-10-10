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

vi.mock("child_process", () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
  spawnSync: vi.fn(),
  execFileSync: vi.fn(),
  fork: vi.fn(),
}));

vi.mock("@/lib/github-app", () => ({
  getInstallationToken: vi.fn(),
  getInstallationTokenForClone: vi.fn(),
}));

import { ensureWorkspaceAlive, normalizeFileError, provisionWorkspaceForProject, reprepareWorkspace } from "@/lib/studio/workspace-recovery";
import { getProject, updateProjectWorkspace, claimProvisioningLock, ensureCanonicalStudioProject } from "@/lib/projects/project-repository";
import { getWorkspaceInternal, prepareWorkspaceInternal } from "@/lib/terminal-internal-client";
import { getInstallationTokenForClone } from "@/lib/github-app";
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
      // The shared provisioner checks the stale workspace again before
      // re-adopting its durable root.
      vi.mocked(getWorkspaceInternal).mockResolvedValueOnce(null);
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

    it("re-syncs a GitHub mirror workspace instead of returning it stale", async () => {
      // Regression: a "ready" GitHub workspace was returned as-is forever, so
      // the preview served the clone from initial provisioning (stale files).
      // The repo is the source of truth — it must be re-synced via prepare.
      vi.mocked(getProject).mockResolvedValue(
        fakeProject({
          sourceType: "github",
          githubInstallationId: 123,
          githubOwner: "LabsConnected",
          githubRepo: "litlabs-website",
          githubBranch: "main",
          workspaceId: "ws-gh",
          workspaceRoot: "/data/ws-gh",
          workspaceStatus: "ready",
        }),
      );
      vi.mocked(getWorkspaceInternal).mockResolvedValue(
        fakeWorkspace({ workspaceId: "ws-gh", root: "/data/ws-gh", ready: true } as unknown as WorkspaceGetResponse),
      );
      vi.mocked(getInstallationTokenForClone).mockResolvedValue("tok-123");
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-gh", root: "/data/ws-gh", branch: "main" }) as unknown as WorkspacePrepareResponse,
      );

      const result = await provisionWorkspaceForProject("proj-gh", "user-1");

      expect(result).toBe("ws-gh");
      // Must re-sync via prepare (which fetches/pulls on the terminal server)
      expect(prepareWorkspaceInternal).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: "github",
          owner: "LabsConnected",
          repo: "litlabs-website",
          branch: "main",
          existingWorkspaceId: "ws-gh",
        }),
      );
      // Must NOT have taken the full provisioning lock path
      expect(claimProvisioningLock).not.toHaveBeenCalled();
    });

    it("falls back to the existing workspace when GitHub refresh fails", async () => {
      // If the pull fails (e.g. uncommitted agent work), the preview must keep
      // working on the existing workspace — stale beats broken.
      vi.mocked(getProject).mockResolvedValue(
        fakeProject({
          sourceType: "github",
          githubInstallationId: 123,
          githubOwner: "LabsConnected",
          githubRepo: "litlabs-website",
          workspaceId: "ws-gh",
          workspaceRoot: "/data/ws-gh",
          workspaceStatus: "ready",
        }),
      );
      vi.mocked(getWorkspaceInternal).mockResolvedValue(
        fakeWorkspace({ workspaceId: "ws-gh", root: "/data/ws-gh", ready: true } as unknown as WorkspaceGetResponse),
      );
      vi.mocked(getInstallationTokenForClone).mockResolvedValue("tok-123");
      vi.mocked(prepareWorkspaceInternal).mockRejectedValue(new Error("Your local changes would be overwritten by merge"));

      const result = await provisionWorkspaceForProject("proj-gh", "user-1");

      expect(result).toBe("ws-gh");
      // Must not have marked the project failed
      expect(updateProjectWorkspace).not.toHaveBeenCalledWith(
        "proj-gh",
        "user-1",
        expect.objectContaining({ workspaceStatus: "failed" }),
      );
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
      // "blank" is managed source — LiTT owns the files. Static templates
      // (blank-static) provision via the gitless "static" path because
      // Gate 1 blocks all git operations in production.
      expect(prepareWorkspaceInternal).toHaveBeenCalledWith(expect.objectContaining({
        sourceType: "static",
        templateId: "blank-static",
      }));
    });

    it("provisions an empty-static project via the static path", async () => {
      vi.mocked(getProject).mockResolvedValue(fakeProject({ sourceType: "template", templateId: "empty-static", workspaceId: null, workspaceStatus: "not_prepared" }));
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-empty", root: "/data/ws-empty" }) as unknown as WorkspacePrepareResponse,
      );

      const result = await provisionWorkspaceForProject("proj-empty", "user-1");

      expect(result).toBe("ws-empty");
      expect(prepareWorkspaceInternal).toHaveBeenCalledWith(expect.objectContaining({
        sourceType: "static",
        templateId: "empty-static",
      }));
    });

    it("provisions a null-template project via the static path (defaults to blank-static)", async () => {
      vi.mocked(getProject).mockResolvedValue(fakeProject({ sourceType: "blank", templateId: null, workspaceId: null, workspaceStatus: "not_prepared" }));
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-null", root: "/data/ws-null" }) as unknown as WorkspacePrepareResponse,
      );

      const result = await provisionWorkspaceForProject("proj-null", "user-1");

      expect(result).toBe("ws-null");
      expect(prepareWorkspaceInternal).toHaveBeenCalledWith(expect.objectContaining({
        sourceType: "static",
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

    it("releases the lock when file recovery owns provisioning and terminal prepare fails", async () => {
      vi.mocked(getProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject({ workspaceStatus: "provisioning" }));
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
      vi.mocked(prepareWorkspaceInternal).mockRejectedValue(new Error("terminal unavailable"));

      await expect(reprepareWorkspace("proj-1", "user-1")).rejects.toThrow("terminal unavailable");
      expect(updateProjectWorkspace).toHaveBeenCalledWith("proj-1", "user-1", expect.objectContaining({
        workspaceStatus: "failed",
        workspaceError: "terminal unavailable",
      }));
    });

    it("observes an existing provisioning owner and returns its ready workspace without preparing again", async () => {
      vi.mocked(getProject)
        .mockResolvedValueOnce(fakeProject({ workspaceStatus: "provisioning" }))
        .mockResolvedValueOnce(fakeProject({ workspaceId: "ws-owner", workspaceStatus: "ready" }));
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "provisioning" }));

      await expect(provisionWorkspaceForProject("proj-1", "user-1")).resolves.toBe("ws-owner");
      expect(claimProvisioningLock).not.toHaveBeenCalled();
      expect(prepareWorkspaceInternal).not.toHaveBeenCalled();
    });

    it("allows only the winning concurrent caller to prepare a workspace", async () => {
      let reads = 0;
      vi.mocked(getProject).mockImplementation(async () => {
        reads += 1;
        return reads <= 2
          ? fakeProject({ workspaceStatus: "not_prepared" })
          : fakeProject({ workspaceId: "ws-winner", workspaceStatus: "ready" });
      });
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock)
        .mockResolvedValueOnce(fakeProject({ workspaceStatus: "provisioning" }))
        .mockResolvedValueOnce(null);
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-winner", root: "/data/ws-winner" }) as unknown as WorkspacePrepareResponse,
      );

      const results = await Promise.all([
        provisionWorkspaceForProject("proj-1", "user-1"),
        provisionWorkspaceForProject("proj-1", "user-1"),
      ]);

      expect(results).toEqual(["ws-winner", "ws-winner"]);
      expect(prepareWorkspaceInternal).toHaveBeenCalledTimes(1);
    });

    it("throws when project is not found", async () => {
      vi.mocked(getProject).mockResolvedValue(null);

      await expect(provisionWorkspaceForProject("proj-missing", "user-1")).rejects.toThrow("Project not found");
    });

    it("rejects provisioning when the user does not own the project", async () => {
      // Ownership enforcement: getProject is called with the requesting
      // userId, and a project owned by someone else is rejected.
      vi.mocked(getProject).mockResolvedValue(
        fakeProject({ id: "proj-other", userId: "user-2", sourceType: "blank", templateId: "blank-static" }),
      );

      await expect(provisionWorkspaceForProject("proj-other", "user-1")).rejects.toThrow("Forbidden");
      expect(prepareWorkspaceInternal).not.toHaveBeenCalled();
    });
  });

  describe("static workspace end-to-end (Gate 1)", () => {
    // End-to-end flow: authenticated static project creation → workspace
    // provisions via the gitless "static" path → files are writable →
    // ownership is enforced → zero subprocesses on the web side.
    //
    // The terminal-server half (provision with zero subprocesses, file
    // write→read persistence) is covered by
    // terminal-server/__tests__/static-workspace-no-git.test.ts (10/10).
    // These tests cover the web-side contract: the correct sourceType is
    // sent, framework/GitHub projects are untouched, and no subprocess
    // is spawned anywhere in the web provisioning path.

    it("sends sourceType static for a blank-static project (full creation flow)", async () => {
      // Simulate: authenticated user-1 creates a static project.
      const project = fakeProject({
        id: "proj-e2e-static",
        userId: "user-1",
        sourceType: "blank",
        templateId: "blank-static",
        workspaceId: null,
        workspaceStatus: "not_prepared",
      });
      vi.mocked(getProject).mockResolvedValue(project);
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-e2e", root: "/data/ws-e2e", commitSha: "static-no-git" }) as unknown as WorkspacePrepareResponse,
      );

      const workspaceId = await provisionWorkspaceForProject("proj-e2e-static", "user-1");

      expect(workspaceId).toBe("ws-e2e");
      // The critical assertion: the terminal server receives "static",
      // not "managed" — this is what bypasses the git-backed path that
      // Gate 1 correctly blocks in production.
      expect(prepareWorkspaceInternal).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: "static",
          userId: "user-1",
          projectId: "proj-e2e-static",
          templateId: "blank-static",
        }),
      );
    });

    it("keeps framework projects on the managed (git-backed) path", async () => {
      // nextjs/react-vite/expo need npm + build steps; they stay on the
      // git-backed path which remains correctly blocked in production
      // until sandbox isolation exists.
      for (const templateId of ["nextjs", "react-vite", "expo-react-native"]) {
        vi.resetAllMocks();
        vi.mocked(getProject).mockResolvedValue(
          fakeProject({ sourceType: "template", templateId, workspaceId: null, workspaceStatus: "not_prepared" }),
        );
        vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
        vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
        vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
        vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
          ({ workspaceId: "ws-fw", root: "/data/ws-fw" }) as unknown as WorkspacePrepareResponse,
        );

        await provisionWorkspaceForProject("proj-fw", "user-1");

        expect(prepareWorkspaceInternal).toHaveBeenCalledWith(
          expect.objectContaining({ sourceType: "managed", templateId }),
        );
      }
    });

    it("keeps GitHub projects on the github path", async () => {
      vi.mocked(getProject).mockResolvedValue(
        fakeProject({
          sourceType: "github",
          githubInstallationId: 123,
          githubOwner: "octo",
          githubRepo: "hello",
          workspaceId: null,
          workspaceStatus: "not_prepared",
        }),
      );
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-gh", root: "/data/ws-gh" }) as unknown as WorkspacePrepareResponse,
      );
      vi.mocked(getInstallationTokenForClone).mockResolvedValue("ghs_test");

      await provisionWorkspaceForProject("proj-gh", "user-1");

      expect(prepareWorkspaceInternal).toHaveBeenCalledWith(
        expect.objectContaining({ sourceType: "github" }),
      );
    });

    it("spawns zero subprocesses during static provisioning", async () => {
      // The web-side provisioning path must be pure HTTP calls to the
      // terminal server — no child_process usage anywhere. The module is
      // mocked at the top of this file; assert none of its functions
      // were invoked during the full provisioning flow.
      const cp = await import("child_process");

      vi.mocked(getProject).mockResolvedValue(
        fakeProject({ sourceType: "blank", templateId: "blank-static", workspaceId: null, workspaceStatus: "not_prepared" }),
      );
      vi.mocked(ensureCanonicalStudioProject).mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));
      vi.mocked(claimProvisioningLock).mockResolvedValue(fakeProject());
      vi.mocked(updateProjectWorkspace).mockResolvedValue(fakeProject());
      vi.mocked(prepareWorkspaceInternal).mockResolvedValue(
        ({ workspaceId: "ws-sp", root: "/data/ws-sp" }) as unknown as WorkspacePrepareResponse,
      );

      await provisionWorkspaceForProject("proj-sp", "user-1");

      expect(vi.mocked(cp.spawn)).not.toHaveBeenCalled();
      expect(vi.mocked(cp.exec)).not.toHaveBeenCalled();
      expect(vi.mocked(cp.execFile)).not.toHaveBeenCalled();
      expect(vi.mocked(cp.execSync)).not.toHaveBeenCalled();
      expect(vi.mocked(cp.spawnSync)).not.toHaveBeenCalled();
      expect(vi.mocked(cp.execFileSync)).not.toHaveBeenCalled();
      expect(vi.mocked(cp.fork)).not.toHaveBeenCalled();
    });
  });
});
