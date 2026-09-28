"use client";

import { create } from "zustand";
import type { StructuredDiagnostic } from "@/lib/litt-intelligence/diagnostic-parser";
import type { ActionRunDisplayState } from "../components/ActionRunStatusPanel";

/**
 * Execution Store — single source of truth for LiTT's live execution state.
 *
 * Captures real-time events from the SSE stream (tool calls, phases, checkpoints,
 * build results, approvals) and exposes them for the LiTT Live Activity panel.
 *
 * Events are NOT chain-of-thought. They are actionable, inspectable summaries:
 *   "Reading CommandStudio.tsx to find where the right panel is mounted."
 *   "Typecheck passed. Running browser verification next."
 */

export type ExecutionPhase =
  | "idle"
  | "planning"
  | "researching" // Station Control bridge (§9): research work
  | "creating" // Station Control bridge (§9): image/video/music/audio generation
  | "inspecting"
  | "editing"
  | "browsing" // Station Control bridge (§9): browser station activity
  | "running" // Station Control bridge (§9): terminal commands
  | "testing"
  | "verifying"
  | "deploying" // Station Control bridge (§9): deploy station activity
  | "done" // Contract §9 calls this "complete" (renamed from done) —
           // kept as "done" per bridge spec: additive only, no renames.
  | "failed"
  | "cancelled"
  | "awaiting_approval"
  | "awaiting_input";

export interface ExecutionEvent {
  id: string;
  /** Monotonic sequence number for ordering and collapse */
  seq: number;
  type:
    | "phase"
    | "tool_start"
    | "tool_result"
    | "tool_error"
    | "checkpoint"
    | "build_start"
    | "build_result"
    | "approval_required"
    | "approval_resolved"
    | "finished"
    | "cancelled"
    | "reasoning"
    | "status"
    | "model_routing"
    | "model_failed"
    | "repair_attempt"
    | "preview"
    | "deploy";
  /** Human-readable summary (NOT chain-of-thought) */
  summary: string;
  /** Tool ID for tool events */
  toolId?: string;
  /**
   * Approval-gate id (pausedRunId) for approval_required entries. Lets the
   * activity feed dedupe repeated signals for the same gate instead of
   * stacking duplicate "Approval needed" entries.
   */
  gateId?: string;
  /** Success/failure for result events */
  success?: boolean;
  /** Duration in ms for completed operations */
  durationMs?: number;
  /** Checkpoint label/gitSha */
  label?: string;
  gitSha?: string;
  /** Build check name */
  check?: string;
  /** Error count for build results */
  errorCount?: number;
  /** Structured compiler/lint/test diagnostics from the real command output. */
  diagnostics?: StructuredDiagnostic[];
  /** Phase */
  phase?: ExecutionPhase;
  /** Step number within the agent loop */
  step?: number;
  /** Timestamp */
  ts: number;
  /**
   * F1 slice C — worktab id this event belongs to. Tagged at ingestion
   * from the store's activeTaskId (set by the shell on worktab switch).
   * Absent on events recorded before tagging or with no active worktab.
   */
  taskId?: string;
  /** Whether this event is collapsed in the UI */
  collapsed?: boolean;
  /** Whether this event is a low-level operation that can be auto-collapsed */
  lowLevel?: boolean;
  /** Associated file path (for click-to-open) */
  filePath?: string;
  /** Associated diff (for edit operations) */
  diff?: string;
  /** Model name for model_routing events */
  model?: string;
  /** Provider for model_routing events */
  provider?: string;
  /** Fallback source model for model_routing events */
  fallbackFrom?: string;
  /** Failure category for model_failed events */
  category?: string;
  /** Error message for model_failed events (sanitized, no secrets) */
  message?: string;
}

export interface PendingApproval {
  toolId: string;
  reason: string;
  pausedRunId?: string;
  /**
   * Conversation the paused run belongs to, captured at mount time.
   * The Approve/Reject POST must go to THIS conversation — the one the
   * pausedRunId was issued in — not whichever conversation happens to be
   * selected when the user clicks. Posting to a different conversation
   * deterministically 403s with "Conversation mismatch" (the server
   * verifies the paused run's stored conversationId), which used to
   * dead-end the card as unretryable when the user switched or created a
   * conversation after the gate mounted.
   */
  conversationId?: string;
  inputs?: Record<string, unknown>;
}

/**
 * Client-side phase of the approval lifecycle. The card stays mounted
 * through every phase — it only unmounts when the run reaches a terminal
 * state (completed/rejected/expired/gone) or a fresh gate replaces it.
 * A non-2xx approval POST or a failed run lands in "failed" with the
 * backend error visible and a Retry affordance; nothing silently clears.
 */
export type ApprovalPhase = "idle" | "submitting" | "executing" | "failed";

export type MutationKind = "created" | "modified" | "deleted" | "renamed";

export interface MutationSummary {
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
}

