/**
 * P0 R6 — destructive-action safety (Execution Integrity Contract,
 * addendum §R6; origin: Acceptance Run 1 restart, 2026-11-26).
 *
 * That run's agent requested four consecutive files.delete approvals
 * whose cards named NO target; three approved deletes removed the two
 * images index.html referenced, and publishing broke. The founder's
 * ruling: LiTT protects customers from destructive agent mistakes
 * instead of asking them to approve those mistakes. Concretely:
 *
 *   - Every destructive approval carries the structured card data:
 *     exact target, operation, reason, affected dependencies,
 *     expected consequences, recovery availability, blocked status,
 *     and the available actions (replace / cancel / review).
 *   - An approval for an UNIDENTIFIED target is impossible: the gate
 *     refuses to create it and feeds the refusal back to the model.
 *   - Before a project asset deletion executes, its references are
 *     inspected with the ONE existing reference machinery (the deploy
 *     validator's extractLocalAssetRefs — no second audit system).
 *     Deleting an asset that live project files still reference is
 *     BLOCKED; the delete may only land once the references have been
 *     repaired (removed or repointed) — which is how "the authorized
 *     operation includes repairing their references" is honored.
 *   - Repetitive destructive approval loops are stopped: a streak of
 *     destructive events (gated, executed, or rejected) with no
 *     intervening successful non-destructive mutation ends the run
 *     honestly instead of producing another approval card.
 *
 * Scope: files.delete is the only workspace-file-destroying tool in
 * the registry (verified 2026-11-26). The git destructive operations
 * (git.push / git.force_push / git.reset_hard / git.rebase) stay
 * gated by the permission engine as before — they have no
 * project-asset dependency semantics, so they are not part of this
 * module's set.
 */

import { extractLocalAssetRefs } from "@/lib/deployments/user-deployment";
import type { WorkspaceTransport } from "./workspace-transport";

/** Tools whose execution destroys workspace files. */
export const DESTRUCTIVE_TOOL_IDS: ReadonlySet<string> = new Set(["files.delete"]);

export function isDestructiveTool(toolId: string): boolean {
  return DESTRUCTIVE_TOOL_IDS.has(toolId);
}

/**
 * Consecutive destructive events (an executed or rejected delete, or
 * a gate about to be created) with no intervening successful
 * non-destructive mutation that ends the run instead of asking again.
 * Three matches the incident shape: the fourth consecutive delete is
 * where the human had to intervene by hand.
 */
export const DESTRUCTIVE_GATE_STREAK_LIMIT = 3;

/** One project file that references the deletion target. */
export interface DestructiveDependency {
  /** Workspace-relative path of the referencing file. */
  path: string;
  /** The reference exactly as resolved (workspace-relative target path). */
  reference: string;
}

export type DestructiveActionKind = "replace" | "cancel" | "review";

/**
 * The approval-card data contract for a destructive action. Rides the
 * pause/approval payload (PendingApproval) into the persisted
 * paused-run record so the client can render the founder's card
 * standard: named target + operation + risk, the dependency check,
 * BLOCKED when dependencies are unresolved, and the actions.
 */
export interface DestructiveActionAssessment {
  toolId: string;
  /** Human operation label, e.g. "Delete file". */
  operation: string;
  /** The exact workspace-relative target — never null on a created
   *  approval (an unidentified target creates no approval at all). */
  target: string;
  /** Why the operation was requested (the permission engine's reason). */
  reason: string;
  /** Live project files that reference the target. */
  dependencies: DestructiveDependency[];
  /** True when dependencies are unresolved: the deletion is blocked
   *  and cannot execute until the references are repaired. */
  blocked: boolean;
  /** Expected consequences, in plain language. */
  consequences: string;
  /** Whether the deletion can be undone (a workspace checkpoint
   *  baseline exists for this run). */
  recovery: "checkpoint" | "none";
  availableActions: DestructiveActionKind[];
  /** This gate's position in the run's current destructive streak
   *  (1-based) — the loop evidence behind the streak limit. */
  gateStreak: number;
}

/** Normalize a model-supplied path to workspace-relative form. A
 *  blank or whitespace-only path identifies no target. */
export function normalizeWorkspacePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  return normalized.length > 0 ? normalized : null;
}

/**
 * The exact target a destructive call names, or null when it names
 * none. files.delete's only target input is `path`; a missing, blank,
 * or non-string path is an unidentified target.
 */
export function destructiveTargetFor(
  toolId: string,
  inputs: Record<string, unknown> | undefined,
): string | null {
  if (!isDestructiveTool(toolId)) return null;
  return normalizeWorkspacePath(inputs?.path);
}

/** The refusal fed back when a destructive call names no target. The
 *  gate never creates an approval for it — approving an unidentified
 *  deletion is exactly the incident this repair exists to prevent. */
export function unidentifiedDestructiveTargetError(toolId: string): string {
  return (
    `${toolId} refused: a destructive action must name its exact target file, ` +
    `and this request identified none. No approval was created and nothing was deleted. ` +
    `Re-issue the call with the exact workspace path of the file to delete.`
  );
}

/** The honest failure that ends a run stuck in a destructive loop. */
export function destructiveLoopError(toolId: string, streak: number): string {
  return (
    `Stopping: this run has requested ${streak} destructive actions (${toolId}) in a row ` +
    `with no other completed work in between. Repeated delete requests are how project ` +
    `files the site needs got removed in the 2026-11-26 acceptance run, so the run ends ` +
    `here instead of asking for another deletion. Nothing further was deleted.`
  );
}

