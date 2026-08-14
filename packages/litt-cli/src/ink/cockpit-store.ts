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
export type HoloState = "IDLE" | "THINKING" | "APPROVAL" | "RUNNING" | "VERIFYING" | "SUCCESS" | "FAILED" | "CANCELLED" | "TIMEOUT";

export interface ApprovalPrompt {
  runId: string;
  toolCallId: string;
  toolId: string;
  action: string;
  risk: string;
  scope: string;
}

export interface ActivityEntry {
  id: string;
  ts: number;
  type: string;
  runId?: string;
  toolCallId?: string;
  text: string;
  stream?: "stdout" | "stderr";
}

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
}

/** Overlay type — which modal/picker is open */
export type Overlay = "none" | "model-picker" | "command-palette";

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
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [mission, setMission] = useState<string | null>(null);

  const addActivity = useCallback((entry: ActivityEntry) => {
    setActivityLog((prev) => [...prev.slice(-200), entry]);
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
      overlay,
      mission,
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
      setOverlay,
      setMission,
    },
  };
}

export type CockpitStore = ReturnType<typeof useCockpitStore>;