interface ExecutionStore {
  // ── State ──
  events: ExecutionEvent[];
  phase: ExecutionPhase;
  isRunning: boolean;
  currentStep: number;
  pendingApproval: PendingApproval | null;
  /**
   * pausedRunIds whose gates have reached a terminal decision (approved /
   * rejected) on this client. A late or duplicated `pending_approval` SSE
   * event for one of these IDs must NOT re-arm the gate — the run already
   * completed and re-mounting would leave a stuck "Approval waiting" badge
   * with no live card to clear it. Bounded to the most recent 50.
   */
  resolvedPausedRunIds: string[];
  /** Client-side approval lifecycle phase — the card stays mounted through all of them. */
  approvalPhase: ApprovalPhase;
  /** Backend error shown on the card when approvalPhase is "failed". */
  approvalError: string | null;
  /** Whether the failed approval may be retried (re-POST the same pausedRunId). */
  approvalRetryable: boolean;
  /**
   * True when the failure was an expiry: the gate is gone server-side and
   * "Retry" must re-request a fresh gate (re-request endpoint), not re-POST
   * the dead pausedRunId (which would 409). Set by failApproval({expired}).
   */
  approvalExpired: boolean;
  /** Pre-run baseline — the Revert target. */
  checkpoint: { label: string; gitSha: string } | null;
  /** Post-run checkpoint — what Accept keeps. */
  afterCheckpoint: { label: string; gitSha: string } | null;
  /** Tool calls in the current run */
  toolCalls: Array<{ toolId: string; success?: boolean; summary: string }>;
  /** Changes summary, classified by the actual mutation operation. */
  changesSummary: MutationSummary | null;
  /**
   * True while the Studio preview is being prepared (workspace provisioning +
   * dev server start + health check). Drives the operator bar so it doesn't
   * misleadingly show "Idle" during preview preparation. Only set when no
   * agent run is in progress (agent runs take precedence).
   */
  previewPreparing: boolean;
  /**
   * F1 slice C — currently-active worktab id. SSE events ingested while
   * this is set are tagged with it (see addEvent). Set by the shell via
   * setActiveTaskId() when the active worktab changes — wired to the
   * durable server task id.
   */
  activeTaskId: string | null;
  /**
   * F1 — server-fed conversation→task index. The shell keeps this in sync
   * with the durable task list (GET /api/studio/tasks) so SSE events
   * attribute to the tab OWNING the conversation even while another tab
   * is active. Replaces the old client-local worktab store binding.
   */
  taskConversationIndex: Record<string, string>;
  /**
   * F1 slice C — per-worktab execution phase, keyed by worktab id.
   * Mirrored from every global phase transition while that worktab is
   * active. Read via phaseForTask(taskId); unknown ids read as "idle".
   */
  taskPhases: Record<string, ExecutionPhase>;

  // ── Actions ──
  startRun: () => void;
  endRun: (reason?: string) => void;
  addEvent: (event: Omit<ExecutionEvent, "id" | "seq" | "ts">) => void;
  setPhase: (phase: ExecutionPhase, taskId?: string) => void;
  setPendingApproval: (approval: PendingApproval | null) => void;
  resolveApproval: (decision: "approved" | "rejected") => void;
  /** Approval POST submitted — card stays mounted, shows submitting state. */
  beginApprovalSubmit: () => void;
  /** Approval POST accepted (202) — card shows the run executing. */
  approvalAccepted: () => void;
  /**
   * Approval POST failed (non-2xx) or the resumed run failed. Converges the
   * gate to the failed state:
   * - When the decision was recorded and the run failed afterwards
   *   (`decisionRecorded: true`, not expired), the gate is dead — the
   *   Approve/Reject pair must not stay actionable, so pendingApproval is
   *   cleared and phase becomes "failed" (never "awaiting_approval"). The
   *   failure itself is already on the transcript; recovery is a new
   *   request, not a replay of the identical frozen run.
   * - When the decision never landed server-side (`decisionRecorded:
   *   false`) or the gate expired, the gate is still actionable — the card
   *   stays mounted with the error and its retry/re-request affordance.
   * Never silently clears, never auto re-requests.
   */
  failApproval: (
    error: string,
    retryable?: boolean,
    opts?: { expired?: boolean; decisionRecorded?: boolean },
  ) => void;
  setCheckpoint: (checkpoint: { label: string; gitSha: string } | null) => void;
  setAfterCheckpoint: (checkpoint: { label: string; gitSha: string } | null) => void;
  /**
   * Restore persisted run checkpoints (after a refresh) WITHOUT emitting
   * activity events and without overwriting live-run values.
   */
  hydrateCheckpoints: (pair: {
    before: { label: string; gitSha: string } | null;
    after: { label: string; gitSha: string } | null;
  }) => void;
  collapseEvent: (id: string) => void;
  collapseLowLevel: () => void;
  clearEvents: () => void;
  setPreviewPreparing: (preparing: boolean) => void;
  /**
   * F1 slice C — set the active worktab id for event tagging.
   * Called by the shell when the active worktab changes.
   */
  setActiveTaskId: (taskId: string | null) => void;
  /**
   * F1 — refresh the conversation→task index from the durable task list.
   * Called by the shell whenever the server task list changes. No-ops
   * when the mapping is unchanged so subscribers never re-render spuriously.
   */
  setTaskConversationIndex: (
    tasks: Array<{ id: string; conversationId: string | null }>,
  ) => void;
  /**
   * F1 — record a phase for a specific worktab, attributed from the SSE
   * stream's own conversation (not the active tab). Used by the SSE
   * ingestor so a background tab's run reaches "done" on real completion.
   */
  setTaskPhase: (taskId: string, phase: ExecutionPhase) => void;
  /**
   * F1 slice C — events for one worktab. With no taskId this returns
   * the full event list (today's global behavior — backwards compatible).
   */
  eventsForTask: (taskId?: string) => ExecutionEvent[];
  /**
   * F1 slice C — phase for one worktab. With no taskId this returns the
   * global phase (today's behavior). Unknown worktabs read as "idle".
   */
  phaseForTask: (taskId?: string) => ExecutionPhase;
  reset: () => void;
}

