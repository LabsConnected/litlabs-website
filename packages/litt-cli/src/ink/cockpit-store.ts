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

import { useState, useCallback, useEffect } from "react";
import { ChatTranscriptStore } from "./chat-transcript-store.js";

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

export interface CockpitUIState {
  selectedPanel: CockpitPanel;
  holoState: HoloState;
  commandHistory: string[];
  historyIndex: number;
  approvalPrompt: ApprovalPrompt | null;
  activityLog: ActivityEntry[];
  /** @deprecated Use localRuntime + remoteRuntime for granular truth */
  connected: boolean;
  /** Local RuntimeSession readiness — always available */
  localRuntime: LocalRuntimeState;
  /** Remote terminal-server connection state — independent of local */
  remoteRuntime: RemoteRuntimeState;
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
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [routingMode, setRoutingMode] = useState<RoutingMode>("auto");
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>("none");
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
  // The transcript is owned by a pure ChatTranscriptStore (testable in
  // node env without a React renderer). The hook mirrors its snapshot
  // into React state so renders stay reactive. useState with a lazy
  // initializer creates the store once and never re-creates it.
  const [transcriptStore] = useState(() => new ChatTranscriptStore());
  const [chatTranscript, setChatTranscript] = useState<ChatMessage[]>(() => transcriptStore.snapshot());

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
  const syncTranscript = useCallback(() => {
    setChatTranscript(transcriptStore.snapshot());
  }, [transcriptStore]);

  /** Append a new user or assistant message. Returns the message id. */
  const addChatMessage = useCallback((msg: Omit<ChatMessage, "id">): string => {
    const id = transcriptStore.add(msg);
    syncTranscript();
    return id;
  }, [transcriptStore, syncTranscript]);

  /**
   * Append a delta to the LAST assistant message (streaming live preview).
   * If the last message is not a streaming assistant message, this is a
   * no-op (the caller must have added one first). Idempotent per delta.
   */
  const appendAssistantDelta = useCallback((text: string) => {
    transcriptStore.appendDelta(text);
    syncTranscript();
  }, [transcriptStore, syncTranscript]);

  /**
   * Finalize the LAST assistant message with canonical content + status.
   * Called ONCE when the agent loop completes (success) or errors.
   * Replaces the streaming body with the authoritative result.content so
   * the persisted message is exactly what the runtime produced — never a
   * partial stream, never duplicated. Also stamps the served model.
   */
  const finalizeAssistantMessage = useCallback((options: {
    content: string;
    status: "complete" | "error";
    servedModel?: string | null;
  }) => {
    transcriptStore.finalize(options);
    syncTranscript();
  }, [transcriptStore, syncTranscript]);

  /** Clear the chat transcript (e.g. /clear). */
  const clearChatTranscript = useCallback(() => {
    transcriptStore.clear();
    syncTranscript();
  }, [transcriptStore, syncTranscript]);

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

  /** Mark the shell busy (status bar "◉ Working · Ns" timer). */
  const startBusy = useCallback(() => setBusySince(Date.now()), []);
  const stopBusy = useCallback(() => setBusySince(null), []);

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
      localRuntime,
      remoteRuntime,
      currentRunId,
      selectedModel,
      routingMode,
      activeModel,
      overlay,
      mission,
      missionState,
      lastCompletedMission,
      canonicalMission,
      isProcessing,
      branch,
      chatTranscript,
      mode,
      project,
      cwd,
      gitModified,
      gitUntracked,
      composerValue,
      overlayQuery,
      busySince,
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
      clearMission,
      setCanonicalMission,
      setIsProcessing,
      setBranch,
      addChatMessage,
      appendAssistantDelta,
      finalizeAssistantMessage,
      clearChatTranscript,
      setMode,
      toggleMode,
      setWorkspace,
      setComposerValue,
      setOverlayQuery,
      startBusy,
      stopBusy,
    },
  };
}

export type CockpitStore = ReturnType<typeof useCockpitStore>;
