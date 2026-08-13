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
  | "awaiting_approval";

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
    | "repair_attempt";
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
  inputs?: Record<string, unknown>;
}

interface ExecutionStore {
  // ── State ──
  events: ExecutionEvent[];
  phase: ExecutionPhase;
  isRunning: boolean;
  currentStep: number;
  pendingApproval: PendingApproval | null;
  checkpoint: { label: string; gitSha: string } | null;
  /** Tool calls in the current run */
  toolCalls: Array<{ toolId: string; success?: boolean; summary: string }>;
  /** Changes summary */
  changesSummary: { added: number; modified: number; deleted: number } | null;

  // ── Actions ──
  startRun: () => void;
  endRun: (reason?: string) => void;
  addEvent: (event: Omit<ExecutionEvent, "id" | "seq" | "ts">) => void;
  setPhase: (phase: ExecutionPhase) => void;
  setPendingApproval: (approval: PendingApproval | null) => void;
  resolveApproval: (decision: "approved" | "rejected") => void;
  setCheckpoint: (checkpoint: { label: string; gitSha: string } | null) => void;
  collapseEvent: (id: string) => void;
  collapseLowLevel: () => void;
  clearEvents: () => void;
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
    case "finished":
      return "done";
    case "cancelled":
      return "cancelled";
    default:
      return "editing";
  }
}

/** Generate a human-readable summary for a tool */
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
  checkpoint: null,
  toolCalls: [],
  changesSummary: null,

  startRun: () => {
    seqCounter = 0;
    set({
      events: [],
      phase: "planning",
      isRunning: true,
      currentStep: 0,
      pendingApproval: null,
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
    set({
      isRunning: false,
      phase: reason === "cancelled" ? "cancelled" : "done",
      events: updatedEvents,
      pendingApproval: null,
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

      // Track changes for edit_file
      let changesSummary = state.changesSummary;
      if (event.type === "tool_result" && event.toolId === "edit_file" && event.success) {
        changesSummary = {
          added: (changesSummary?.added ?? 0),
          modified: (changesSummary?.modified ?? 0) + 1,
          deleted: (changesSummary?.deleted ?? 0),
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
    set({ pendingApproval: approval, phase: approval ? "awaiting_approval" : get().phase });
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
    set({ pendingApproval: null, phase: "editing" });
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

  reset: () => {
    seqCounter = 0;
    set({
      events: [],
      phase: "idle",
      isRunning: false,
      currentStep: 0,
      pendingApproval: null,
      checkpoint: null,
      toolCalls: [],
      changesSummary: null,
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
  },
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
      s.setPendingApproval({
        toolId: evt.toolId ?? "",
        reason: evt.reason ?? "Approval required",
      });
      break;

    case "pending_approval":
      s.setPendingApproval({
        toolId: evt.toolId ?? "",
        reason: evt.reason ?? "Approval required",
        pausedRunId: evt.pausedRunId,
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
  }
}
