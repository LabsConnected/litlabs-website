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
import { createTerminalToken } from "@/lib/terminal-auth";
import {
  encodeManifestCheckpointDescription,
  enumerateWorkspaceManifest,
  type ManifestFileSurface,
} from "@/lib/missions/workspace-manifest";

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
  /**
   * "git" = gitSha is a real commit. "manifest" = the git exec path was
   * unavailable (e.g. 503 HOST_EXECUTION_DISABLED in production-like
   * environments), so the baseline is the path → sha256 manifest and
   * gitSha is empty — the row must never be fed to git restore.
   */
  kind: "git" | "manifest";
  /** Path → sha256 baseline; present only for kind: "manifest". */
  manifest?: Record<string, string>;
}

function terminalBase(): string {
  return requireTerminalBaseUrl();
}

function internalServiceKey(): string {
  return process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
}

async function execInWorkspace(
  workspaceId: string,
  userId: string,
  command: string,
  stdin?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const resp = await fetch(
    `${terminalBase()}/internal/workspace/${workspaceId}/exec`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": internalServiceKey(),
      },
      body: JSON.stringify({ command, userId, stdin }),
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

/**
 * The workspace file services (/ws-files list/read) as a manifest
 * surface — the same endpoints and token shape WorkspaceTransport uses.
 * These work in production-like environments where /exec is refused.
 */
function workspaceFileSurface(input: WorkspaceCheckpointInput): ManifestFileSurface {
  const { workspaceId, userId, projectId } = input;
  const headers = (): Record<string, string> => {
    const { token } = createTerminalToken(userId, { workspaceId, projectId });
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspaceId,
    };
  };
  return {
    async listFiles(path: string) {
      const resp = await fetch(
        `${terminalBase()}/ws-files?path=${encodeURIComponent(path || ".")}`,
        { headers: headers(), signal: AbortSignal.timeout(30_000) },
      );
      if (!resp.ok) {
        const err = await resp.text().catch(() => "");
        throw new Error(`listFiles failed (${resp.status}): ${err}`);
      }
      return resp.json() as Promise<{ entries: Array<{ name: string; type: string }> }>;
    },
    async readFile(path: string) {
      const resp = await fetch(`${terminalBase()}/ws-files/read`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ path }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        const err = await resp.text().catch(() => "");
        throw new Error(`readFile failed (${resp.status}): ${err}`);
      }
      const data = (await resp.json()) as { content: string; size: number };
      return { content: data.content, size: data.size };
    },
  };
}

/**
 * Manifest fallback (Gate 1 Fix 1): when the git exec path fails — on
 * staging it always does, by design (503 HOST_EXECUTION_DISABLED) —
 * capture the baseline as a path → sha256 manifest over the file
 * services instead of producing no checkpoint at all. The manifest
 * rides the checkpoint row's description (no schema migration);
 * git_sha stays empty so the row can never be mistaken for a git
 * checkpoint by restore or by the change producer.
 */
async function createManifestCheckpoint(
  input: WorkspaceCheckpointInput,
): Promise<WorkspaceCheckpointResult> {
  const { projectId, userId, label } = input;
  const manifest = await enumerateWorkspaceManifest(workspaceFileSurface(input));
  const checkpoint = await createCheckpoint({
    projectId,
    userId,
    gitSha: "",
    label,
    description: encodeManifestCheckpointDescription(manifest),
  });
  return {
    checkpointId: checkpoint.id,
    label,
    gitSha: "",
    kind: "manifest",
    manifest,
  };
}

export async function createWorkspaceCheckpoint(
  input: WorkspaceCheckpointInput,
): Promise<WorkspaceCheckpointResult> {
  const { projectId, userId, workspaceId, label, description } = input;

  try {
    // Stage all changes
    await execInWorkspace(workspaceId, userId, "git add -A");

    const commitMessage = description ? `${label}\n\n${description}` : label;
    const commit = await execInWorkspace(
      workspaceId,
      userId,
      "git commit --file=- --allow-empty",
      commitMessage,
    );
    // The exec endpoint returns 200 even when git fails. A failed commit
    // followed by rev-parse would record the PREVIOUS commit as this
    // checkpoint — a silent lie that makes Revert a no-op. Fail loudly.
    if (commit.exitCode !== 0) {
      throw new Error(`Checkpoint commit failed (exit ${commit.exitCode}): ${commit.stderr.slice(0, 200)}`);
    }

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
      kind: "git",
    };
  } catch {
    // Git unavailable (or its persistence failed): fall back to the
    // manifest baseline over the file services. If the fallback also
    // fails, its error propagates — the transport turns any throw into
    // "no checkpoint", exactly as before.
    return createManifestCheckpoint(input);
  }
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
