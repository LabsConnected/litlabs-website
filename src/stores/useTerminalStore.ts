"use client";

import { create } from "zustand";
import type { TerminalConnectionState, TerminalStatus } from "@/lib/capabilities/types";
import { HEARTBEAT_TIMEOUT_MS } from "@/lib/capabilities/types";

const INITIAL_STATE: TerminalConnectionState = {
  status: "disconnected",
  sessionId: null,
  projectId: null,
  workspaceId: null,
  connectedAt: null,
  lastHeartbeatAt: null,
  error: null,
};

interface TerminalStore extends TerminalConnectionState {
  setStatus: (status: TerminalStatus) => void;
  setSession: (sessionId: string | null, cwd?: string) => void;
  setProject: (projectId: string | null) => void;
  setWorkspace: (workspaceId: string | null) => void;
  setHeartbeat: (timestamp: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
  isUsable: () => boolean;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  ...INITIAL_STATE,

  setStatus: (status) =>
    set((state) => ({
      status,
      connectedAt:
        status === "connected" && state.status !== "connected"
          ? new Date().toISOString()
          : state.connectedAt,
      error: status === "error" ? state.error : status === "disconnected" ? null : state.error,
    })),

  setSession: (sessionId, _cwd) => set({ sessionId }),

  setProject: (projectId) => set({ projectId }),

  setWorkspace: (workspaceId) => set({ workspaceId }),

  setHeartbeat: (timestamp) => set({ lastHeartbeatAt: timestamp }),

  setError: (error) =>
    set((state) => ({
      error,
      status: error ? "error" : state.status,
    })),

  reset: () => set({ ...INITIAL_STATE }),

  isUsable: () => {
    const state = get();
    return (
      state.status === "connected" &&
      state.sessionId !== null &&
      state.lastHeartbeatAt !== null &&
      Date.now() - new Date(state.lastHeartbeatAt).getTime() < HEARTBEAT_TIMEOUT_MS
    );
  },
}));
