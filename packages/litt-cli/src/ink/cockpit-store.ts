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
 * Activity entry — operator feed format.
 * tag is the short verb (THINK, ROUTE, READ, EDIT, RUN, PASS, VERIFY, etc.)
 */
export interface ActivityEntry {
  id: string;
  ts: number;
  type: string;
  tag?: string;
  runId?: string;
  toolCallId?: string;
  text: string;
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
  /** CHAT processing flag — independent of mission holoState.
   *  CHAT does NOT use UNDERSTANDING/PLANNING/etc. It sets isProcessing
   *  to block the composer while keeping holoState = IDLE. */
  isProcessing: boolean;
  /** Live git branch — refreshed before each submit to match tool truth. */
  branch: string;
}

/** Overlay type — which modal/picker is open */
export type Overlay = "none" | "model-picker" | "command-palette" | "model-center";

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [branch, setBranch] = useState<string>("unknown");

  const addActivity = useCallback((entry: ActivityEntry) => {
    setActivityLog((prev) => [...prev.slice(-200), entry]);
  }, []);

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
      isProcessing,
      branch,
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
      setIsProcessing,
      setBranch,
    },
  };
}

export type CockpitStore = ReturnType<typeof useCockpitStore>;
