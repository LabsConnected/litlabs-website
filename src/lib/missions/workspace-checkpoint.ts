/**
 * Workspace Checkpoint — creates a git checkpoint in the workspace
 * and records it in the project_checkpoints table.
 *
 * Reuses:
 *   - Terminal server /internal/workspace/:id/exec for git operations
 *   - mission-repository.createCheckpoint for DB persistence
 *   - verifyProjectWorkspace for workspace resolution
 */

import "server-only";

import { createCheckpoint } from "@/lib/missions/mission-repository";

export interface WorkspaceCheckpointInput {
  projectId: string;
  userId: string;
  workspaceId: string;
  label: string;
  description?: string;
}

export interface WorkspaceCheckpointResult {
  checkpointId: string;
  label: string;
  gitSha: string;
}

function terminalBase(): string {
  return (
    process.env.TERMINAL_SERVER_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
    "https://terminal-server-production-68ac.up.railway.app"
  );
}

function internalServiceKey(): string {
  return process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
}

async function execInWorkspace(
  workspaceId: string,
  userId: string,
  command: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const resp = await fetch(
    `${terminalBase()}/internal/workspace/${workspaceId}/exec`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": internalServiceKey(),
      },
      body: JSON.stringify({ command, userId }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Workspace exec failed (${resp.status}): ${err}`);
  }
  const data = await resp.json();
  return {
    exitCode: data.exitCode ?? data.exit_code ?? 1,
    stdout: data.stdout ?? "",
    stderr: data.stderr ?? "",
  };
}

export async function createWorkspaceCheckpoint(
  input: WorkspaceCheckpointInput,
): Promise<WorkspaceCheckpointResult> {
  const { projectId, userId, workspaceId, label, description } = input;

  // Stage all changes
  await execInWorkspace(workspaceId, userId, "git add -A");

  // Create git commit
  const escapedLabel = label.replace(/"/g, '\\"');
  await execInWorkspace(
    workspaceId,
    userId,
    `git commit -m "${escapedLabel}" --allow-empty`,
  );

  // Get the SHA
  const shaResult = await execInWorkspace(workspaceId, userId, "git rev-parse HEAD");
  const gitSha = shaResult.stdout.trim();

  if (!gitSha) {
    throw new Error("Failed to get git SHA after checkpoint commit");
  }

  // Persist to DB
  const checkpoint = await createCheckpoint({
    projectId,
    userId,
    gitSha,
    label,
    description: description ?? `Agent checkpoint: ${label}`,
  });

  return {
    checkpointId: checkpoint.id,
    label,
    gitSha,
  };
}
