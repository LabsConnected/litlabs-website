import type { ActionRunStatus } from "@/lib/action-runtime/types";
import type { StudioTaskStatus } from "@/lib/studio/task-types";
import type { MessageStatus } from "@/lib/studio/types";
import type { ReconcileResult } from "./reconcile-run";

/**
 * The only agent states the LiTT App shows.
 *
 * Studio keeps its own phases, badges, and inspectors. This function is
 * the mapping those internal signals pass through on the way to the
 * consumer header. It does not read stores and it does not fetch.
 */
export type AgentStateKind = "working" | "waiting_approval" | "done" | "needs_attention";

export const AGENT_STATE_LABELS: Record<AgentStateKind, string> = {
  working: "Working",
  waiting_approval: "Waiting for approval",
  done: "Done",
  needs_attention: "Needs attention",
};

export interface AgentState {
  kind: AgentStateKind;
  label: string;
  /**
   * True when the user stopped the run. `kind` is still `done` — a stop
   * is not "Needs attention".
   */
  stopped?: boolean;
  /** Short note under the label, such as "Stopped" or "Stalled". */
  note?: string;
}

/**
 * Mirrors `ExecutionPhase` in `useExecutionStore`. Kept local so this
 * module does not import Studio's zustand singleton. A type test locks
 * the two unions together.
 */
export type LittExecutionPhase =
  | "idle"
  | "planning"
  | "inspecting"
  | "editing"
  | "testing"
  | "verifying"
  | "done"
  | "failed"
  | "cancelled"
  | "awaiting_approval"
  | "awaiting_input";

/**
 * Mirrors `ActionRunDisplayState` in the action-run projection.
 * That module is `server-only`; the literal union is duplicated here
 * and locked by a type test.
 */
export type LittActionRunDisplayState =
  | "queued"
  | "starting"
  | "running"
  | "waiting_for_user"
  | "awaiting_approval"
  | "paused"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed";

/** Coded refusal returned as HTTP 409 before a run starts. */
export const TOOL_EXECUTION_UNAVAILABLE = "TOOL_EXECUTION_UNAVAILABLE";

/**
 * A progress or conversation-stream signal. Callers pass the latest
 * event they care about; absent means "no stream signal".
 */
export type AgentProgressSignal =
  | { type: "phase" | "tool_start" | "tool_result" | "checkpoint" | "build_start" | "build_result" | "workspace_change" | "repair_attempt" | "preview_start" | "preview_status" | "preview_result" | "deploy_start" | "deploy_status" | "deploy_result" | "deploy_verify" | "model_routing" | "step_timing" | "model_response" | "reasoning" | "status" | "quality_verdict" | "text" | "tool_execution" | "actions" }
  | { type: "approval_required" | "pending_approval" }
  | { type: "finished"; success?: boolean }
  | { type: "cancelled" }
  | { type: "model_failed" }
  | { type: "error"; code?: string }
  | { type: "done"; assistantStatus?: MessageStatus };

export interface DeriveAgentStateInput {
  messageStatus?: MessageStatus | null;
  executionPhase?: LittExecutionPhase | null;
  actionRunStatus?: ActionRunStatus | null;
  actionRunDisplayState?: LittActionRunDisplayState | null;
  taskStatus?: StudioTaskStatus | null;
  progressEvent?: AgentProgressSignal | null;
  /** The user explicitly stopped this run. */
  userStopped?: boolean;
  /** A resumable approval gate is waiting for this user. */
  approvalPending?: boolean;
  /** Recovery after a dropped connection could not reattach to the run. */
  unrecoverable?: boolean;
  reconcileState?: ReconcileResult["state"] | null;
  /** API or SSE error code, such as `TOOL_EXECUTION_UNAVAILABLE`. */
  errorCode?: string | null;
  /** Provider or transport error that is not a coded refusal. */
  error?: boolean;
  /** Stall watchdog fired, or the stream went silent. */
  stalled?: boolean;
}

const WORKING_PHASES: ReadonlySet<LittExecutionPhase> = new Set([
  "planning",
  "inspecting",
  "editing",
  "testing",
  "verifying",
]);

const WORKING_RUN_STATUSES: ReadonlySet<ActionRunStatus> = new Set([
  "queued",
  "starting",
  "working",
  "waiting_for_user",
  "user_controlling",
  "paused",
]);

const WORKING_DISPLAY_STATES: ReadonlySet<LittActionRunDisplayState> = new Set([
  "queued",
  "starting",
  "running",
  "waiting_for_user",
  "paused",
  "stopping",
]);

const IN_FLIGHT_PROGRESS: ReadonlySet<AgentProgressSignal["type"]> = new Set([
  "phase",
  "tool_start",
  "tool_result",
  "checkpoint",
  "build_start",
  "build_result",
  "workspace_change",
  "repair_attempt",
  "preview_start",
  "preview_status",
  "preview_result",
  "deploy_start",
  "deploy_status",
  "deploy_result",
  "deploy_verify",
  "model_routing",
  "step_timing",
  "model_response",
  "reasoning",
  "status",
  "quality_verdict",
  "text",
  "tool_execution",
  "actions",
]);

function state(kind: AgentStateKind, extra?: Pick<AgentState, "stopped" | "note">): AgentState {
  return {
    kind,
    label: AGENT_STATE_LABELS[kind],
    ...extra,
  };
}

