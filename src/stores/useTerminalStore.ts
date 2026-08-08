"use client";

import { create } from "zustand";
import type { TerminalConnectionState, TerminalStatus, TerminalFailureStage, TerminalDiagnostics } from "@/lib/capabilities/types";
import { HEARTBEAT_TIMEOUT_MS, HEARTBEAT_STALE_MS } from "@/lib/capabilities/types";

const INITIAL_STATE: TerminalConnectionState = {
  status: "disconnected",
  sessionId: null,
  projectId: null,
  workspaceId: null,
  connectedAt: null,
  lastHeartbeatAt: null,
  error: null,
  cwd: null,
  shell: null,
  failureStage: null,
  lastDisconnectReason: null,
};

interface TerminalStore extends TerminalConnectionState {
  setStatus: (status: TerminalStatus) => void;
  setSession: (sessionId: string | null, cwd?: string) => void;
  setProject: (projectId: string | null) => void;
  setWorkspace: (workspaceId: string | null) => void;
  setHeartbeat: (timestamp: string) => void;
  setError: (error: string | null) => void;
  setFailureStage: (stage: TerminalFailureStage) => void;
  setDisconnectReason: (reason: string | null) => void;
  setVerifiedSession: (data: { sessionId: string; cwd: string; shell: string; workspaceId?: string | null; projectId?: string | null }) => void;
  reset: () => void;
  isUsable: () => boolean;
  checkStaleHeartbeat: () => void;
  getDiagnostics: () => TerminalDiagnostics;
}

let staleCheckInterval: ReturnType<typeof setInterval> | null = null;

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  ...INITIAL_STATE,

  setStatus: (status) =>
    set((state) => {
      const isErrorState = ["error", "pty_failed", "auth_failed", "project_context_missing", "unavailable"].includes(status);
      return {
        status,
        connectedAt:
          status === "connected" && state.status !== "connected"
            ? new Date().toISOString()
            : state.connectedAt,
        error: isErrorState ? state.error : status === "disconnected" ? null : state.error,
      };
    }),

  setSession: (sessionId, _cwd) => set({ sessionId }),

  setProject: (projectId) => set({ projectId }),

  setWorkspace: (workspaceId) => set({ workspaceId }),

  setHeartbeat: (timestamp) => set({ lastHeartbeatAt: timestamp }),

  setError: (error) =>
    set((state) => ({
      error,
      status: error ? "error" : state.status,
    })),

  setFailureStage: (stage) => set({ failureStage: stage }),

  setDisconnectReason: (reason) => set({ lastDisconnectReason: reason }),

  setVerifiedSession: (data) =>
    set({
      sessionId: data.sessionId,
      cwd: data.cwd,
      shell: data.shell,
      workspaceId: data.workspaceId ?? null,
      projectId: data.projectId ?? null,
      status: "connected",
      connectedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      failureStage: null,
      error: null,
    }),

  reset: () => set({ ...INITIAL_STATE }),

  isUsable: () => {
    const state = get();
    return (
      state.status === "connected" &&
      state.sessionId !== null &&
      state.cwd !== null &&
      state.lastHeartbeatAt !== null &&
      Date.now() - new Date(state.lastHeartbeatAt).getTime() < HEARTBEAT_TIMEOUT_MS
    );
  },

  checkStaleHeartbeat: () => {
    const state = get();
    if (state.status === "connected" && state.lastHeartbeatAt) {
      const elapsed = Date.now() - new Date(state.lastHeartbeatAt).getTime();
      if (elapsed > HEARTBEAT_STALE_MS) {
        set({
          status: "error",
          error: `Heartbeat stale by ${Math.round(elapsed / 1000)}s`,
          failureStage: "heartbeat_stale",
        });
      }
    }
  },

  getDiagnostics: () => {
    const state = get();
    return {
      canonicalProjectId: state.projectId,
      repository: null,
      branch: null,
      workspaceId: state.workspaceId,
      workspaceStatus: null,
      socketConnected: state.status === "connected" || state.status === "connecting",
      ptyReady: state.status === "connected" && state.sessionId !== null && state.cwd !== null,
      cwd: state.cwd,
      shell: state.shell,
      failureStage: state.failureStage,
      lastError: state.error,
      lastDisconnectReason: state.lastDisconnectReason,
      lastCheckedAt: state.lastHeartbeatAt ?? state.connectedAt,
    };
  },
}));

// Start a global stale heartbeat checker (runs every 5s)
if (typeof window !== "undefined" && !staleCheckInterval) {
  staleCheckInterval = setInterval(() => {
    useTerminalStore.getState().checkStaleHeartbeat();
  }, 5_000);
}
