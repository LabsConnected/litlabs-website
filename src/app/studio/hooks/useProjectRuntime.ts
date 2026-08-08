"use client";

/**
 * useProjectRuntime — the ONE client-side source of truth for the active
 * project's runtime status.
 *
 * Merges:
 * - Server-side workspace state from /api/project-runtime
 * - Client-side terminal connection state from useTerminalStore
 *
 * Every Studio panel should consume this hook instead of independently
 * calculating readiness from useConnectionSummary or useTerminalStore alone.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  INITIAL_RUNTIME_STATE,
  type ProjectRuntimeState,
  type RuntimePhase,
} from "@/lib/projects/runtime-state";

const POLL_INTERVAL_MS = 15_000;
const STALE_MS = 30_000;

export interface UseProjectRuntimeResult {
  state: ProjectRuntimeState;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useProjectRuntime(): UseProjectRuntimeResult {
  const [state, setState] = useState<ProjectRuntimeState>(INITIAL_RUNTIME_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { getToken, isLoaded: authLoaded, isSignedIn } = useClerkAuth();
  const searchParams = useSearchParams();
  const explicitProjectId = searchParams.get("project");

  // Client-side terminal store — source of truth for WebSocket connection
  const terminalStatus = useTerminalStore((s) => s.status);
  const terminalSessionId = useTerminalStore((s) => s.sessionId);
  const terminalCwd = useTerminalStore((s) => s.cwd);

  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!authLoaded) return;
    if (!isSignedIn) {
      setState((prev) => ({
        ...prev,
        phase: "unauthenticated" as RuntimePhase,
        lastCheckedAt: new Date().toISOString(),
      }));
      setLoading(false);
      return;
    }

    try {
      const token = await getToken?.();
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};
      const url = `/api/project-runtime${
        explicitProjectId ? `?projectId=${encodeURIComponent(explicitProjectId)}` : ""
      }`;
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "include",
        headers,
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        throw new Error(`Runtime resolve failed (${response.status})`);
      }
      const serverState = (await response.json()) as ProjectRuntimeState;
      if (!mountedRef.current) return;

      // Merge server workspace state with client terminal state
      setState((prev) => {
        const workspaceReady = serverState.workspaceProvisioned && serverState.workspaceStatus === "ready";
        // Terminal is only connected when PTY session is verified with cwd
        const terminalConnected =
          terminalStatus === "connected" && Boolean(terminalSessionId) && Boolean(terminalCwd);

        let phase: RuntimePhase = serverState.phase;
        if (workspaceReady && !terminalConnected) {
          phase = "terminal_disconnected";
        } else if (workspaceReady && terminalConnected) {
          phase = "ready";
        }

        // Separated concepts:
        // - executionAvailable = workspace + terminal (can run commands)
        // - writeSurfaceAvailable = workspace provisioned (files can be written via API)
        //   OR terminal connected (files can be written via PTY)
        // - writeApprovalRequired = always true (safety policy, not connection state)
        const writeSurfaceAvailable = workspaceReady || terminalConnected;

        return {
          ...serverState,
          phase,
          terminalConnected,
          terminalSessionId: terminalSessionId ?? serverState.terminalSessionId,
          executionAvailable: workspaceReady && terminalConnected,
          readAccess: workspaceReady, // reads work even if terminal is down (via API)
          writeSurfaceAvailable,
          writeAccess: writeSurfaceAvailable, // legacy alias
          writeApprovalRequired: true, // policy — not derived from connection
          lastCheckedAt: new Date().toISOString(),
        };
      });
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to resolve runtime");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [authLoaded, isSignedIn, getToken, explicitProjectId, terminalStatus, terminalSessionId, terminalCwd]);

  // Initial resolve + polling
  useEffect(() => {
    mountedRef.current = true;
    void refresh();

    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [refresh]);

  // Re-merge terminal state when it changes (without re-fetching from server)
  useEffect(() => {
    setState((prev) => {
      // Only refine if we have a server state already
      if (prev.phase === "idle" || prev.phase === "unauthenticated") return prev;

      const workspaceReady = prev.workspaceProvisioned && prev.workspaceStatus === "ready";
      const terminalConnected =
        terminalStatus === "connected" && Boolean(terminalSessionId) && Boolean(terminalCwd);

      let phase: RuntimePhase = prev.phase;
      if (workspaceReady && !terminalConnected) {
        phase = "terminal_disconnected";
      } else if (workspaceReady && terminalConnected) {
        phase = "ready";
      }

      const writeSurfaceAvailable = workspaceReady || terminalConnected;

      return {
        ...prev,
        phase,
        terminalConnected,
        terminalSessionId: terminalSessionId ?? prev.terminalSessionId,
        executionAvailable: workspaceReady && terminalConnected,
        writeSurfaceAvailable,
        writeAccess: writeSurfaceAvailable, // legacy alias
        writeApprovalRequired: true, // policy — not derived from connection
      };
    });
  }, [terminalStatus, terminalSessionId, terminalCwd]);

  return { state, loading, error, refresh };
}