function stopped(input: DeriveAgentStateInput): boolean {
  if (input.userStopped) return true;
  if (input.messageStatus === "cancelled") return true;
  if (input.executionPhase === "cancelled") return true;
  if (input.actionRunStatus === "cancelled") return true;
  if (input.actionRunDisplayState === "stopped") return true;
  if (input.reconcileState === "cancelled") return true;
  if (input.progressEvent?.type === "cancelled") return true;
  if (input.progressEvent?.type === "done" && input.progressEvent.assistantStatus === "cancelled") {
    return true;
  }
  return false;
}

function waiting(input: DeriveAgentStateInput): boolean {
  if (input.approvalPending) return true;
  if (input.messageStatus === "awaiting_approval") return true;
  if (input.executionPhase === "awaiting_approval") return true;
  if (input.actionRunDisplayState === "awaiting_approval") return true;
  if (input.taskStatus === "waiting_approval") return true;
  if (input.reconcileState === "awaiting_approval") return true;
  const progress = input.progressEvent?.type;
  if (progress === "approval_required" || progress === "pending_approval") return true;
  if (input.progressEvent?.type === "done" && input.progressEvent.assistantStatus === "awaiting_approval") {
    return true;
  }
  return false;
}

function attentionCode(input: DeriveAgentStateInput): string | null {
  if (input.errorCode) return input.errorCode;
  if (input.progressEvent?.type === "error" && input.progressEvent.code) return input.progressEvent.code;
  return null;
}

function needsAttention(input: DeriveAgentStateInput): boolean {
  if (input.stalled || input.unrecoverable || input.error) return true;
  if (attentionCode(input) === TOOL_EXECUTION_UNAVAILABLE) return true;
  if (input.messageStatus === "failed") return true;
  if (input.executionPhase === "failed" || input.executionPhase === "awaiting_input") return true;
  if (input.actionRunStatus === "failed") return true;
  if (input.actionRunDisplayState === "failed") return true;
  if (input.taskStatus === "failed" || input.taskStatus === "needs_verification") return true;
  if (input.reconcileState === "failed" || input.reconcileState === "unknown") return true;
  const progress = input.progressEvent;
  if (!progress) return false;
  if (progress.type === "error" || progress.type === "model_failed") return true;
  if (progress.type === "finished" && progress.success === false) return true;
  if (progress.type === "done" && progress.assistantStatus === "failed") return true;
  return false;
}

function attentionNote(input: DeriveAgentStateInput): string {
  if (attentionCode(input) === TOOL_EXECUTION_UNAVAILABLE) return "Tools unavailable";
  if (input.stalled) return "Stalled";
  if (input.unrecoverable || input.reconcileState === "unknown") return "Couldn't recover this run";
  if (input.taskStatus === "needs_verification") return "Needs verification";
  if (input.executionPhase === "awaiting_input") return "Waiting for you";
  if (input.error) return "Error";
  return "Failed";
}

function working(input: DeriveAgentStateInput): boolean {
  if (input.messageStatus === "pending" || input.messageStatus === "streaming") return true;
  if (input.executionPhase && WORKING_PHASES.has(input.executionPhase)) return true;
  if (input.actionRunStatus && WORKING_RUN_STATUSES.has(input.actionRunStatus)) return true;
  if (input.actionRunDisplayState && WORKING_DISPLAY_STATES.has(input.actionRunDisplayState)) return true;
  if (input.taskStatus === "working") return true;
  if (input.reconcileState === "running") return true;
  if (input.progressEvent && IN_FLIGHT_PROGRESS.has(input.progressEvent.type)) return true;
  return false;
}

function done(input: DeriveAgentStateInput): boolean {
  if (input.messageStatus === "completed") return true;
  if (input.executionPhase === "done") return true;
  if (input.actionRunStatus === "completed") return true;
  if (input.actionRunDisplayState === "completed") return true;
  if (input.taskStatus === "ready" || input.taskStatus === "complete") return true;
  if (input.reconcileState === "completed") return true;
  const progress = input.progressEvent;
  if (progress?.type === "finished" && progress.success !== false) return true;
  if (progress?.type === "done" && (progress.assistantStatus === "completed" || progress.assistantStatus === undefined)) {
    return true;
  }
  return false;
}

/**
 * Map internal run signals to one consumer state, or null when nothing
 * is in flight and nothing just finished.
 *
 * Precedence:
 * 1. A user stop (or a cancelled / stopped terminal status) is Done
 *    with `stopped: true`. It beats failures and open approval gates.
 * 2. A pending approval is Waiting for approval. It beats failures,
 *    stalls, and in-flight work — the user has to decide.
 * 3. Failure, error, stall, `needs_verification`, `awaiting_input`,
 *    an unrecoverable or unknown recovery, and
 *    `TOOL_EXECUTION_UNAVAILABLE` are Needs attention.
 * 4. Live work is Working. `stopping` (stop not confirmed yet) stays
 *    Working unless the caller sets `userStopped`.
 * 5. A confirmed success is Done.
 * 6. Idle, a closed task, and an empty snapshot are null.
 */
export function deriveAgentState(input: DeriveAgentStateInput = {}): AgentState | null {
  if (stopped(input)) {
    return state("done", { stopped: true, note: "Stopped" });
  }
  if (waiting(input)) {
    return state("waiting_approval");
  }
  if (needsAttention(input)) {
    return state("needs_attention", { note: attentionNote(input) });
  }
  if (working(input)) {
    return state("working");
  }
  if (done(input)) {
    return state("done");
  }
  return null;
}
