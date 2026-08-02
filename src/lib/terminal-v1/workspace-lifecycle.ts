/**
 * Workspace lifecycle manager for Terminal V1.
 *
 * Orchestrates workspace creation, GitHub cloning, sandbox provisioning,
 * and cleanup. This is the high-level service that API routes call.
 */

import { WorkspaceService, type CreateWorkspaceInput } from "./workspace-service";
import { cloneRepository, initBlankWorkspace } from "./github-clone";
import { getSandboxProvider } from "./providers";
import { isTerminalEnabled } from "./control-plane";
import { FeatureDisabledError } from "./providers/disabled-provider";
import type { Workspace, SandboxInstance, TerminalToken } from "./types";

export interface WorkspaceLifecycleManager {
  prepareWorkspace(input: PrepareWorkspaceInput): Promise<{
    workspace: Workspace;
    sandbox: SandboxInstance;
    token: TerminalToken;
  }>;
  getWorkspace(workspaceId: string, userId: string): Promise<Workspace | null>;
  listUserWorkspaces(userId: string): Promise<Workspace[]>;
  stopWorkspace(workspaceId: string, userId: string): Promise<void>;
  deleteWorkspace(workspaceId: string, userId: string): Promise<void>;
}

export interface PrepareWorkspaceInput {
  userId: string;
  projectId: string;
  gitSource: "github" | "blank";
  gitOwner?: string;
  gitRepo?: string;
  gitBranch?: string;
  githubToken?: string | null;
  commitSha?: string | null;
}

export function createWorkspaceLifecycleManager(
  workspaceService: WorkspaceService,
): WorkspaceLifecycleManager {
  return {
    async prepareWorkspace(input: PrepareWorkspaceInput) {
      if (!isTerminalEnabled()) {
        throw new FeatureDisabledError("Terminal is disabled");
      }

      // 1. Create or get existing workspace record
      const workspace = await workspaceService.create({
        userId: input.userId,
        projectId: input.projectId,
        gitSource: input.gitSource,
        gitOwner: input.gitOwner,
        gitRepo: input.gitRepo,
        gitBranch: input.gitBranch,
        githubToken: input.githubToken,
      });

      // 2. If workspace is already ready, just create a new sandbox
      if (workspace.state === "ready") {
        return await createSandboxForWorkspace(workspaceService, workspace);
      }

      // 3. Clone the repository (if GitHub source)
      if (input.gitSource === "github") {
        await workspaceService.markCloning(workspace.workspaceId);

        try {
          const cloneResult = await cloneRepository({
            owner: input.gitOwner!,
            repo: input.gitRepo!,
            branch: input.gitBranch ?? "main",
            githubToken: input.githubToken ?? null,
            targetPath: `/workspaces/${workspace.workspaceId}`,
            commitSha: input.commitSha,
          });

          await workspaceService.markReady(workspace.workspaceId, cloneResult.commitSha);
        } catch (err) {
          await workspaceService.markError(
            workspace.workspaceId,
            err instanceof Error ? err.message : String(err),
          );
          throw err;
        }
      } else {
        // Blank workspace — just initialize
        await initBlankWorkspace(`/workspaces/${workspace.workspaceId}`);
        await workspaceService.markReady(workspace.workspaceId);
      }

      // 4. Create sandbox
      const readyWorkspace = await workspaceService.getById(workspace.workspaceId);
      if (!readyWorkspace) throw new Error("Workspace disappeared after prepare");

      return await createSandboxForWorkspace(workspaceService, readyWorkspace);
    },

    async getWorkspace(workspaceId: string, userId: string) {
      const ws = await workspaceService.getById(workspaceId);
      if (!ws) return null;
      if (ws.userId !== userId) return null;
      return ws;
    },

    async listUserWorkspaces(userId: string) {
      return workspaceService.listByUser(userId);
    },

    async stopWorkspace(workspaceId: string, userId: string) {
      const ws = await workspaceService.getById(workspaceId);
      if (!ws) throw new Error("Workspace not found");
      if (ws.userId !== userId) throw new Error("Forbidden");

      if (ws.currentSandboxId) {
        const provider = getSandboxProvider();
        await provider.stop(ws.currentSandboxId);
        await workspaceService.update(workspaceId, {
          currentSandboxId: null,
        });
      }
    },

    async deleteWorkspace(workspaceId: string, userId: string) {
      const ws = await workspaceService.getById(workspaceId);
      if (!ws) throw new Error("Workspace not found");
      if (ws.userId !== userId) throw new Error("Forbidden");

      // Destroy sandbox if running
      if (ws.currentSandboxId) {
        const provider = getSandboxProvider();
        try {
          await provider.destroy(ws.currentSandboxId);
        } catch {
          // Sandbox may already be gone
        }
      }

      // Soft-delete the workspace record
      await workspaceService.softDelete(workspaceId);
    },
  };
}

async function createSandboxForWorkspace(
  workspaceService: WorkspaceService,
  workspace: Workspace,
): Promise<{ workspace: Workspace; sandbox: SandboxInstance; token: TerminalToken }> {
  const provider = getSandboxProvider();

  const sandbox = await provider.create({
    workspaceId: workspace.workspaceId,
    userId: workspace.userId,
    projectId: workspace.projectId,
  });

  // Link sandbox to workspace
  await workspaceService.update(workspace.workspaceId, {
    currentSandboxId: sandbox.sandboxId,
  });

  // Issue token
  const { createTerminalTokenV1 } = await import("./token");
  const token = createTerminalTokenV1({
    userId: workspace.userId,
    projectId: workspace.projectId,
    workspaceId: workspace.workspaceId,
    sandboxId: sandbox.sandboxId,
  });

  return {
    workspace: { ...workspace, currentSandboxId: sandbox.sandboxId },
    sandbox,
    token,
  };
}
