/**
 * CockpitStore — UI state only.
 *
 * This store holds ONLY presentation state: active run, selected panel,
 * command history, connection state, and the current approval prompt.
 *
 * It NEVER duplicates canonical runtime state. Runtime truth (phase,
 * runId, toolCallId, results) comes from RuntimeClient events and is
 * rendered directly. This store only tracks what the UI needs to know
 * about itself (which panel is selected, what the user typed, etc).
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { ChatTranscriptStore } from "./chat-transcript-store.js";
import { ToolProgressStore, type ToolProgressSnapshot } from "./tool-progress-store.js";
import { FocusEpochTracker } from "./focus-state.js";
import { resolveExecutionTarget } from "../lib/execution-target.js";

export type CockpitPanel = "runtime" | "terminal" | "memory" | "agent" | "model" | "gateway" | "credentials";

/**
 * Full agent lifecycle states.
 * These map to the real runtime phases, not generic IDLE/READY.
 */
export type HoloState =
  | "IDLE"
  | "UNDERSTANDING"
  | "PLANNING"
  | "READING"
  | "EDITING"
  | "RUNNING"
  | "TESTING"
  | "VERIFYING"
  | "APPROVAL"
  | "COMPLETE"
  | "FAILED"
  | "CANCELLED"
  | "TIMEOUT";

// Backward-compat aliases (old code may reference these)
export type { HoloState as HoloStateLegacy };

export interface ApprovalPrompt {
  runId: string;
  toolCallId: string;
  toolId: string;
  action: string;
  risk: string;
  scope: string;
}

/**
 * Chat transcript message — the canonical assistant/user conversation.
 *
 * This is the PERSISTED response body. The activity feed is a truncated
 * operator log; the transcript is the full, rendered assistant content.
 *
 * Lifecycle:
 *   - On submit: a "user" message is appended.
 *   - During streaming: an "assistant" message with status "streaming"
 *     is appended and its body grows as deltas arrive (live preview).
 *   - On completion: the streaming message is finalized to status
 *     "complete" with result.content (the canonical final response,
 *     persisted ONCE — never duplicated).
 *   - On error: the streaming message is finalized to status "error"
 *     with the error text (never blank).
 *
 * Routing trace (assistant messages only):
 *   - requestedModel: the brain/policy label (what the user configured)
 *   - resolvedModel:  the routed model label (what route() picked)
 *   - servedModel:    the model the provider actually served (after
 *     streaming confirms it; null until then)
 *   - fallbackReason: why the resolved model differs from the requested
 *     policy, if applicable (null when the policy was honored exactly)
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  status: "streaming" | "complete" | "error";
  /** Routing trace — assistant messages only. */
  requestedModel?: string;
  resolvedModel?: string;
  servedModel?: string | null;
  fallbackReason?: string | null;
  /** Turn duration (ms) — stamped once at finalize; drives the
   *  collapsed "Model · 9.0s" routing footer. */
  durationMs?: number | null;
}

/**
 * Activity vocabulary — the tiny semantic set the shell renders.
 * The whole runtime surface maps onto these five glyphs:
 *   → working   ✓ success   ! warning   × failed   ◆ decision
 */
export type ActivitySemantic = "working" | "success" | "warning" | "failed" | "decision";

/**
 * Activity entry — operator feed format.
 * tag is the short verb (THINK, ROUTE, READ, EDIT, RUN, PASS, VERIFY, etc.)
 * semantic is the tiny-vocabulary classification used by the shell feed.
 */
export interface ActivityEntry {
  id: string;
  ts: number;
  type: string;
  tag?: string;
  semantic?: ActivitySemantic;
  runId?: string;
  toolCallId?: string;
  /** Display text — truncated for the feed. */
  text: string;
  /** Full untruncated text — preserved for /activity, /run <id>, debugging. */
  fullText?: string;
  stream?: "stdout" | "stderr";
}

/**
 * Mission tracking — the real runtime lifecycle of a task.
 */
