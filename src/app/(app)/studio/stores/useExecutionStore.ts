"use client";

import { create } from "zustand";

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
  | "inspecting"
  | "editing"
  | "testing"
  | "verifying"
  | "done"
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
  /** Phase */
  phase?: ExecutionPhase;
  /** Step number within the agent loop */
  step?: number;
  /** Timestamp */
  ts: number;
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
  checkpoint: { label: string; gitSha: string } | null;
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

  // ── Actions ──
  startRun: () => void;
  endRun: (reason?: string) => void;
  addEvent: (event: Omit<ExecutionEvent, "id" | "seq" | "ts">) => void;
  setPhase: (phase: ExecutionPhase) => void;
  setPendingApproval: (approval: PendingApproval | null) => void;
  resolveApproval: (decision: "approved" | "rejected") => void;
  /** Approval POST submitted — card stays mounted, shows submitting state. */
  beginApprovalSubmit: () => void;
  /** Approval POST accepted (202) — card shows the run executing. */
  approvalAccepted: () => void;
  /**
   * Approval POST failed (non-2xx) or the resumed run failed — keep the
   * card mounted with the backend error and a Retry affordance. Never
   * silently clears, never auto re-requests.
   */
  failApproval: (error: string, retryable?: boolean, opts?: { expired?: boolean }) => void;
  setCheckpoint: (checkpoint: { label: string; gitSha: string } | null) => void;
  collapseEvent: (id: string) => void;
  collapseLowLevel: () => void;
  clearEvents: () => void;
  setPreviewPreparing: (preparing: boolean) => void;
  reset: () => void;
}

let seqCounter = 0;
let idCounter = 0;

function nextId(): string {
  return `exec_${Date.now()}_${idCounter++}`;
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
    default:
      return "editing";
  }
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
  toolCalls: [],
  changesSummary: null,
  previewPreparing: false,

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
      toolCalls: [],
      changesSummary: null,
    });
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
      phase: reason === "cancelled" ? "cancelled" : paused ? "awaiting_approval" : "done",
      events: updatedEvents,
      pendingApproval: paused ? state.pendingApproval : null,
      approvalPhase: paused ? state.approvalPhase : "idle",
      approvalError: paused ? state.approvalError : null,
      approvalRetryable: paused ? state.approvalRetryable : true,
      approvalExpired: paused ? state.approvalExpired : false,
    });
  },

  addEvent: (event) => {
    const seq = seqCounter++;
    const fullEvent: ExecutionEvent = {
      ...event,
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

  setPhase: (phase) => set({ phase }),

  setPendingApproval: (approval) => {
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
    }
    if (approval) {
      get().addEvent({
        type: "approval_required",
        summary: `Approval needed: ${approval.toolId.replace(/_/g, " ")}`,
        toolId: approval.toolId,
      });
    }
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
    set({
      approvalPhase: "failed",
      approvalError: error,
      approvalRetryable: retryable,
      approvalExpired: opts?.expired === true,
      phase: "awaiting_approval",
    });
    get().addEvent({
      type: "approval_resolved",
      summary: `Approval failed: ${error.slice(0, 120)}`,
      toolId: get().pendingApproval?.toolId,
      success: false,
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
      toolCalls: [],
      changesSummary: null,
      previewPreparing: false,
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
    check?: string;
    passed?: boolean;
    errorCount?: number;
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

  switch (evt.type) {
    case "tool_execution":
      if (evt.success === undefined) {
        // tool_start
        s.addEvent({
          type: "tool_start",
          summary: toolSummary(evt.toolId ?? "", evt.summary),
          toolId: evt.toolId,
          lowLevel: evt.toolId === "read_file" || evt.toolId === "list_files" || evt.toolId === "inspect_project_files",
        });
      } else {
        // tool_result
        s.addEvent({
          type: evt.success ? "tool_result" : "tool_error",
          summary: evt.summary ?? toolSummary(evt.toolId ?? ""),
          toolId: evt.toolId,
          success: evt.success,
          durationMs: evt.durationMs,
          lowLevel: evt.toolId === "read_file" || evt.toolId === "list_files" || evt.toolId === "inspect_project_files",
        });
      }
      break;

    case "checkpoint":
      s.setCheckpoint({ label: evt.label ?? "", gitSha: evt.gitSha ?? "" });
      break;

    case "build_start":
      s.addEvent({
        type: "build_start",
        summary: `Running ${evt.check}...`,
        check: evt.check,
      });
      s.setPhase("testing");
      break;

    case "build_result":
      s.addEvent({
        type: "build_result",
        summary: `${evt.check}: ${evt.passed ? "passed" : "failed"}`,
        check: evt.check,
        success: evt.passed,
        errorCount: evt.errorCount,
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
      s.addEvent({
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
        s.setPhase(mapPhase(evt.phase, evt.step));
        useExecutionStore.setState({ currentStep: evt.step });
      }
      break;

    case "finished":
      s.addEvent({
        type: "finished",
        summary: `Completed in ${evt.totalSteps ?? evt.step ?? 0} steps`,
        step: evt.totalSteps ?? evt.step,
      });
      // A finished streamed run has no live approval gate — a run that
      // pauses at a gate returns early without emitting "finished", so any
      // pendingApproval still set here is stale and would strand the
      // "Approval waiting" badge. Clear it without fabricating a decision.
      s.setPendingApproval(null);
      s.setPhase("done");
      s.collapseLowLevel();
      break;

    case "cancelled":
      s.addEvent({
        type: "cancelled",
        summary: evt.reason ?? "Cancelled",
      });
      s.setPhase("cancelled");
      break;

    case "model_routing":
      s.addEvent({
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
      s.addEvent({
        type: "model_failed",
        summary: `Model ${evt.model} failed: ${evt.category}`,
        model: evt.model,
        category: evt.category,
        message: evt.message,
      });
      break;

    case "reasoning":
      s.addEvent({
        type: "reasoning",
        summary: evt.summary ?? "",
      });
      break;

    case "status":
      s.addEvent({
        type: "status",
        summary: evt.summary ?? "",
      });
      break;

    case "repair_attempt":
      s.addEvent({
        type: "repair_attempt",
        summary: `Repair attempt ${evt.attempt}/${evt.maxAttempts}`,
      });
      break;

    case "preview_start":
      s.addEvent({
        type: "preview",
        summary: "Starting live preview...",
      });
      break;

    case "preview_result":
      s.addEvent({
        type: "preview",
        summary: evt.success
          ? "Live preview ready"
          : `Preview failed: ${evt.error ?? "unknown error"}`,
        success: evt.success,
      });
      break;

    case "deploy_start":
      s.addEvent({
        type: "deploy",
        summary: `Deploying to ${evt.environment ?? "production"}...`,
      });
      break;

    case "deploy_result":
      s.addEvent({
        type: "deploy",
        summary: evt.success
          ? `Deployment succeeded${evt.productionUrl ? `: ${evt.productionUrl}` : ""}`
          : `Deployment failed: ${evt.error ?? "unknown error"}`,
        success: evt.success,
      });
      break;

    case "deploy_verify":
      s.addEvent({
        type: "deploy",
        summary: evt.success
          ? `Production URL verified: ${evt.url ?? "unknown"}`
          : `Production URL verification failed: ${typeof evt.detail === "string" ? evt.detail : evt.url ?? "unknown"}`,
        success: evt.success,
      });
      break;
  }
}
