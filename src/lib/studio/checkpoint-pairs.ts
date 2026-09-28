/**
 * Run checkpoints — pure helpers shared by the agent loop (server) and the
 * Studio (client).
 *
 * Every run that mutates the workspace now leaves TWO durable checkpoints:
 *   before — "Pre-agent-loop: …" (existing, created before the first write)
 *   after  — "After LiTT run: …" (new, created once the run's changes land)
 * Both are git commits recorded in project_checkpoints, so they survive a
 * refresh. Revert restores `before`; Accept keeps `after`.
 */

export const AFTER_RUN_PREFIX = "After LiTT run: ";
const BEFORE_RUN_PREFIXES = ["Pre-agent-loop", "checkpoint: LiTT starter scaffolding"];

export function postRunCheckpointLabel(request: string | null | undefined): string {
  const text = (request ?? "").replace(/\s+/g, " ").trim();
  return `${AFTER_RUN_PREFIX}${text ? text.slice(0, 80) : "changes applied"}`;
}

export function isAfterRunCheckpoint(label: string | null | undefined): boolean {
  return !!label && label.startsWith(AFTER_RUN_PREFIX);
}

export function isBeforeRunCheckpoint(label: string | null | undefined): boolean {
  return !!label && BEFORE_RUN_PREFIXES.some((p) => label.startsWith(p));
}

export interface CheckpointLike {
  id?: string;
  label: string;
  gitSha: string;
  createdAt?: string;
}

/**
 * From a project's checkpoints (any order), find the most recent run:
 * its `after` checkpoint and the `before` checkpoint that precedes it.
 * With no after-checkpoint (runs from before this change), the latest
 * before-checkpoint is still returned so Revert keeps working.
 */
export function latestRunCheckpoints<T extends CheckpointLike>(
  checkpoints: readonly T[],
): { before: T | null; after: T | null } {
  const sorted = [...checkpoints].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return tb - ta;
  });
  const afterIdx = sorted.findIndex((c) => isAfterRunCheckpoint(c.label));
  const searchFrom = afterIdx === -1 ? 0 : afterIdx + 1;
  const before = sorted.slice(searchFrom).find((c) => isBeforeRunCheckpoint(c.label)) ?? null;
  return { before, after: afterIdx === -1 ? null : sorted[afterIdx] };
}