export interface MissionState {
  /** The mission text (what the user asked) */
  text: string;
  /** Short run ID */
  runId: string | null;
  /** Current lifecycle state */
  state: HoloState;
  /** Mission start timestamp */
  startedAt: number | null;
  /** Mission end timestamp */
  endedAt: number | null;
  /** Files touched during this mission */
  filesTouched: string[];
  /** Commands executed during this mission */
  commandsExecuted: string[];
  /** Test results (if any) */
  testResults: { passed: number; failed: number; total: number } | null;
  /** Typecheck status */
  typecheckPassed: boolean | null;
  /** Build status */
  buildPassed: boolean | null;
  /** Runtime verification proven */
  runtimeProven: boolean | null;
  /** Git porcelain file paths captured at mission start — the baseline
   *  pre-existing repo state. NEVER attributed to this mission. */
  baselineGitFiles: string[];
  /** Files changed BY this mission (baseline vs terminal git snapshot).
   *  null until the mission reaches a terminal state. */
  missionDeltaFiles: string[] | null;
  /** True when the mission only read (no mutation tools succeeded).
   *  Read-only missions NEVER claim "verification passed" for code
   *  changes — they were not executing a verification gate. */
  readOnly: boolean | null;
  /** Every tool id invoked during the mission (for honest summaries). */
  toolsUsed: string[];
}

/**
 * Canonical mission projection — a lightweight projection of
 * RuntimeStore.mission that the UI renders directly. This is NOT
 * a competing authority — it's a render cache of canonical truth.
 *
 * RuntimeStore.mission remains the single source of truth.
 * The useRuntimeMissionProjection hook updates this from canonical
 * mission:* events.
 */
export interface CanonicalMissionProjection {
  /** Mission ID from RuntimeStore.mission.id */
  id: string;
  /** Mission goal from RuntimeStore.mission.goal */
  goal: string;
  /** Mission status from RuntimeStore.mission.status */
  status: string;
  /** Current step ID from RuntimeStore.mission.currentStepId */
  currentStepId: string | null;
  /** Steps projected from RuntimeStore.mission.steps */
  steps: Array<{
    id: string;
    title: string;
    status: string;
    sequence: number;
  }>;
  /** Verification proven — from mission evidence */
  verificationProven: boolean | null;
  /** Mission was restored from disk on startup */
  restored: boolean;
  /** Completion reason (if complete) */
  completionReason: string | null;
  /** Failure reason (if failed) */
  failureReason: string | null;
}

/**
 * Intent classification — how LiTT treats user input.
 *   chat     — casual conversation, questions, greetings
 *   command  — slash commands
 *   mission  — tasks that require tools/execution
 */
export type Intent = "chat" | "command" | "mission";

/**
 * Runtime connectivity — each layer is independent truth.
 * Local runtime being ready does NOT imply remote is connected.
 */
export type LocalRuntimeState = "starting" | "ready" | "error";
export type RemoteRuntimeState = "offline" | "connecting" | "connected" | "reconnecting" | "error";
/** Where the MODEL provider executes — see lib/execution-target.ts.
 *  Independent of localRuntime (local TOOL execution, always ready) and
 *  remoteRuntime (Socket.IO transport connectivity). */
export type ExecutionTarget = "local" | "remote";

