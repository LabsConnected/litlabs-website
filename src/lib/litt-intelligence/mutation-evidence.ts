/**
 * Mutation Evidence Model
 *
 * Structured evidence for every workspace mutation. This is the data
 * the Changes and Activity panels will consume — NOT chat transcripts.
 *
 * Phase 6 — Studio Control Plane V1
 */

/**
 * The status of a mutation operation.
 * - "proposed": mutation requested but not yet approved
 * - "approved": approval granted, mutation may proceed
 * - "running": mutation is executing
 * - "succeeded": mutation completed successfully, after-state captured
 * - "failed": mutation failed (partial failure remains visible)
 */
export type MutationStatus =
  | "proposed"
  | "approved"
  | "running"
  | "succeeded"
  | "failed";

/**
 * Evidence for a single workspace mutation operation.
 *
 * Every file write, patch, delete, or git commit through the canonical
 * mutation tools produces one of these records. The Changes tab renders
 * from this data; the Activity tab renders from event log entries that
 * reference this evidence.
 */
export interface MutationEvidence {
  /** Unique evidence record ID */
  id: string;
  /** The run/session this mutation belongs to */
  runId: string;
  /** Project ID */
  projectId: string;
  /** Tool that performed the mutation (e.g. "files.write", "apply_patch") */
  toolId: string;

  /** Workspace identity */
  workspaceId: string;
  /** Branch the mutation occurred on */
  branch: string;
  /** Base SHA (merge-base or default branch HEAD) */
  baseSha: string;
  /** HEAD SHA before the mutation */
  headShaBefore: string;
  /** HEAD SHA after the mutation (null if not yet captured or no commit) */
  headShaAfter?: string;

  /** File paths affected by the mutation */
  paths: string[];
  /** Content hashes before mutation (path → sha256 hex, or null if file didn't exist) */
  beforeHashes: Record<string, string | null>;
  /** Content hashes after mutation (path → sha256 hex, or null if file was deleted) */
  afterHashes: Record<string, string | null>;

  /** Unified diff of the mutation (may be truncated for large diffs) */
  diff?: string;

  /**
   * Hash of the working-tree diff (git diff) captured after the mutation.
   * This changes when the worktree changes, even if HEAD does not.
   * Distinct from headSha which only changes on commit.
   */
  workingTreeDiffHash?: string;
  /** Whether the working tree has uncommitted changes after the mutation */
  workingTreeDirty?: boolean;

  /** Status of the mutation */
  status: MutationStatus;
  /** When the mutation started */
  startedAt: string;
  /** When the mutation completed (null if still running or failed before completion) */
  completedAt?: string;

  /** Error message if status is "failed" */
  error?: string;

  /** Approval token that authorized this mutation */
  approvalTokenId?: string;
}

/**
 * Approval token — a real, verifiable record that the user approved
 * a PLAN → ACT transition for a specific run and project.
 *
 * This is NOT just a UI enum change. The token is checked by the
 * mutation service before any file is modified.
 */
export interface ApprovalToken {
  /** Unique token ID */
  id: string;
  /** The run this approval covers */
  runId: string;
  /** Project this approval is for */
  projectId: string;
  /** User who granted approval */
  userId: string;
  /** When approval was granted */
  grantedAt: string;
  /** When approval expires (default: 10 minutes) */
  expiresAt: string;
  /** Whether this token has been consumed by a mutation */
  consumed: boolean;
  /** When the token was consumed */
  consumedAt?: string;
}

/**
 * Protected branch names where mutations are refused.
 * ACT mode requires a feature branch.
 */
export const PROTECTED_BRANCHES = new Set([
  "main",
  "master",
  "release/*",
  "production",
]);

/**
 * Check if a branch name is protected.
 * Supports glob patterns like "release/*".
 */
export function isProtectedBranch(branch: string): boolean {
  for (const pattern of PROTECTED_BRANCHES) {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1); // "release/"
      if (branch.startsWith(prefix)) return true;
    } else if (branch === pattern) {
      return true;
    }
  }
  return false;
}