let seqCounter = 0;
let idCounter = 0;

/**
 * F1 slice C — mirror the current global phase into `taskPhases` under
 * the active worktab id. Called at the end of every action that mutates
 * `phase`. Strictly additive: existing transitions keep their exact
 * behavior; this only records the per-worktab view. The simplified
 * parameter types keep this helper decoupled from zustand's overloads.
 */
function mirrorTaskPhase(
  get: () => {
    activeTaskId: string | null;
    phase: ExecutionPhase;
    taskPhases: Record<string, ExecutionPhase>;
  },
  set: (
    updater: (s: {
      taskPhases: Record<string, ExecutionPhase>;
    }) => { taskPhases: Record<string, ExecutionPhase> },
  ) => void,
  // F1: explicit attribution target. SSE-ingested phases attribute to the
  // run's OWNING worktab (resolved from the stream's conversation); every
  // other caller attributes to the active tab (today's behavior).
  targetTaskId?: string,
): void {
  const { activeTaskId, phase, taskPhases } = get();
  const target = targetTaskId ?? activeTaskId;
  if (!target || taskPhases[target] === phase) return;
  set((s) => ({ taskPhases: { ...s.taskPhases, [target]: phase } }));
}

function nextId(): string {
  return `exec_${Date.now()}_${idCounter++}`;
}

/**
 * F1: resolve the worktab id for an SSE stream's conversation. Events must
 * attribute to the tab that OWNS the run (via its bound conversation), not
 * to whichever tab is active when the event lands — otherwise a run started
 * in tab A would paint tab B's badge after a switch, and tab A could never
 * reach "ready". Falls back to the active tab (today's behavior) when the
 * conversation isn't bound to any tab (e.g. pre-F1 flows).
 */
function resolveTaskIdForConversation(
  conversationId: string | undefined,
  store: typeof useExecutionStore,
): string | undefined {
  if (conversationId) {
    const taskId = store.getState().taskConversationIndex[conversationId];
    if (taskId) return taskId;
  }
  return store.getState().activeTaskId ?? undefined;
}

/** Map agent-loop phase names to user-facing execution phases */
function mapPhase(phase: string, step: number): ExecutionPhase {
  switch (phase) {
    case "inspect":
      return "inspecting";
    case "call_llm":
      return step <= 1 ? "planning" : "editing";
    case "execute":
      return "editing";
    case "build_fix":
      return "testing";
    // Preview start/health-check and deploy are verification work — showing
    // "Editing" while the preview boots or a deploy runs misreports the run.
    case "preview":
    case "deploy":
      return "verifying";
    case "finished":
      return "done";
    case "cancelled":
      return "cancelled";
    // Station Control bridge (§9): the new first-class phases pass through
    // when the agent loop / SSE feed names them directly, instead of
    // falling into the "editing" default and misreporting the run.
    case "researching":
      return "researching";
    case "creating":
      return "creating";
    case "browsing":
      return "browsing";
    case "running":
      return "running";
    case "deploying":
      return "deploying";
    default:
      return "editing";
  }
}

/**
 * Approval-entry dedupe helpers. The agent loop can emit several signals for
 * one approval gate (an `approval_required` progress signal, then a
 * `pending_approval` with the gate's pausedRunId, plus re-fires on SSE
 * reconnect). Without dedupe the activity feed stacks 2-3 identical
 * "Approval needed" entries per gate.
 *
 * Gates are sequential — at most one gate is pending at a time — so an
 * `approval_resolved` event closes every approval_required entry before it.
 */

/**
 * Index of the most recent approval_required entry that is still open (no
 * approval_resolved after it), matches toolId, and has no gateId claimed
 * yet. -1 when there is none.
 */
function findUnclaimedApprovalIndex(events: ExecutionEvent[], toolId: string): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "approval_resolved") return -1;
    if (e.type === "approval_required" && e.toolId === toolId && !e.gateId) return i;
  }
  return -1;
}

/** Whether an approval_required entry for this gate id is still open. */
function hasOpenApprovalEntry(events: ExecutionEvent[], gateId: string): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "approval_resolved") return false;
    if (e.type === "approval_required" && e.gateId === gateId) return true;
  }
  return false;
}