export interface CockpitUIState {
  selectedPanel: CockpitPanel;
  holoState: HoloState;
  commandHistory: string[];
  historyIndex: number;
  approvalPrompt: ApprovalPrompt | null;
  activityLog: ActivityEntry[];
  /** @deprecated Use localRuntime + remoteRuntime for granular truth */
  connected: boolean;
  /** Local RuntimeSession readiness — always available (TOOL execution) */
  localRuntime: LocalRuntimeState;
  /** Remote terminal-server connection state — independent of local */
  remoteRuntime: RemoteRuntimeState;
  /** Where the MODEL provider executes for this session — set once at
   *  startup (see resolveExecutionTarget). NOT the same thing as
   *  remoteRuntime (transport) or localRuntime (tool execution). */
  executionTarget: ExecutionTarget;
  currentRunId: string | null;
  /** Mission tracking — null when no mission is active */
  missionState: MissionState | null;
  /** Last completed mission (retained for display) */
  lastCompletedMission: MissionState | null;
  /** Canonical mission projection from RuntimeStore.mission.
   *  This is a render cache — RuntimeStore.mission is the authority. */
  canonicalMission: CanonicalMissionProjection | null;
  /** CHAT processing flag — independent of mission holoState.
   *  CHAT does NOT use UNDERSTANDING/PLANNING/etc. It sets isProcessing
   *  to block the composer while keeping holoState = IDLE. */
  isProcessing: boolean;
  /** Live git branch — refreshed before each submit to match tool truth. */
  branch: string;
  /** Chat transcript — persisted assistant/user conversation body.
   *  Survives rerender and overlay open/close. Bounded to last 50 messages. */
  chatTranscript: ChatMessage[];
  /** Tool progress — structured per-tool execution state for the current
   *  mission. Fills the main content area during tool execution so the
   *  shell shows live progress instead of an empty streaming placeholder.
   *  Mirrored from the pure ToolProgressStore (testable without React). */
  toolProgress: ToolProgressSnapshot;
  /** Execution mode — PLAN (read-only) or ACT (full). Tab toggles. */
  mode: "plan" | "act";
  /** Workspace context — display truth for the shell. Updated by
   *  /workspace switches and branch refreshes. */
  project: string;
  cwd: string;
  gitModified: number;
  gitUntracked: number;
  /** Composer draft — lifted into the store so / and @ overlays can
   *  read/append to the in-progress input. */
  composerValue: string;
  /** Query seeded into the next opened overlay (palette/picker). */
  overlayQuery: string;
  /** When the shell entered a busy state (chat/mission) — for the
   *  status bar's "◉ Working · Ns" timer. Null when idle. */
  busySince: number | null;
  /** Transcript scroll anchor — index of the top visible message.
   *  null = LIVE (auto-follow the newest). The logical transcript is
   *  NEVER mutated by the viewport; this is pure scroll position. */
  transcriptAnchor: number | null;
  /** Page size (messages per PgUp/PgDn) — set by the shell from the
   *  live-mode visible count. */
  transcriptPage: number;
  /** Focus epoch — bumped EXACTLY ONCE per composer-restoration
   *  transition (overlay close, run settle, explicit return-to-live).
   *  The composer restarts its steady caret on change. Never bumped by
   *  renders, stream chunks, or timer ticks (focus-state.ts). */
  focusEpoch: number;
}

/** Overlay type — which modal/picker is open */
export type Overlay =
  | "none"
  | "model-picker"
  | "command-palette"
  | "model-center"
  | "activity"
  | "help"
  | "context-picker"
  | "file-picker"
  | "diff-viewer"
  | "workspace-picker"
  | "resume-picker"
  | "ship";

/**
 * Routing mode — how LiTT chooses models.
 *   auto   — LiTT chooses the best model per task
 *   fixed  — always use the selected model
 *   budget — prefer cheapest capable model
 *   max    — prefer strongest available model
 */
export type RoutingMode = "auto" | "fixed" | "budget" | "max";

/**
 * Pure decision function for the race-safe terminal → IDLE transition.
 *
 * A stale idle timer (scheduled by a previous run's terminal state)
 * must NOT override a new run that started during the delay window.
 * The timer's functional updater calls this with the CURRENT holoState:
 *   - terminal state (COMPLETE/FAILED/CANCELLED/TIMEOUT) → IDLE
 *   - anything else (a new run's UNDERSTANDING/RUNNING/etc.) → unchanged
 *
 * Exported so the regression test can pin the contract without a React
 * testing environment (the repo's established pure-logic test pattern).
 */
export function idleTransitionFromTerminal(prev: HoloState): HoloState {
  if (
    prev === "COMPLETE" || prev === "FAILED" ||
    prev === "CANCELLED" || prev === "TIMEOUT"
  ) {
    return "IDLE";
  }
  return prev;
}

