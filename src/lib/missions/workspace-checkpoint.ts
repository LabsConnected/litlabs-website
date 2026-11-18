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
import { requireTerminalBaseUrl } from "@/lib/terminal-config";

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
  return requireTerminalBaseUrl();
}

function internalServiceKey(): string {
  return process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
}

/**
 * Client budget for ONE checkpoint exec (round 10).
 *
 * The terminal holds the exec response until sync-back completes, and
 * a checkpoint on a COLD sandbox first pays sandbox creation + the
 * full volume mirror-in before the git commit even runs — the 120 s
 * abort this replaces matched only the server's per-command budget,
 * not the lifecycle work wrapped around it, so a cold first
 * checkpoint aborted client-side, the caller swallowed it to null,
 * and the run's change-verification reported "unknown" with no
 * baseline to diff against (round-10 diagnosis Q2). 360 s is 3× the
 * old abort: sized to the prepare path's cold create+mirror class of
 * work, still bounded so a genuinely dead terminal fails the
 * checkpoint (→ null → an honest "unknown") instead of hanging the
 * run. The heal-and-retry below gives a descriptor-miss a second,
 * warm attempt on top of this budget.
 */
export const CHECKPOINT_EXEC_TIMEOUT_MS = 360_000;

/**
 * Heal-on-workspace-failure for the checkpoint client (round 10),
 * mirroring the transport's fix-E shape: on a workspace-level failure
 * run ensureWorkspaceAlive ONCE and return the workspaceId to retry
 * against. Returns null when the heal did not restore a live
 * workspace — the caller then surfaces the original error. Never
 * throws: a heal failure must not mask the exec's own error.
 */
async function healWorkspaceForCheckpoint(
  projectId: string,
  userId: string,
  workspaceId: string,
): Promise<string | null> {
  try {
    const { ensureWorkspaceAlive } = await import("@/lib/studio/workspace-recovery");
    const recovered = await ensureWorkspaceAlive(projectId, userId, workspaceId);
    if (recovered.healFailed) return null;
    return recovered.workspaceId;
  } catch {
    return null;
  }
}

async function execInWorkspace(
  workspaceId: string,
  userId: string,
  command: string,
  stdin?: string,
  heal?: { projectId: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const attempt = (wsId: string) =>
    fetch(`${terminalBase()}/internal/workspace/${wsId}/exec`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": internalServiceKey(),
      },
      body: JSON.stringify({ command, userId, stdin }),
      // The terminal server allows a sandbox exec 120s per command,
      // but the response is held until sync-back completes and a cold
      // sandbox pays creation + mirror-in first — see
      // CHECKPOINT_EXEC_TIMEOUT_MS for why the client budget is 360s.
      signal: AbortSignal.timeout(CHECKPOINT_EXEC_TIMEOUT_MS),
    });
  let resp = await attempt(workspaceId);
  if (!resp.ok && heal && (resp.status === 404 || resp.status === 409)) {
    const errText = await resp.text().catch(() => "");
    // Workspace-level failures only (no descriptor / descriptor not
    // ready) — the same pair the transport's exec heal keys on. The
    // sandbox gate's fail-closed 503 and execution 500s surface
    // untouched: healing re-registers a lost workspace through the
    // sanctioned prepare path, it never routes around the gate.
    const workspaceLevel =
      (resp.status === 404 && errText.includes("Workspace not found")) ||
      (resp.status === 409 && errText.includes("Workspace not ready"));
    if (workspaceLevel) {
      const healedId = await healWorkspaceForCheckpoint(heal.projectId, userId, workspaceId);
      if (healedId) {
        resp = await attempt(healedId);
        if (!resp.ok) {
          const retryErr = await resp.text().catch(() => "");
          throw new Error(`Workspace exec failed (${resp.status}): ${retryErr}`);
        }
        return parseExecResponse(resp);
      }
    }
    throw new Error(`Workspace exec failed (${resp.status}): ${errText}`);
  }
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Workspace exec failed (${resp.status}): ${err}`);
  }
  return parseExecResponse(resp);
}

async function parseExecResponse(
  resp: Response,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const data = (await resp.json()) as {
    exitCode?: number;
    exit_code?: number;
    stdout?: string;
    stderr?: string;
  };
  return {
    exitCode: data.exitCode ?? data.exit_code ?? 1,
    stdout: data.stdout ?? "",
    stderr: data.stderr ?? "",
  };
}

export interface RestoreWorkspaceCheckpointInput {
  workspaceId: string;
  userId: string;
  /** Full 40-char hex git SHA recorded by createWorkspaceCheckpoint. */
  gitSha: string;
}

export interface RestoreWorkspaceCheckpointResult {
  gitSha: string;
}

/** A checkpoint SHA must be exactly 40 hex chars — anything else is refused
 *  before it can reach the shell, so no command injection is possible. */
const GIT_SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * Restore the workspace EXACTLY to a checkpoint SHA: hard-reset tracked
 * files to the checkpoint commit and delete untracked files created after
 * it, so the working tree matches the checkpointed state byte-for-byte.
 *
 * Reuses the same execInWorkspace transport plumbing as checkpoint
 * creation — no new execution path.
 */
export async function restoreWorkspaceCheckpoint(
  input: RestoreWorkspaceCheckpointInput,
): Promise<RestoreWorkspaceCheckpointResult> {
  const { workspaceId, userId, gitSha } = input;
  const sha = gitSha.trim();
  if (!GIT_SHA_RE.test(sha)) {
    throw new Error(
      "Refusing to restore workspace: checkpoint SHA must be a 40-character hex git SHA",
    );
  }
  const result = await execInWorkspace(
    workspaceId,
    userId,
    `git reset --hard ${sha} && git clean -fd`,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Workspace restore to ${sha} failed (exit ${result.exitCode}): ${(result.stderr || result.stdout).slice(0, 500)}`,
    );
  }
  return { gitSha: sha };
}