/** Classify a successful file mutation for truthful completion feedback. */
function mutationKindForTool(toolId: string): MutationKind | null {
  switch (toolId) {
    case "files.create":
    case "create_file":
      return "created";
    case "files.delete":
    case "delete_file":
      return "deleted";
    case "files.rename":
    case "rename_file":
      return "renamed";
    case "edit_file":
    case "files.write":
    case "write_file":
    case "workspace.write":
      return "modified";
    default:
      return null;
  }
}

function toolSummary(toolId: string, rawSummary?: string): string {
  if (rawSummary && rawSummary !== toolId) return rawSummary;
  // Friendly defaults
  switch (toolId) {
    case "read_file":
      return "Reading file";
    case "edit_file":
      return "Editing file";
    case "list_files":
    case "inspect_project_files":
      return "Inspecting project files";
    case "search_code":
      return "Searching code";
    case "git_diff":
    case "git_status":
      return "Checking git state";
    case "run_project_checks":
      return "Running checks";
    case "create_preview":
      return "Creating preview";
    case "browser_test":
      return "Running browser test";
    case "get_active_project":
      return "Getting active project";
    case "request_deployment_approval":
      return "Requesting deployment approval";
    default:
      return toolId.replace(/_/g, " ");
  }
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  events: [],
  phase: "idle",
  isRunning: false,
  currentStep: 0,
  pendingApproval: null,
  resolvedPausedRunIds: [],
  approvalPhase: "idle",
  approvalError: null,
  approvalRetryable: true,
  approvalExpired: false,
  checkpoint: null,
  afterCheckpoint: null,
  toolCalls: [],
  changesSummary: null,
  previewPreparing: false,
  activeTaskId: null,
  taskConversationIndex: {},
  taskPhases: {},

  startRun: () => {
    seqCounter = 0;
    set({
      events: [],
      phase: "planning",
      isRunning: true,
      currentStep: 0,
      pendingApproval: null,
      approvalPhase: "idle",
      approvalError: null,
      approvalRetryable: true,
      approvalExpired: false,
      checkpoint: null,
      afterCheckpoint: null,
      toolCalls: [],
      changesSummary: null,
    });
    mirrorTaskPhase(get, set);
  },

  endRun: (reason?: string) => {
    const state = get();
    // Mark any in-flight tool_start events as completed
    const updatedEvents = state.events.map((e) =>
      e.type === "tool_start" ? { ...e, type: "tool_result" as const, success: false, summary: e.summary + " (interrupted)" } : e,
    );
    // A run paused at an approval gate is not done — the pending approval
    // must survive endRun so the Approve/Reject card stays mounted and the
    // user can resume the paused execution. Only a real terminal outcome
    // (cancelled/failed) clears it.
    const paused = state.pendingApproval != null && reason !== "cancelled" && reason !== "failed";
    set({
      isRunning: false,
      // A failed run is failed — never "done". (Reporting a failed run as
      // Complete is the same dishonesty class as a fake success.)
      phase: reason === "cancelled" ? "cancelled" : reason === "failed" ? "failed" : paused ? "awaiting_approval" : "done",
      events: updatedEvents,
      pendingApproval: paused ? state.pendingApproval : null,
      approvalPhase: paused ? state.approvalPhase : "idle",
      approvalError: paused ? state.approvalError : null,
      approvalRetryable: paused ? state.approvalRetryable : true,
      approvalExpired: paused ? state.approvalExpired : false,
    });
    mirrorTaskPhase(get, set);
  },

  addEvent: (event) => {
    const seq = seqCounter++;
    const fullEvent: ExecutionEvent = {
      ...event,
      // F1 slice C: tag with the active worktab id (explicit wins).
      taskId: event.taskId ?? get().activeTaskId ?? undefined,
      id: nextId(),
      seq,
      ts: Date.now(),
    };
    set((state) => {
      // Track tool calls
      let toolCalls = state.toolCalls;
      if (event.type === "tool_result" && event.toolId) {
        toolCalls = [
          ...state.toolCalls,
          { toolId: event.toolId, success: event.success, summary: event.summary },
        ];
      }

      // Track successful mutations by operation kind.
      let changesSummary = state.changesSummary;
      const mutationKind = event.type === "tool_result" && event.toolId && event.success
        ? mutationKindForTool(event.toolId)
        : null;
      if (mutationKind) {
        const current = changesSummary ?? { added: 0, modified: 0, deleted: 0, renamed: 0 };
        const key = mutationKind === "created"
          ? "added"
          : mutationKind;
        changesSummary = {
          ...current,
          [key]: current[key] + 1,
        };
      }

      return {
        events: [...state.events, fullEvent],
        toolCalls,
        changesSummary,
      };
    });
  },

  setPhase: (phase, taskId) => {
    set({ phase });
    mirrorTaskPhase(get, set, taskId);
  },

  setPendingApproval: (approval) => {
    const prevPending = get().pendingApproval;
    set({
      pendingApproval: approval,
      phase: approval ? "awaiting_approval" : get().phase,
      approvalPhase: "idle",
      approvalError: null,
      approvalRetryable: true,
      approvalExpired: false,
    });
    // Clear the failed-lifecycle fields when the gate is removed entirely
    // (approval: null) — previously they could survive a null gate and
    // reattach to the next gate that mounts.
    if (!approval) {
      set({ approvalPhase: "idle", approvalError: null, approvalRetryable: true, approvalExpired: false });
      return;
    }
    const gateId = approval.pausedRunId;
    // Same gate already pending — its entry is already logged. A repeated
    // pending_approval signal for one gate must not duplicate the entry.
    if (gateId && prevPending?.pausedRunId === gateId) return;
    const events = get().events;
    // The approval_required SSE signal may have logged this gate already
    // under its toolId (no gate id yet). Claim that entry in place instead
    // of appending a duplicate.
    const unclaimedIdx = findUnclaimedApprovalIndex(events, approval.toolId);
    if (unclaimedIdx >= 0) {
      set((state) => ({
        events: state.events.map((e, i) => (i === unclaimedIdx ? { ...e, gateId } : e)),
      }));
      return;
    }
    // Already logged under this gate id and still open — don't duplicate.
    if (gateId && hasOpenApprovalEntry(events, gateId)) return;
    get().addEvent({
      type: "approval_required",
      summary: `Approval needed: ${approval.toolId.replace(/_/g, " ")}`,
      toolId: approval.toolId,
      gateId,
    });
    mirrorTaskPhase(get, set);
  },

  resolveApproval: (decision) => {
    const pending = get().pendingApproval;
    if (pending) {
      get().addEvent({
        type: "approval_resolved",
        summary: decision === "approved" ? "Approved" : "Rejected",
        toolId: pending.toolId,
        success: decision === "approved",
      });
    }
    // A decided gate is dead — remember its pausedRunId so a late or
    // duplicated `pending_approval` SSE event for the same gate can never
    // re-arm it (which would strand a stuck "Approval waiting" badge with
    // no live approval card to clear it).
    const resolvedId = pending?.pausedRunId;
    const resolvedPausedRunIds = resolvedId
      ? [...get().resolvedPausedRunIds.filter((id) => id !== resolvedId), resolvedId].slice(-50)
      : get().resolvedPausedRunIds;
    set({
      pendingApproval: null,
      resolvedPausedRunIds,
      phase: "editing",
      approvalPhase: "idle",
      approvalError: null,
      approvalRetryable: true,
      approvalExpired: false,
    });
    mirrorTaskPhase(get, set);
  },

  beginApprovalSubmit: () => {
    set({ approvalPhase: "submitting", approvalError: null, approvalRetryable: true });
  },

  approvalAccepted: () => {
    // Only advance out of submitting — a stale accepted callback must not
    // overwrite a newer failed state.
    if (get().approvalPhase === "submitting") {
      set({ approvalPhase: "executing" });
    }
  },

  failApproval: (error, retryable = true, opts) => {
    const expired = opts?.expired === true;
    // A gate whose decision never landed server-side (or that expired into
    // "request again") is still actionable — keep it mounted. A gate whose
    // decision was recorded and whose run then failed is dead: clearing
    // pendingApproval drops the operator bar's Approve/Reject buttons and
    // unmounts the card, and phase "failed" replaces the "Waiting for
    // approval" label. Replaying the identical frozen run cannot succeed,
    // so no retry affordance is offered for it.
    const gateActionable = expired || opts?.decisionRecorded !== true;
    set({
      approvalPhase: "failed",
      approvalError: error,
      approvalRetryable: retryable,
      approvalExpired: expired,
      pendingApproval: gateActionable ? get().pendingApproval : null,
      phase: gateActionable ? "awaiting_approval" : "failed",
    });
    get().addEvent({
      type: "approval_resolved",
      summary: `Approval failed: ${error.slice(0, 120)}`,
      toolId: get().pendingApproval?.toolId,
      success: false,
    });
    mirrorTaskPhase(get, set);
  },

  setAfterCheckpoint: (afterCheckpoint) => {
    set({ afterCheckpoint });
    if (afterCheckpoint) {
      get().addEvent({
        type: "checkpoint",
        summary: `Saved: ${afterCheckpoint.label}`,
        label: afterCheckpoint.label,
        gitSha: afterCheckpoint.gitSha,
      });
    }
  },

  hydrateCheckpoints: ({ before, after }) => {
    const cur = get();
    if (cur.isRunning) return;
    set({
      checkpoint: cur.checkpoint ?? before,
      afterCheckpoint: cur.afterCheckpoint ?? after,
    });
  },

  setCheckpoint: (checkpoint) => {
    set({ checkpoint });
    if (checkpoint) {
      get().addEvent({
        type: "checkpoint",
        summary: `Checkpoint: ${checkpoint.label}`,
        label: checkpoint.label,
        gitSha: checkpoint.gitSha,
      });
    }
  },

  collapseEvent: (id) => {
    set((state) => ({
      events: state.events.map((e) => (e.id === id ? { ...e, collapsed: !e.collapsed } : e)),
    }));
  },

  /** Auto-collapse completed low-level operations to keep the panel clean */
  collapseLowLevel: () => {
    set((state) => ({
      events: state.events.map((e) => {
        if (e.lowLevel && (e.type === "tool_result" || e.type === "tool_error") && e.success !== undefined) {
          return { ...e, collapsed: true };
        }
        return e;
      }),
    }));
  },

  clearEvents: () => set({ events: [], toolCalls: [], changesSummary: null }),

  setPreviewPreparing: (preparing) => {
    // Only update if it actually changes to avoid needless re-renders.
    if (get().previewPreparing === preparing) return;
    set({ previewPreparing: preparing });
  },

  // ── F1 slice C: per-worktab scoping ──────────────────────────
  setActiveTaskId: (taskId) => {
    if (get().activeTaskId === taskId) return;
    set({ activeTaskId: taskId });
  },
  setTaskPhase: (taskId, phase) => {
    set((s) => ({ taskPhases: { ...s.taskPhases, [taskId]: phase } }));
  },

  eventsForTask: (taskId) => {
    const events = get().events;
    // No taskId → today's global behavior (all events).
    if (taskId === undefined) return events;
    return events.filter((e) => e.taskId === taskId);
  },

  phaseForTask: (taskId) => {
    // No taskId → today's global behavior (global phase).
    if (taskId === undefined) return get().phase;
    // Unknown worktab → "idle" (honest: no known work).
    return get().taskPhases[taskId] ?? "idle";
  },

  setTaskConversationIndex: (tasks) => {
    const next: Record<string, string> = {};
    for (const t of tasks) {
      if (t.conversationId) next[t.conversationId] = t.id;
    }
    const prev = get().taskConversationIndex;
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    const unchanged =
      prevKeys.length === nextKeys.length &&
      nextKeys.every((k) => prev[k] === next[k]);
    if (!unchanged) set({ taskConversationIndex: next });
  },

  reset: () => {
    seqCounter = 0;
    set({
      events: [],
      phase: "idle",
      isRunning: false,
      currentStep: 0,
      pendingApproval: null,
      resolvedPausedRunIds: [],
      approvalPhase: "idle",
      approvalError: null,
      approvalRetryable: true,
      approvalExpired: false,
      checkpoint: null,
      afterCheckpoint: null,
      toolCalls: [],
      changesSummary: null,
      previewPreparing: false,
      activeTaskId: null,
      taskConversationIndex: {},
      taskPhases: {},
    });
  },
}));

