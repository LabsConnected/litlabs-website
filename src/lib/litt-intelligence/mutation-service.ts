/**
 * Workspace Mutation Service
 *
 * The safety-critical layer that wraps every workspace file mutation.
 * Enforces:
 * - Branch safety (refuse mutation on protected main/master)
 * - Path validation (every path must resolve inside workspace root)
 * - Approval verification (real token, not just UI enum)
 * - Before/after state capture (file hashes + git SHA)
 * - Diff capture
 * - Evidence persistence (structured, not derived from chat)
 * - Failure visibility (partial failure remains visible, never hidden)
 *
 * Phase 6 — Studio Control Plane V1
 */

import { randomUUID } from "crypto";
import { resolve, relative, isAbsolute, sep, dirname } from "path";
import { createHash } from "crypto";
import { realpathSync, existsSync } from "fs";
import type { WorkspaceTransport } from "./workspace-transport";
import type { MutationEvidence } from "./mutation-evidence";
import { isProtectedBranch } from "./mutation-evidence";
import { getEvidenceStore, getApprovalStore } from "./evidence-store";

// ─── Types ───────────────────────────────────────────────────────

export interface MutationRequest {
  runId: string;
  projectId: string;
  toolId: string;
  /** Approval token ID from the approval store */
  approvalTokenId: string;
  /** Paths that will be affected by the mutation */
  paths: string[];
  /** The mutation operation to execute */
  operation: (transport: WorkspaceTransport) => Promise<unknown>;
}

export interface MutationResult {
  evidence: MutationEvidence;
  operationResult: unknown;
}

export class MutationError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "MutationError";
  }
}

// ─── Path Validation ─────────────────────────────────────────────

/**
 * Validate that a path resolves inside the workspace root, with
 * symlink containment.
 *
 * Rejects:
 * - Absolute paths outside workspace root
 * - Path traversal (../)
 * - Symlink escapes (a symlink inside the workspace whose target
 *   points outside the real workspace root)
 *
 * Symlink containment is enforced by:
 * 1. Resolving the workspace root with realpathSync (collapses symlinks)
 * 2. Resolving the target's nearest existing parent with realpathSync
 * 3. Proving the resolved parent is inside the real workspace root
 *
 * This is defense-in-depth — the terminal server also enforces
 * workspace boundaries. But this prevents symlink escapes from
 * reaching the server in the first place.
 */
export function validateWorkspacePath(
  path: string,
  workspaceRoot: string,
): { valid: boolean; resolved?: string; reason?: string } {
  if (!path || typeof path !== "string") {
    return { valid: false, reason: "Path is required" };
  }

  // Reject obvious traversal patterns
  if (path.includes("..")) {
    return { valid: false, reason: "Path traversal (..) is not allowed" };
  }

  // Resolve the path relative to workspace root
  const resolved = isAbsolute(path)
    ? resolve(path)
    : resolve(workspaceRoot, path);

  // Check the resolved path is inside workspace root (lexical check)
  const rel = relative(workspaceRoot, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      valid: false,
      reason: `Path "${path}" resolves outside workspace root`,
    };
  }

  // Symlink containment: resolve the real workspace root and the
  // target's nearest existing parent, then verify containment.
  let realWorkspaceRoot: string;
  try {
    realWorkspaceRoot = realpathSync(workspaceRoot);
  } catch {
    // Workspace root doesn't exist or can't be resolved — fail safe
    return { valid: false, reason: "Workspace root does not exist or cannot be resolved" };
  }

  // Find the nearest existing ancestor of the target path.
  // The target file may not exist yet (we're creating it), but its
  // parent directory should exist or be creatable inside the workspace.
  let targetToResolve = resolved;
  while (!existsSync(targetToResolve)) {
    const parent = dirname(targetToResolve);
    if (parent === targetToResolve) {
      // Reached filesystem root without finding an existing directory
      return { valid: false, reason: "Cannot resolve target path — no existing parent found" };
    }
    targetToResolve = parent;
  }

  let realTarget: string;
  try {
    realTarget = realpathSync(targetToResolve);
  } catch {
    return { valid: false, reason: "Target path cannot be resolved (symlink loop or permission denied)" };
  }

  // Verify the real target is inside the real workspace root
  const realRel = relative(realWorkspaceRoot, realTarget);
  if (realRel.startsWith("..") || isAbsolute(realRel)) {
    return {
      valid: false,
      reason: `Path "${path}" escapes workspace root via symlink (real target: ${realTarget})`,
    };
  }

  return { valid: true, resolved };
}

// ─── Hash Helper ─────────────────────────────────────────────────