export async function createWorkspaceCheckpoint(
  input: WorkspaceCheckpointInput,
): Promise<WorkspaceCheckpointResult> {
  const { projectId, userId, workspaceId, label, description } = input;

  const commitMessage = description ? `${label}\n\n${description}` : label;

  // Ensure git user identity is configured, stage all changes, and commit via stdin.
  // Both steps pass the heal context: the checkpoint is the run's
  // baseline, and a lost terminal descriptor must be re-registered
  // through the sanctioned prepare path instead of failing the
  // baseline (and with it the run's whole change-verification).
  const commit = await execInWorkspace(
    workspaceId,
    userId,
    "git config --local user.name 'LiTT Agent' && git config --local user.email 'agent@litt.ai' && git add -A && git commit --file=- --allow-empty",
    commitMessage,
    { projectId },
  );

  if (commit.exitCode !== 0) {
    throw new Error(`Checkpoint commit failed (exit ${commit.exitCode}): ${commit.stderr.slice(0, 200)}`);
  }

  // Get the SHA
  const shaResult = await execInWorkspace(workspaceId, userId, "git rev-parse HEAD", undefined, {
    projectId,
  });
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

// ─── Checkpoint diff ─────────────────────────────────────────────

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
/** Cap on the unified diff returned to the browser. */
export const MAX_CHECKPOINT_DIFF_BYTES = 200_000;

export interface CheckpointDiff {
  files: Array<{ path: string; additions: number | null; deletions: number | null }>;
  diff: string;
  truncated: boolean;
}

/** Parse `git diff --numstat` output ("-" = binary → null counts). */
export function parseNumstat(stdout: string): CheckpointDiff["files"] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [add, del, ...rest] = line.split("\t");
      return {
        path: rest.join("\t"),
        additions: add === "-" ? null : Number(add),
        deletions: del === "-" ? null : Number(del),
      };
    })
    .filter((f) => f.path.length > 0);
}

/**
 * Readable diff between two checkpoints of the same workspace. The exec
 * endpoint splits argv on whitespace (no shell), so SHAs are validated as
 * hex and the pathspec is passed unquoted.
 */
export async function diffWorkspaceCheckpoints(
  workspaceId: string,
  userId: string,
  from: string,
  to: string,
): Promise<CheckpointDiff> {
  if (!SHA_PATTERN.test(from) || !SHA_PATTERN.test(to)) {
    throw new Error("Invalid checkpoint SHA");
  }
  const numstat = await execInWorkspace(workspaceId, userId, `git diff --numstat ${from} ${to}`);
  if (numstat.exitCode !== 0) {
    throw new Error(`git diff failed (exit ${numstat.exitCode}): ${numstat.stderr.slice(0, 200)}`);
  }
  const patch = await execInWorkspace(workspaceId, userId, `git diff --no-color ${from} ${to}`);
  const full = patch.exitCode === 0 ? patch.stdout : "";
  const truncated = full.length > MAX_CHECKPOINT_DIFF_BYTES;
  return {
    files: parseNumstat(numstat.stdout),
    diff: truncated ? full.slice(0, MAX_CHECKPOINT_DIFF_BYTES) : full,
    truncated,
  };
}