/**
 * Helper: feed an SSE event from the conversation stream into the execution store.
 * This is the bridge between useCanonicalConversation's SSE handler and the store.
 */
export function feedSSEEventToExecutionStore(
  evt: {
    type: string;
    toolId?: string;
    success?: boolean;
    summary?: string;
    reason?: string;
    pausedRunId?: string;
    inputs?: Record<string, unknown>;
    /** Conversation the SSE stream belongs to — gates bind to it. */
    conversationId?: string;
    label?: string;
    gitSha?: string;
    /** checkpoint events: "after" = post-run checkpoint (not the baseline). */
    kind?: "before" | "after";
    check?: string;
    passed?: boolean;
    errorCount?: number;
    diagnostics?: StructuredDiagnostic[];
    diff?: string;
    status?: "changed" | "unchanged" | "unknown";
    files?: string[];
    additions?: number;
    deletions?: number;
    checkpointSha?: string;
    unknownReason?: string;
    phase?: string;
    step?: number;
    durationMs?: number;
    totalSteps?: number;
    totalDurationMs?: number;
    model?: string;
    provider?: string;
    fallbackFrom?: string;
    category?: string;
    message?: string;
    attempt?: number;
    maxAttempts?: number;
    healthy?: boolean;
    previewUrl?: string;
    environment?: string;
    url?: string;
    /** deploy_verify detail is a string; error events carry an object detail */
    detail?: string | { message?: string; partialText?: string };
    error?: string;
    productionUrl?: string;
  },
  /**
   * Conversation whose run produced this event — stamped onto any approval
   * gate mounted from it, so the Approve/Reject POST targets the paused
   * run's own conversation instead of whichever conversation is selected
   * at click time (a mismatch deterministic-403s as "Conversation mismatch").
   */
  conversationId?: string,
  store = useExecutionStore,
) {
  const s = store.getState();

  // F1: attribute this stream's events to the worktab bound to the event's
  // conversation — NOT the currently active tab. A run started in tab A
  // keeps attributing to A after the user switches to tab B, so tab A's
  // badge can flip to ready on real completion. Explicit event.taskId
  // still wins inside addEvent.
  const streamTaskId = resolveTaskIdForConversation(conversationId, store);
  const addEvent: typeof s.addEvent = (event) =>
    s.addEvent({ taskId: streamTaskId, ...event });

  switch (evt.type) {
    case "tool_execution":
      if (evt.success === undefined) {
        // tool_start
        addEvent({
          type: "tool_start",
          summary: toolSummary(evt.toolId ?? "", evt.summary),
          toolId: evt.toolId,
          lowLevel: evt.toolId === "read_file" || evt.toolId === "list_files" || evt.toolId === "inspect_project_files",
        });
      } else {
        // tool_result
        addEvent({
          type: evt.success ? "tool_result" : "tool_error",
          summary: evt.summary ?? toolSummary(evt.toolId ?? ""),
          toolId: evt.toolId,
          success: evt.success,
          durationMs: evt.durationMs,
          lowLevel: evt.toolId === "read_file" || evt.toolId === "list_files" || evt.toolId === "inspect_project_files",
        });
      }
      break;

    case "workspace_change":
      addEvent({
        type: "status",
        summary: evt.status === "changed"
          ? `${evt.files?.length ?? 0} file${evt.files?.length === 1 ? "" : "s"} changed (+${evt.additions ?? 0}/-${evt.deletions ?? 0})`
          : evt.status === "unchanged" ? "No workspace changes detected" : "Workspace changes could not be verified",
        filePath: evt.files?.[0],
        diff: evt.diff,
      });
      break;

    case "checkpoint":
      if (evt.kind === "after") {
        // Post-run checkpoint — must NOT replace the pre-run baseline,
        // or Revert would "restore" the state it is meant to undo.
        s.setAfterCheckpoint({ label: evt.label ?? "", gitSha: evt.gitSha ?? "" });
      } else {
        s.setCheckpoint({ label: evt.label ?? "", gitSha: evt.gitSha ?? "" });
      }
      break;

    case "build_start":
      addEvent({
        type: "build_start",
        summary: `Running ${evt.check}...`,
        check: evt.check,
      });
      s.setPhase("testing", streamTaskId);
      break;

    case "build_result":
      addEvent({
        type: "build_result",
        summary: `${evt.check}: ${evt.passed ? "passed" : "failed"}`,
        check: evt.check,
        success: evt.passed,
        errorCount: evt.errorCount,
        diagnostics: evt.diagnostics,
      });
      break;

    case "approval_required":
      // A permission gate was hit — but this progress signal alone does
      // not prove a resumable pause. The agent loop also emits it for
      // permission denials and AUTO-mode skips that CONTINUE without
      // pausing; mounting an Approve/Reject card from it leaves a dead
      // card behind after the run completes, and clicking it reports a
      // false "could not be resumed". Log the event only — only
      // `pending_approval` (emitted after the paused run is persisted
      // server-side and carrying its pausedRunId) mounts the card.
      // Dedupe: the loop can re-fire this signal for the same gate, so
      // skip it while an unclaimed entry for the tool is still open.
      if (findUnclaimedApprovalIndex(s.events, evt.toolId ?? "") >= 0) break;
      addEvent({
        type: "approval_required",
        summary: `Approval needed: ${(evt.toolId ?? "").replace(/_/g, " ")}`,
        toolId: evt.toolId,
      });
      break;

    case "pending_approval":
      // A gate that already reached a terminal decision on this client is
      // dead — a late or duplicated event for the same pausedRunId must not
      // re-arm it. Re-arming would strand a stuck "Approval waiting" badge
      // with no live approval card to clear it.
      if (evt.pausedRunId && s.resolvedPausedRunIds.includes(evt.pausedRunId)) {
        break;
      }
      s.setPendingApproval({
        toolId: evt.toolId ?? "",
        reason: evt.reason ?? "Approval required",
        pausedRunId: evt.pausedRunId,
        // Bind the gate to the conversation whose run paused — the resume
        // POST must target THIS conversation even if the user switches or
        // creates a conversation before clicking (the server 403s any
        // mismatched pair with "Conversation mismatch").
        conversationId: conversationId ?? evt.conversationId,
        inputs: evt.inputs,
      });
      break;

    case "phase":
      if (evt.phase && evt.step !== undefined) {
        const mapped = mapPhase(evt.phase, evt.step);
        // Attribute to the run's OWNING worktab (streamTaskId), not the
        // active tab — a background tab's badge must track its own run.
        s.setPhase(mapped, streamTaskId);
        useExecutionStore.setState({ currentStep: evt.step });
      }
      break;

    case "finished":
      addEvent({
        type: evt.success === false ? "tool_error" : "finished",
        summary: evt.success === false
          ? "Verification incomplete — completion was not declared"
          : `Completed in ${evt.totalSteps ?? evt.step ?? 0} steps`,
        success: evt.success !== false,
        step: evt.totalSteps ?? evt.step,
      });
      // A finished streamed run has no live approval gate — a run that
      // pauses at a gate returns early without emitting "finished", so any
      // pendingApproval still set here is stale and would strand the
      // "Approval waiting" badge. Clear it without fabricating a decision.
      s.setPendingApproval(null);
      s.setPhase(evt.success === false ? "failed" : "done", streamTaskId);
      s.collapseLowLevel();
      break;

    case "cancelled":
      addEvent({
        type: "cancelled",
        summary: evt.reason ?? "Cancelled",
      });
      s.setPhase("cancelled", streamTaskId);
      break;

    case "model_routing":
      addEvent({
        type: "model_routing",
        summary: evt.fallbackFrom
          ? `Switched to ${evt.model} (fallback from ${evt.fallbackFrom})`
          : `Using ${evt.model}`,
        model: evt.model,
        provider: evt.provider,
        fallbackFrom: evt.fallbackFrom,
        category: evt.category,
        durationMs: evt.durationMs,
      });
      break;

    case "model_failed":
      addEvent({
        type: "model_failed",
        summary: `Model ${evt.model} failed: ${evt.category}`,
        model: evt.model,
        category: evt.category,
        message: evt.message,
      });
      break;

    case "reasoning":
      addEvent({
        type: "reasoning",
        summary: evt.summary ?? "",
      });
      break;

    case "status":
      addEvent({
        type: "status",
        summary: evt.summary ?? "",
      });
      break;

    case "repair_attempt":
      addEvent({
        type: "repair_attempt",
        summary: `Repair attempt ${evt.attempt}/${evt.maxAttempts}`,
      });
      break;

    case "preview_start":
      addEvent({
        type: "preview",
        summary: "Starting live preview...",
      });
      break;

    case "preview_result":
      addEvent({
        type: "preview",
        summary: evt.success
          ? "Live preview ready"
          : `Preview failed: ${evt.error ?? "unknown error"}`,
        success: evt.success,
      });
      break;

    case "deploy_start":
      addEvent({
        type: "deploy",
        summary: `Deploying to ${evt.environment ?? "production"}...`,
      });
      break;

    case "deploy_result":
      addEvent({
        type: "deploy",
        summary: evt.success
          ? `Deployment succeeded${evt.productionUrl ? `: ${evt.productionUrl}` : ""}`
          : `Deployment failed: ${evt.error ?? "unknown error"}`,
        success: evt.success,
      });
      break;

    case "deploy_verify":
      addEvent({
        type: "deploy",
        summary: evt.success
          ? `Production URL verified: ${evt.url ?? "unknown"}`
          : `Production URL verification failed: ${typeof evt.detail === "string" ? evt.detail : evt.url ?? "unknown"}`,
        success: evt.success,
      });
      break;
  }
}

