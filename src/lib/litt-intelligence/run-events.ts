/**
 * Run Event Model
 *
 * Chronological events for the Activity panel. One event store,
 * two views (Changes + Activity). Events reference MutationEvidence
 * records when relevant.
 *
 * Phase 7 — Studio Control Plane V1
 */

export type RunEventType =
  | "plan_created"
  | "approval_requested"
  | "approval_granted"
  | "approval_denied"
  | "approval_expired"
  | "act_started"
  | "act_completed"
  | "tool_started"
  | "tool_completed"
  | "tool_failed"
  | "file_changed"
  | "diff_captured"
  | "mutation_verified"
  | "mutation_blocked"
  | "command_executed"
  | "check_passed"
  | "check_failed"
  | "check_skipped"
  | "recovery_attempt"
  | "checkpoint_created"
  | "branch_created"
  | "branch_switched";

export interface RunEvent {
  /** Unique event ID */
  id: string;
  /** The run this event belongs to */
  runId: string;
  /** Project ID */
  projectId: string;
  /** User who triggered the event */
  userId?: string;
  /** Event type */
  eventType: RunEventType;
  /** Event-specific data (tool ID, file path, reason, etc.) */
  eventData: Record<string, unknown>;
  /** Associated MutationEvidence record, if any */
  evidenceId?: string;
  /** When the event occurred */
  createdAt: string;
}

// ─── Event factory helpers ───────────────────────────────────────

export function createRunEvent(
  runId: string,
  projectId: string,
  eventType: RunEventType,
  eventData: Record<string, unknown> = {},
  options?: { userId?: string; evidenceId?: string },
): RunEvent {
  return {
    id: `${runId}_${eventType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    runId,
    projectId,
    userId: options?.userId,
    eventType,
    eventData,
    evidenceId: options?.evidenceId,
    createdAt: new Date().toISOString(),
  };
}
