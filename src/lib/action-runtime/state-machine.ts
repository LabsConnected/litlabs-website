import { ActionRuntimeError, type ActionRunStatus } from "./types";

const transitions: Record<ActionRunStatus, ReadonlySet<ActionRunStatus>> = {
  // A queued run has never executed — it begins (starting/working) or
  // terminates (failed/cancelled); it is never "paused work".
  queued: new Set(["starting", "working", "failed", "cancelled"]),
  starting: new Set(["working", "waiting_for_user", "paused", "failed", "cancelled"]),
  working: new Set([
    "waiting_for_user",
    "user_controlling",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ]),
  waiting_for_user: new Set(["user_controlling", "working", "paused", "failed", "cancelled"]),
  user_controlling: new Set(["working", "waiting_for_user", "paused", "failed", "cancelled"]),
  paused: new Set(["starting", "working", "waiting_for_user", "user_controlling", "failed", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export function canTransitionActionRun(
  from: ActionRunStatus,
  to: ActionRunStatus,
): boolean {
  return from === to || transitions[from].has(to);
}

export function assertActionRunTransition(
  from: ActionRunStatus,
  to: ActionRunStatus,
): void {
  if (!canTransitionActionRun(from, to)) {
    throw new ActionRuntimeError(
      `Cannot transition action run from ${from} to ${to}`,
      "ACTION_RUN_INVALID_TRANSITION",
    );
  }
}

export function isTerminalActionRunStatus(status: ActionRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function shouldEmitCancellationRequest(
  status: ActionRunStatus,
  cancellationRequestedAt: string | null,
): boolean {
  return !isTerminalActionRunStatus(status) && cancellationRequestedAt === null;
}