/* ── F1 slice C: worktab badge derivation ──────────────────────────
 * Pure function — Agent A renders the badges; this module owns the
 * derivation so every surface agrees on what a badge means.
 *
 * Inputs are exactly the two sanctioned sources:
 *   1. the execution store's per-task phase (phaseForTask), and
 *   2. the action-run projection's displayState (ActionRunStatusPanel's
 *      union — imported, not redeclared).
 *
 * Honesty rules:
 * - "needs-approval" wins over everything: a live approval gate means
 *   the user must act; the worktab is never "ready" or "working" then.
 * - "ready" ONLY on completed-with-evidence: execution phase "done"
 *   AND the action-run projection confirms "completed". Phase "done"
 *   alone is not evidence — a client-side endRun() with no reason also
 *   lands on "done" without any finished event.
 * - Anything else (failed, cancelled, stopped, unknown task) is "idle" —
 *   never an optimistic state.
 */

export type WorktabBadge = "working" | "ready" | "needs-approval" | "idle";

export interface WorktabBadgeSnapshot {
  /** Per-task execution phase — useExecutionStore.getState().phaseForTask(taskId). */
  executionPhase: ExecutionPhase;
  /**
   * Action-run projection displayState for the task's conversation, when
   * known. Absent/null means the projection is unavailable — the badge
   * then derives from the execution phase alone, conservatively.
   */
  actionRunDisplayState?: ActionRunDisplayState | null;
}