export function useCockpitStore() {
  const [selectedPanel, setSelectedPanel] = useState<CockpitPanel>("runtime");
  const [holoState, setHoloState] = useState<HoloState>("IDLE");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [approvalPrompt, setApprovalPrompt] = useState<ApprovalPrompt | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [localRuntime, setLocalRuntime] = useState<LocalRuntimeState>("starting");
  const [remoteRuntime, setRemoteRuntime] = useState<RemoteRuntimeState>("offline");
  // Set ONCE for the life of the session — not toggled at runtime (a
  // developer flips LITT_LOCAL_MODE and restarts the CLI, they don't
  // switch mid-session). No setter is exposed in actions.
  const [executionTarget] = useState<ExecutionTarget>(() => resolveExecutionTarget());
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [routingMode, setRoutingMode] = useState<RoutingMode>("auto");
  const [activeModel, setActiveModel] = useState<string | null>(null);
  // The provider that ACTUALLY served the most recent request (source
  // truth). Set optimistically from routed.servedBy before streaming,
  // then confirmed from the adapter's providerId after streaming. null
  // until the first run. Displayed in the status bar as
  // "GPT-5.6 Luna · OpenAI" — the real served provider, not just the
  // friendly model name.
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [overlay, setOverlayState] = useState<Overlay>("none");
  const [mission, setMission] = useState<string | null>(null);
  const [missionState, setMissionState] = useState<MissionState | null>(null);
  const [lastCompletedMission, setLastCompletedMission] = useState<MissionState | null>(null);
  const [canonicalMission, setCanonicalMission] = useState<CanonicalMissionProjection | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [branch, setBranch] = useState<string>("unknown");
  const [mode, setMode] = useState<"plan" | "act">("act");
  const [project, setProject] = useState<string>("");
  const [cwd, setCwd] = useState<string>("");
  const [gitModified, setGitModified] = useState<number>(0);
  const [gitUntracked, setGitUntracked] = useState<number>(0);
  const [composerValue, setComposerValue] = useState("");
  const [overlayQuery, setOverlayQuery] = useState("");
  const [busySince, setBusySince] = useState<number | null>(null);
  const [transcriptAnchor, setTranscriptAnchor] = useState<number | null>(null);
  // ─── Focus epoch — the single event-based focus authority ────────
  // The tracker decides exactly-once restoration transitions; the React
  // state is only a mirror so renders stay reactive. Epoch 1 = focused
  // at launch (the allowed initial focus moment).
  const [focusTracker] = useState<FocusEpochTracker>(() => new FocusEpochTracker({ overlay: "none" }));
  const focusTrackerRef = useRef<FocusEpochTracker>(focusTracker);
  const [focusEpoch, setFocusEpoch] = useState<number>(() => focusTracker.epoch);
  const [transcriptPage, setTranscriptPage] = useState(5);
  // The transcript is owned by a pure ChatTranscriptStore (testable in
  // node env without a React renderer). The hook mirrors its snapshot
  // into React state so renders stay reactive. useState with a lazy
  // initializer creates the store once and never re-creates it.
  const [transcriptStore] = useState(() => new ChatTranscriptStore());
  const [chatTranscript, setChatTranscript] = useState<ChatMessage[]>(() => transcriptStore.snapshot());
  // Tool progress is owned by a pure ToolProgressStore (testable in node
  // env without a React renderer). The hook mirrors its snapshot into
  // React state so renders stay reactive. Same pattern as ChatTranscriptStore.
  const [toolProgressStore] = useState(() => new ToolProgressStore());
  const [toolProgress, setToolProgress] = useState<ToolProgressSnapshot>(() => toolProgressStore.snapshot());

  // ─── P1: coalesced transcript UI flush (~30fps) ──────────────────
  // The canonical ChatTranscriptStore receives EVERY streamed delta
  // (so finalize/last see the full content), but the React state mirror
  // is flushed at most every FLUSH_INTERVAL_MS. Without this, every
  // model token triggered setChatTranscript → a full CockpitApp rerender
  // (useCockpitStore lives at the composition root), causing sluggish
  // streaming, caret jank, and high CPU. Tunable via LITT_FLUSH_MS.
  const FLUSH_INTERVAL_MS = (() => {
    const env = process.env.LITT_FLUSH_MS;
    if (env) {
      const n = Number.parseInt(env, 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return 33; // ~30fps — the sweet spot (not 200-500ms, which feels dead)
  })();
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Immediate flush — cancels any pending coalesced flush first. */
  const syncTranscript = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setChatTranscript(transcriptStore.snapshot());
  }, [transcriptStore]);

  /** Coalesced flush — schedules at most one setChatTranscript per
   *  FLUSH_INTERVAL_MS. Used by the streaming hot path. */
  const flushTranscriptSoon = useCallback(() => {
    if (flushTimerRef.current !== null) return; // already scheduled
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      setChatTranscript(transcriptStore.snapshot());
    }, FLUSH_INTERVAL_MS);
  }, [transcriptStore, FLUSH_INTERVAL_MS]);

  // Flush any pending coalesced update on unmount so the last batch of a
  // stream is never lost when the component tears down mid-stream.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  const addActivity = useCallback((entry: ActivityEntry) => {
    // Bound the store: keep last 200 entries, and cap fullText at 4KB
    // to prevent giant stdout streams from growing memory forever.
    const MAX_FULLTEXT = 4096;
    const bounded: ActivityEntry = entry.fullText && entry.fullText.length > MAX_FULLTEXT
      ? { ...entry, fullText: entry.fullText.slice(0, MAX_FULLTEXT) + "\n…[truncated]" }
      : entry;
    setActivityLog((prev) => [...prev.slice(-200), bounded]);
  }, []);

  // ─── Chat transcript actions ─────────────────────────────────────
  // The transcript is the PERSISTED assistant response body. All
  // mutations go through the pure ChatTranscriptStore (testable without
  // a React renderer) and the result is mirrored into React state.
  // add/finalize/clear use the IMMEDIATE syncTranscript (rare, need to
  // show right away). appendAssistantDelta uses the COALESCED flush so
  // streaming doesn't rerender the whole shell on every token.
  /** Append a new user or assistant message. Returns the message id. */
  const addChatMessage = useCallback((msg: Omit<ChatMessage, "id">): string => {
    const id = transcriptStore.add(msg);
    syncTranscript();
    return id;
  }, [transcriptStore, syncTranscript]);

  /**
   * Append a delta to the assistant message identified by `id` (streaming
   * live preview). `id` MUST be the value addChatMessage() returned when
   * this caller opened ITS OWN streaming assistant message — passing a
   * stale id (from a superseded/cancelled turn) is a no-op, which is
   * what stops a late-arriving background stream from corrupting a
   * newer message (see ChatTranscriptStore invariant 7).
   *
   * P1: Uses the coalesced flush — the canonical store gets every delta,
   * but the React snapshot is refreshed at most every FLUSH_INTERVAL_MS
   * (~30fps). This is the streaming hot path; the immediate syncTranscript
   * would rerender the entire CockpitApp on every token.
   */
  const appendAssistantDelta = useCallback((text: string) => {
    transcriptStore.appendDelta(text);
    flushTranscriptSoon();
  }, [transcriptStore, flushTranscriptSoon]);

  /**
   * Finalize the assistant message identified by `id` with canonical
   * content + status. `id` MUST be the value addChatMessage() returned
   * when this caller opened ITS OWN streaming assistant message — a
   * stale id is a no-op (see ChatTranscriptStore invariant 7). Called
   * ONCE when the agent loop completes (success) or errors. Replaces the
   * streaming body with the authoritative result.content so the
   * persisted message is exactly what the runtime produced — never a
   * partial stream, never duplicated. Also stamps the served model.
   */
  const finalizeAssistantMessage = useCallback((id: string, options: {
    content: string;
    status: "complete" | "error";
    servedModel?: string | null;
    durationMs?: number | null;
  }) => {
    transcriptStore.finalize(options);
    syncTranscript();
  }, [transcriptStore, syncTranscript]);

  /**
   * The canonical transcript, read straight from the pure store.
   *
   * Prefer this over `state.chatTranscript` whenever a caller needs the
   * transcript AS OF NOW inside an async handler. `state.chatTranscript`
   * is a render-time snapshot: a handler created by useCallback closes
   * over the transcript from its defining render, so a message appended
   * during the same turn is invisible there. It also lags by up to one
   * coalesced flush (~30fps) while streaming. The pure store has neither
   * property — it is updated synchronously on every mutation.
   */
  const getChatTranscript = useCallback((): ChatMessage[] => {
    return transcriptStore.snapshot();
  }, [transcriptStore]);

  /** Clear the chat transcript (e.g. /clear). */
  const clearChatTranscript = useCallback(() => {
    transcriptStore.clear();
    syncTranscript();
  }, [transcriptStore, syncTranscript]);

  // ─── Tool progress actions ───────────────────────────────────────
  // All mutations go through the pure ToolProgressStore and the result
  // is mirrored into React state. These use the IMMEDIATE sync (not the
  // coalesced flush) because tool lifecycle events are infrequent
  // relative to model token streaming — one start/complete per tool.
  const syncToolProgress = useCallback(() => {
    setToolProgress(toolProgressStore.snapshot());
  }, [toolProgressStore]);

  const startToolProgressMission = useCallback(() => {
    toolProgressStore.startMission();
    syncToolProgress();
  }, [toolProgressStore, syncToolProgress]);

  const completeToolProgressMission = useCallback(() => {
    toolProgressStore.completeMission();
    syncToolProgress();
  }, [toolProgressStore, syncToolProgress]);

  const failToolProgressMission = useCallback(() => {
    toolProgressStore.failMission();
    syncToolProgress();
  }, [toolProgressStore, syncToolProgress]);

  const startToolProgress = useCallback((toolCallId: string, toolId: string, toolName: string) => {
    toolProgressStore.startTool(toolCallId, toolId, toolName);
    syncToolProgress();
  }, [toolProgressStore, syncToolProgress]);

  const completeToolProgress = useCallback((toolCallId: string, success: boolean, message: string, durationMs?: number) => {
    toolProgressStore.completeTool(toolCallId, success, message, durationMs);
    syncToolProgress();
  }, [toolProgressStore, syncToolProgress]);

  const failToolProgress = useCallback((toolCallId: string, message: string, durationMs?: number) => {
    toolProgressStore.failTool(toolCallId, message, durationMs);
    syncToolProgress();
  }, [toolProgressStore, syncToolProgress]);

  const terminalToolProgress = useCallback((toolCallId: string, status: "cancelled" | "timeout", message: string, durationMs?: number) => {
    toolProgressStore.terminalTool(toolCallId, status, message, durationMs);
    syncToolProgress();
  }, [toolProgressStore, syncToolProgress]);

  const appendToolProgressChunk = useCallback((toolCallId: string, chunk: string) => {
    toolProgressStore.appendChunk(toolCallId, chunk);
    // Coalesced flush for stdout chunks — they can be high-frequency.
    // Use a microtask batch so multiple chunks in one tick don't spam renders.
    setToolProgress(toolProgressStore.snapshot());
  }, [toolProgressStore]);

  const clearToolProgress = useCallback(() => {
    toolProgressStore.clear();
    syncToolProgress();
  }, [toolProgressStore, syncToolProgress]);

  /** Start a new mission */
  const startMission = useCallback((text: string, runId: string | null = null) => {
    setMission(text);
    setMissionState({
      text,
      runId,
      state: "UNDERSTANDING",
      startedAt: Date.now(),
      endedAt: null,
      filesTouched: [],
      commandsExecuted: [],
      testResults: null,
      typecheckPassed: null,
      buildPassed: null,
      runtimeProven: null,
      baselineGitFiles: [],
      missionDeltaFiles: null,
      readOnly: null,
      toolsUsed: [],
    });
  }, []);

  /** Record the git baseline captured at mission start. */
  const setMissionBaseline = useCallback((files: string[]) => {
    setMissionState((prev) => prev ? { ...prev, baselineGitFiles: files } : prev);
  }, []);

  /** Record the mission delta computed at completion (baseline vs now). */
  const setMissionDelta = useCallback((files: string[]) => {
    setMissionState((prev) => prev ? { ...prev, missionDeltaFiles: files } : prev);
  }, []);

  /** Record whether the mission was read-only (no mutation tools). */
  const setMissionReadOnly = useCallback((readOnly: boolean) => {
    setMissionState((prev) => prev ? { ...prev, readOnly } : prev);
  }, []);

  /** Record a tool invocation (for honest read-only summaries). */
  const addMissionTool = useCallback((toolId: string) => {
    setMissionState((prev) => {
      if (!prev) return prev;
      if (prev.toolsUsed.includes(toolId)) return prev;
      return { ...prev, toolsUsed: [...prev.toolsUsed, toolId] };
    });
  }, []);

  /** Update the mission state (lifecycle phase) */
  const updateMissionState = useCallback((state: HoloState) => {
    setMissionState((prev) => {
      if (!prev) return prev;
      if (state === "COMPLETE" || state === "FAILED" || state === "CANCELLED" || state === "TIMEOUT") {
        const completed = { ...prev, state, endedAt: Date.now() };
        setLastCompletedMission(completed);
        return completed;
      }
      return { ...prev, state };
    });
  }, []);

  /** Add a touched file to the mission */
  const addMissionFile = useCallback((file: string) => {
    setMissionState((prev) => {
      if (!prev) return prev;
      if (prev.filesTouched.includes(file)) return prev;
      return { ...prev, filesTouched: [...prev.filesTouched, file] };
    });
  }, []);

  /** Add an executed command to the mission */
  const addMissionCommand = useCallback((command: string) => {
    setMissionState((prev) => {
      if (!prev) return prev;
      return { ...prev, commandsExecuted: [...prev.commandsExecuted, command] };
    });
  }, []);

  /** Update mission test results */
  const setMissionTestResults = useCallback((results: { passed: number; failed: number; total: number }) => {
    setMissionState((prev) => prev ? { ...prev, testResults: results } : prev);
  }, []);

  /** Update mission typecheck status */
  const setMissionTypecheck = useCallback((passed: boolean) => {
    setMissionState((prev) => prev ? { ...prev, typecheckPassed: passed } : prev);
  }, []);

  /** Update mission build status */
  const setMissionBuild = useCallback((passed: boolean) => {
    setMissionState((prev) => prev ? { ...prev, buildPassed: passed } : prev);
  }, []);

  /** Update mission runtime proven status */
  const setMissionRuntimeProven = useCallback((proven: boolean) => {
    setMissionState((prev) => prev ? { ...prev, runtimeProven: proven } : prev);
  }, []);

  /** Clear the mission (after completion display) */
  const clearMission = useCallback(() => {
    setMission(null);
    setMissionState(null);
  }, []);

  const addCommand = useCallback((cmd: string) => {
    if (cmd.trim()) {
      setCommandHistory((prev) => [...prev.slice(-100), cmd]);
    }
    setHistoryIndex(-1);
  }, []);

  const navigateHistory = useCallback((direction: "up" | "down"): string | null => {
    if (commandHistory.length === 0) return null;
    if (direction === "up") {
      const newIdx = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIdx);
      return commandHistory[newIdx] ?? null;
    } else {
      if (historyIndex === -1) return null;
      const newIdx = historyIndex + 1;
      if (newIdx >= commandHistory.length) {
        setHistoryIndex(-1);
        return "";
      }
      setHistoryIndex(newIdx);
      return commandHistory[newIdx] ?? null;
    }
  }, [commandHistory, historyIndex]);

  const clearApproval = useCallback(() => setApprovalPrompt(null), []);

  /** Toggle execution mode (Tab). PLAN = read-only, ACT = full. */
  const toggleMode = useCallback(() => {
    setMode((prev) => prev === "act" ? "plan" : "act");
  }, []);

  /** Set workspace context (project name / root / git counts). */
  const setWorkspace = useCallback((p: { project?: string; cwd?: string; branch?: string; gitModified?: number; gitUntracked?: number }) => {
    if (p.project !== undefined) setProject(p.project);
    if (p.cwd !== undefined) setCwd(p.cwd);
    if (p.branch !== undefined) setBranch(p.branch);
    if (p.gitModified !== undefined) setGitModified(p.gitModified);
    if (p.gitUntracked !== undefined) setGitUntracked(p.gitUntracked);
  }, []);

  // ─── Overlay + busy transitions drive the focus epoch ────────────
  // Exactly-once restoration: opening an overlay does NOT bump; closing
  // one DOES. Starting a run does NOT bump; the run settling (busy →
  // idle) DOES. The tracker is transition-based, so repeated no-op
  // calls (stale closures, double stopBusy) never double-bump.
  const setOverlay = useCallback((next: Overlay) => {
    const tracker = focusTrackerRef.current!;
    tracker.setOverlay(next);
    setOverlayState(next);
    setFocusEpoch(tracker.epoch);
  }, []);

  /** Mark the shell busy (status bar "◉ Working · Ns" timer). */
  const startBusy = useCallback(() => {
    const tracker = focusTrackerRef.current!;
    tracker.setBusy(true);
    setBusySince(Date.now());
    setFocusEpoch(tracker.epoch);
  }, []);

  /** End the busy state — restores composer focus exactly once. */
  const stopBusy = useCallback(() => {
    const tracker = focusTrackerRef.current!;
    tracker.setBusy(false);
    setBusySince(null);
    setFocusEpoch(tracker.epoch);
  }, []);

  // ─── Terminal → IDLE auto-transition (race-safe) ─────────────────
  // After a run settles (COMPLETE/FAILED/CANCELLED/TIMEOUT), the UI
  // auto-transitions back to IDLE after a short display delay. The old
  // approach was `setTimeout(() => setHoloState("IDLE"), N)` — fire-and-
  // forget. If the user started a NEW run within the delay window, the
  // stale timer would override the new run's UNDERSTANDING/RUNNING state
  // back to IDLE, causing the composer to unblock mid-run and the status
  // bar to drop "Working".
  //
  // scheduleIdle fixes this with TWO guards:
  //   1. Only ONE idle timer is pending at a time (previous is cleared).
  //   2. The timer uses the functional updater `setHoloState((prev) => …)`
  //      so it reads the CURRENT state, not the stale closure state. It
  //      only transitions to IDLE from a terminal state — a new run that
  //      started during the delay window is left untouched.
  const terminalIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleIdle = useCallback((delayMs: number) => {
    if (terminalIdleTimerRef.current) clearTimeout(terminalIdleTimerRef.current);
    terminalIdleTimerRef.current = setTimeout(() => {
      terminalIdleTimerRef.current = null;
      setHoloState(idleTransitionFromTerminal);
    }, delayMs);
  }, []);

  /** Explicit focus restoration (e.g. typing returns from history). */
  const bumpFocus = useCallback(() => {
    const tracker = focusTrackerRef.current!;
    tracker.bump();
    setFocusEpoch(tracker.epoch);
  }, []);

  // ─── Transcript scroll (viewport position — never mutates history) ──
  const scrollPgUp = useCallback(() => {
    const page = Math.max(1, transcriptPage);
    setTranscriptAnchor((prev) => {
      const base = prev ?? chatTranscript.length;
      return Math.max(0, base - page);
    });
  }, [transcriptPage, chatTranscript.length]);

  const scrollPgDn = useCallback(() => {
    const page = Math.max(1, transcriptPage);
    setTranscriptAnchor((prev) => {
      if (prev === null) return null;
      const next = prev + page;
      return next >= chatTranscript.length ? null : next;
    });
  }, [transcriptPage, chatTranscript.length]);

  const scrollHome = useCallback(() => setTranscriptAnchor(0), []);
  const scrollEnd = useCallback(() => setTranscriptAnchor(null), []);
  const resetTranscriptScroll = useCallback(() => setTranscriptAnchor(null), []);

  // Auto-clear approval prompt when holoState transitions away from APPROVAL
  useEffect(() => {
    if (holoState !== "APPROVAL" && approvalPrompt) {
      setApprovalPrompt(null);
    }
  }, [holoState, approvalPrompt]);

  return {
    state: {
      selectedPanel,
      holoState,
      commandHistory,
      historyIndex,
      approvalPrompt,
      activityLog,
      connected,
      executionTarget,
      localRuntime,
      remoteRuntime,
      currentRunId,
      selectedModel,
      routingMode,
      activeModel,
      activeProvider,
      overlay,
      mission,
      missionState,
      lastCompletedMission,
      canonicalMission,
      isProcessing,
      branch,
      chatTranscript,
      toolProgress,
      mode,
      project,
      cwd,
      gitModified,
      gitUntracked,
      composerValue,
      overlayQuery,
      busySince,
      transcriptAnchor,
      transcriptPage,
      focusEpoch,
    },
    actions: {
      setSelectedPanel,
      setHoloState,
      addActivity,
      addCommand,
      navigateHistory,
      setApprovalPrompt,
      clearApproval,
      setConnected,
      setLocalRuntime,
      setRemoteRuntime,
      setCurrentRunId,
      setSelectedModel,
      setRoutingMode,
      setActiveModel,
      setActiveProvider,
      setOverlay,
      setMission,
      startMission,
      updateMissionState,
      addMissionFile,
      addMissionCommand,
      setMissionTestResults,
      setMissionTypecheck,
      setMissionBuild,
      setMissionRuntimeProven,
      setMissionBaseline,
      setMissionDelta,
      setMissionReadOnly,
      addMissionTool,
      clearMission,
      setCanonicalMission,
      setIsProcessing,
      setBranch,
      addChatMessage,
      appendAssistantDelta,
      finalizeAssistantMessage,
      getChatTranscript,
      clearChatTranscript,
      startToolProgressMission,
      completeToolProgressMission,
      failToolProgressMission,
      startToolProgress,
      completeToolProgress,
      failToolProgress,
      terminalToolProgress,
      appendToolProgressChunk,
      clearToolProgress,
      setMode,
      toggleMode,
      setWorkspace,
      setComposerValue,
      setOverlayQuery,
      startBusy,
      stopBusy,
      scheduleIdle,
      bumpFocus,
      setTranscriptAnchor,
      setTranscriptPage,
      scrollPgUp,
      scrollPgDn,
      scrollHome,
      scrollEnd,
      resetTranscriptScroll,
    },
  };
}

export type CockpitStore = ReturnType<typeof useCockpitStore>;
