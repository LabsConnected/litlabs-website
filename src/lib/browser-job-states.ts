/**
 * Browser job state machine — the single source of truth for which
 * job status transitions are legal.
 *
 * This module is dependency-free (no Supabase, no server-only imports)
 * so it can be used from both server code (`src/lib/browser-jobs.ts`
 * enforces it on every status mutation) and client components (the
 * Studio job card renders its state badge from it).
 *
 * The machine:
 *   queued ──► running ──► awaiting_approval ──► approved ──┐
 *     │           │            │ (cancel)                      │ (resume)
 *     │           ├─► completed │                               ▼
 *     │           └─► failed    └──► cancelled              running
 *     └─► cancelled
 *
 * Terminal states (completed, failed, cancelled) have NO outgoing
 * transitions — they are immutable. A second executor racing to
 * complete an already-terminal job simply no-ops.
 *
 * Display states (for the Studio card) are derived from the stored
 * status via JOB_DISPLAY_STATE — they are truthful renames, not new
 * statuses: "completed" is shown as "Succeeded", "awaiting_approval"
 * as "Waiting for approval". The stored status values never change.
 */

import type { JobStatus } from "./browser-jobs";

/** Legal next statuses for every job status. Empty = terminal. */
export const JOB_STATE_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["awaiting_approval", "completed", "failed"],
  awaiting_approval: ["approved", "cancelled"],
  approved: ["running", "completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

/** True when `to` is a legal successor of `from`. */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return (JOB_STATE_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * All statuses that may legally transition into `to`.
 * Used to build atomic conditional DB updates: the update matches
 * only rows whose current status is a legal source, so an illegal
 * transition is a no-op instead of a silent corruption.
 */
export function legalSourcesFor(to: JobStatus): JobStatus[] {
  return (Object.keys(JOB_STATE_TRANSITIONS) as JobStatus[]).filter((from) =>
    canTransition(from, to),
  );
}

/** True when no transition out of this status exists. */
export function isTerminalStatus(status: JobStatus): boolean {
  return JOB_STATE_TRANSITIONS[status].length === 0;
}

export interface JobDisplayState {
  /** Truthful user-facing label. */
  label: string;
  /** Job is still in flight (poll aggressively, show live controls). */
  active: boolean;
  /** Job is finished — its state badge and card never change again. */
  terminal: boolean;
}

/**
 * Display state per stored status. Labels must never over-claim:
 * a job is only "Succeeded" when it actually reached `completed`;
 * an error is only shown when one was recorded.
 */
export const JOB_DISPLAY_STATE: Record<JobStatus, JobDisplayState> = {
  queued: { label: "Queued", active: true, terminal: false },
  running: { label: "Running", active: true, terminal: false },
  awaiting_approval: { label: "Waiting for approval", active: true, terminal: false },
  approved: { label: "Approved — resuming", active: true, terminal: false },
  completed: { label: "Succeeded", active: false, terminal: true },
  failed: { label: "Failed", active: false, terminal: true },
  cancelled: { label: "Cancelled", active: false, terminal: true },
};

export function describeJobState(status: JobStatus): JobDisplayState {
  return JOB_DISPLAY_STATE[status];
}