/** Execution phases that mean live work is in flight for the task. */
const WORKING_PHASES: ReadonlySet<ExecutionPhase> = new Set([
  "planning",
  "inspecting",
  "editing",
  "testing",
  "verifying",
  "awaiting_input",
]);

/** Action-run display states that mean live work is in flight. */
const WORKING_DISPLAY_STATES: ReadonlySet<ActionRunDisplayState> = new Set([
  "queued",
  "starting",
  "running",
  "waiting_for_user",
  "paused",
  "stopping",
]);

export function deriveWorktabBadge(
  taskId: string,
  snapshots: Record<string, WorktabBadgeSnapshot | undefined>,
): WorktabBadge {
  const snapshot = snapshots[taskId];
  if (!snapshot) return "idle";
  const { executionPhase, actionRunDisplayState } = snapshot;

  // An approval gate up in either source means the user must act.
  if (
    executionPhase === "awaiting_approval" ||
    actionRunDisplayState === "awaiting_approval"
  ) {
    return "needs-approval";
  }

  // Live work in either source.
  if (WORKING_PHASES.has(executionPhase)) return "working";
  if (actionRunDisplayState && WORKING_DISPLAY_STATES.has(actionRunDisplayState)) {
    return "working";
  }

  // Ready only on completed-with-evidence.
  if (executionPhase === "done" && actionRunDisplayState === "completed") {
    return "ready";
  }

  return "idle";
}