/**
 * The run's current destructive streak: trailing tool-log entries
 * that are destructive events (executed or rejected — both are the
 * run asking to destroy something), stopping at the first successful
 * NON-destructive mutation (real progress elsewhere resets the
 * streak). Read-only and failed non-destructive entries neither add
 * to nor reset the streak.
 */
export function trailingDestructiveStreak(
  toolCallLog: ReadonlyArray<{ toolId: string; success: boolean; mutating: boolean }>,
): number {
  let streak = 0;
  for (let i = toolCallLog.length - 1; i >= 0; i--) {
    const entry = toolCallLog[i];
    if (isDestructiveTool(entry.toolId)) {
      streak += 1;
      continue;
    }
    if (entry.mutating && entry.success) return streak;
  }
  return streak;
}

const MAX_REFERENCE_SCAN_FILES = 80;
const MAX_REFERENCE_SCAN_DEPTH = 3;

/**
 * Inspect which live project files reference `target`, using the
 * deploy validator's own reference extractor over the workspace's
 * HTML and CSS files (the files whose references the publish gate
 * itself honors). A directory target matches every reference at or
 * beneath it. The `public/` serving prefix is honored both ways (a
 * file stored under public/ is referenced without the prefix).
 *
 * Never throws and never blocks on absent evidence: an unreadable or
 * unlistable workspace yields an empty dependency list — the same
 * "unknown is not a verdict" rule the rest of the evidence system
 * follows. The execution-time block in the delete handler applies
 * the same rule.
 */
export async function findAssetReferences(
  transport: WorkspaceTransport,
  target: string,
): Promise<DestructiveDependency[]> {
  const dependencies: DestructiveDependency[] = [];
  try {
    const files: string[] = [];
    const collect = async (dir: string, prefix: string, depth: number): Promise<void> => {
      if (depth > MAX_REFERENCE_SCAN_DEPTH || files.length >= MAX_REFERENCE_SCAN_FILES) return;
      const res = await transport.listFiles(dir).catch(() => null);
      for (const e of res?.entries ?? []) {
        const p = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.type === "file") {
          if (/\.(html?|css)$/i.test(e.name)) files.push(p);
        } else if (e.type === "directory") {
          await collect(p, p, depth + 1);
        }
      }
    };
    await collect("", "", 0);

    const matches = (ref: string): boolean => {
      if (ref === target || ref === `public/${target}`) return true;
      if (target.startsWith("public/") && ref === target.slice("public/".length)) return true;
      // Directory target: every reference at or beneath it.
      return ref.startsWith(`${target}/`);
    };

    for (const file of files.slice(0, MAX_REFERENCE_SCAN_FILES)) {
      if (file === target) continue;
      const read = await transport.readFile(file).catch(() => null);
      if (!read?.content) continue;
      const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
      for (const ref of extractLocalAssetRefs(read.content, dir)) {
        if (matches(ref)) {
          dependencies.push({ path: file, reference: ref });
          break; // one entry per referencing file is enough for the card
        }
      }
    }
  } catch {
    return [];
  }
  return dependencies;
}

/**
 * Build the card data for one destructive gate. `gateStreak` is the
 * streak position this gate occupies (trailing streak + 1), computed
 * by the caller from the run's tool log.
 */
export async function assessDestructiveAction(opts: {
  toolId: string;
  inputs: Record<string, unknown>;
  reason: string;
  transport: WorkspaceTransport;
  recoveryAvailable: boolean;
  gateStreak: number;
}): Promise<DestructiveActionAssessment | null> {
  const target = destructiveTargetFor(opts.toolId, opts.inputs);
  if (!target) return null;
  const dependencies = await findAssetReferences(opts.transport, target);
  const blocked = dependencies.length > 0;
  return {
    toolId: opts.toolId,
    operation: opts.toolId === "files.delete" ? "Delete file" : opts.toolId,
    target,
    reason: opts.reason,
    dependencies,
    blocked,
    consequences: blocked
      ? `Deleting ${target} now would break the ${dependencies.length === 1 ? "page" : "pages"} ` +
        `that reference it — they would lose this asset. The deletion stays blocked until ` +
        `those references are repaired or the asset is replaced.`
      : `The file ${target} will be permanently removed from the project workspace. ` +
        `No project file references it.`,
    recovery: opts.recoveryAvailable ? "checkpoint" : "none",
    availableActions: blocked ? ["replace", "cancel", "review"] : ["cancel", "review"],
    gateStreak: opts.gateStreak,
  };
}

/**
 * The approval-card reason text for a destructive gate — the
 * founder's card standard rendered as the reason the chat displays:
 * named target, operation, risk, the dependency check, BLOCKED when
 * unresolved, and the recovery position.
 */
export function destructiveApprovalReason(
  assessment: DestructiveActionAssessment,
  fallbackReason: string,
): string {
  const lines: string[] = [
    assessment.operation === "Delete file" ? "Delete project asset" : assessment.operation,
    `Target: ${assessment.target}`,
    `Operation: ${assessment.operation} (${assessment.toolId})`,
    `Risk: High`,
    ``,
    `Dependency check:`,
  ];
  if (assessment.dependencies.length === 0) {
    lines.push(`- No project file references this asset.`);
  } else {
    for (const dep of assessment.dependencies) {
      lines.push(`- ${dep.path} references this asset (${dep.reference}).`);
    }
  }
  if (assessment.blocked) {
    lines.push(``, `Status: BLOCKED`, `Replace the image or repair its references before deletion.`);
  }
  lines.push(
    ``,
    assessment.recovery === "checkpoint"
      ? `Recovery: a workspace checkpoint exists, so this deletion can be reverted.`
      : `Recovery: no workspace checkpoint exists — this deletion cannot be reverted.`,
    ``,
    fallbackReason,
  );
  return lines.join("\n");
}