function hashContent(content: string | null): string | null {
  if (content === null) return null;
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

// ─── Mutation Service ────────────────────────────────────────────

/**
 * Execute a workspace mutation with full safety guarantees.
 *
 * This is the ONLY sanctioned path for file mutations in ACT mode.
 * Direct calls to transport.writeFile() bypass all safety checks.
 */
export async function executeMutation(
  request: MutationRequest,
  transport: WorkspaceTransport,
): Promise<MutationResult> {
  const { runId, projectId, toolId, approvalTokenId, paths, operation } = request;
  const evidenceId = randomUUID();
  const startedAt = new Date().toISOString();

  // ── 1. Verify approval token ──────────────────────────────────
  const approvalStore = getApprovalStore();
  const approval = await approvalStore.verify(approvalTokenId, runId);
  if (!approval.valid) {
    throw new MutationError(
      approval.reason ?? "Approval verification failed",
      "APPROVAL_DENIED",
    );
  }

  // ── 2. Check branch safety ────────────────────────────────────
  let branch: string;
  let baseSha: string;
  let headShaBefore: string;
  try {
    const status = await transport.gitStatus();
    branch = status.branch;
    if (isProtectedBranch(branch)) {
      throw new MutationError(
        `Cannot mutate on protected branch "${branch}". Create a feature branch first.`,
        "PROTECTED_BRANCH",
      );
    }
  } catch (err) {
    if (err instanceof MutationError) throw err;
    throw new MutationError(
      `Failed to check git status: ${err instanceof Error ? err.message : String(err)}`,
      "GIT_STATUS_FAILED",
    );
  }

  // ── 3. Capture baseSha + headShaBefore ────────────────────────
  try {
    const log = await transport.gitLog({ maxCount: 1 });
    headShaBefore = log.commits[0]?.sha ?? "unknown";
    // baseSha = headShaBefore for now (merge-base computation happens
    // at the runtime level; for evidence we record what HEAD was)
    baseSha = headShaBefore;
  } catch {
    headShaBefore = "unknown";
    baseSha = "unknown";
  }

  // ── 4. Validate all paths are inside workspace root ───────────
  for (const path of paths) {
    const validation = validateWorkspacePath(path, transport.workspaceRoot);
    if (!validation.valid) {
      throw new MutationError(
        validation.reason ?? `Invalid path: ${path}`,
        "PATH_ESCAPE",
      );
    }
  }

  // ── 5. Capture before-state (file hashes) ─────────────────────
  const beforeHashes: Record<string, string | null> = {};
  for (const path of paths) {
    try {
      const { content } = await transport.readFile(path);
      beforeHashes[path] = hashContent(content);
    } catch {
      // File doesn't exist yet — null hash
      beforeHashes[path] = null;
    }
  }

  // ── 6. Create initial evidence record (status: running) ───────
  const evidenceStore = getEvidenceStore();
  const evidence: MutationEvidence = {
    id: evidenceId,
    runId,
    projectId,
    toolId,
    workspaceId: transport.workspaceId,
    branch,
    baseSha,
    headShaBefore,
    paths,
    beforeHashes,
    afterHashes: {},
    status: "running",
    startedAt,
    approvalTokenId,
  };
  await evidenceStore.insert(evidence);

  // ── 7. Execute the mutation ───────────────────────────────────
  let operationResult: unknown;
  try {
    operationResult = await operation(transport);
  } catch (err) {
    // Mutation failed — record the failure with partial state
    const errorMsg = err instanceof Error ? err.message : String(err);
    await evidenceStore.update(evidenceId, {
      status: "failed",
      error: errorMsg,
      completedAt: new Date().toISOString(),
    });
    throw new MutationError(
      `Mutation failed: ${errorMsg}`,
      "OPERATION_FAILED",
    );
  }

  // ── 8. Capture after-state (file hashes) ──────────────────────
  const afterHashes: Record<string, string | null> = {};
  for (const path of paths) {
    try {
      const { content } = await transport.readFile(path);
      afterHashes[path] = hashContent(content);
    } catch {
      // File was deleted or doesn't exist — null hash
      afterHashes[path] = null;
    }
  }

  // ── 9. Capture git diff + working tree state ──────────────────
  let diff: string | undefined;
  let workingTreeDiffHash: string | undefined;
  let workingTreeDirty: boolean | undefined;
  try {
    const diffResult = await transport.gitDiff({ path: paths.join(" ") });
    diff = diffResult.diff || undefined;
    // Hash the diff content to detect worktree changes independent of HEAD
    if (diff) {
      workingTreeDiffHash = createHash("sha256").update(diff, "utf-8").digest("hex");
    }
  } catch {
    // Diff capture is best-effort — don't fail the mutation
  }
  // Check if the working tree is dirty (has uncommitted changes)
  try {
    const postStatus = await transport.gitStatus();
    workingTreeDirty = !postStatus.clean;
  } catch {
    // Best-effort
  }

  // ── 10. Capture headShaAfter ──────────────────────────────────
  // NOTE: For uncommitted file edits, headShaAfter === headShaBefore.
  // HEAD only changes on commit. The workingTreeDiffHash + workingTreeDirty
  // fields capture the worktree state that HEAD cannot.
  let headShaAfter: string | undefined;
  try {
    const log = await transport.gitLog({ maxCount: 1 });
    headShaAfter = log.commits[0]?.sha ?? headShaBefore;
  } catch {
    headShaAfter = headShaBefore;
  }

  // ── 11. Verify the mutation actually happened ─────────────────
  // Don't trust model text — verify the file actually changed.
  let mutationVerified = false;
  for (const path of paths) {
    if (beforeHashes[path] !== afterHashes[path]) {
      mutationVerified = true;
      break;
    }
  }
  if (!mutationVerified && paths.length > 0) {
    // The operation claimed success but no file content changed.
    // This catches "tool lies about successful mutation".
    await evidenceStore.update(evidenceId, {
      status: "failed",
      error: "Mutation reported success but no file content changed (before/after hashes identical)",
      afterHashes,
      diff,
      headShaAfter,
      workingTreeDiffHash,
      workingTreeDirty,
      completedAt: new Date().toISOString(),
    });
    throw new MutationError(
      "Mutation reported success but no file content changed",
      "MUTATION_NOT_VERIFIED",
    );
  }

  // ── 12. Finalize evidence record ──────────────────────────────
  await evidenceStore.update(evidenceId, {
    status: "succeeded",
    afterHashes,
    diff,
    headShaAfter,
    workingTreeDiffHash,
    workingTreeDirty,
    completedAt: new Date().toISOString(),
  });

  // ── 13. Consume the approval token ────────────────────────────
  await approvalStore.consume(approvalTokenId);

  // Return the finalized evidence + operation result
  const finalEvidence = await evidenceStore.getById(evidenceId);
  return {
    evidence: finalEvidence ?? evidence,
    operationResult,
  };
}
