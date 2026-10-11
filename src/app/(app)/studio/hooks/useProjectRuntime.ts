"use client";

/**
 * useProjectRuntime — the ONE client-side source of truth for the active
 * project's runtime status, and the ONLY reader of useTerminalStore
 * (besides the TerminalPanel producer that drives the store).
 *
 * Merges:
 * - Server-side workspace state from /api/project-runtime
 * - Real terminal-server reachability from /api/capabilities/project-terminal
 *   (its /health probe — server-side executability)
 * - Client-side PTY connection state from useTerminalStore (status feed only)
 *
 * Separated concepts — do not conflate:
 * - executionAvailable = workspace ready AND terminal server reachable.
 *   Agent command execution goes through transport.exec → terminal-server
 *   HTTP (server-side, PTY-independent), so a browser/agent job must NEVER
 *   wait on an interactive PTY being attached.
 * - terminal.usable = the visible PTY drawer is interactive right now
 *   (connected + verified session + fresh heartbeat).
 *
 * Every Studio panel should consume this hook instead of independently
 * calculating readiness from useConnectionSummary or useTerminalStore alone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import type {
  TerminalFailureStage,
  TerminalStatus,
} from "@/lib/capabilities/types";
import {
  INITIAL_RUNTIME_STATE,
  type ProjectRuntimeState,
  type RuntimePhase,
} from "@/lib/projects/runtime-state";
import { resolveStudioProjectId } from "../lib/first-run-handoff";

const POLL_INTERVAL_MS = 15_000;
const STALE_MS = 30_000;

/** Visible-PTY drawer executability, derived once at the canonical layer. */
export type TerminalExecutionState =
  | "available"
  | "unavailable"
  | "connecting"
  | "error"
  | "idle";

export interface TerminalRuntimeInfo {
  /** Raw PTY transport status from useTerminalStore — a STATUS FEED, not the execution pipe. */
  status: TerminalStatus;
  /** Verified PTY session id (set by session:ready), or null. */
  sessionId: string | null;
  /**
   * Visible-PTY drawer state: "available" only when the store says connected
   * AND a verified cwd exists; "idle" when the server is reachable but no PTY
   * is attached (normal idle); "unavailable" when the server is unreachable.
   */
  execution: TerminalExecutionState;
  /** Verified cwd from the PTY session — only set when the PTY is truly ready. */
  cwd: string | null;
  /** Last terminal error from the store, or null. */
  error: string | null;
  /** Specific failure stage from the store — for LiTTAI diagnostics. */
  failureStage: TerminalFailureStage;
  /**
   * True when the terminal server /health endpoint responded OK (real probe
   * of /api/capabilities/project-terminal). This is what gates
   * executionAvailable — NOT PTY attachment.
   */
  serverReachable: boolean;
  /**
   * True when the interactive PTY is usable right now (connected + verified
   * session + fresh heartbeat). Use for "Run in terminal" affordances.
   */
  usable: boolean;
}

export interface UseProjectRuntimeResult {
  state: ProjectRuntimeState;
  /** The canonical terminal derivation — the ONLY place terminal state is derived. */
  terminal: TerminalRuntimeInfo;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Derive the visible-PTY drawer state from the store status plus the real
 * server-reachability probe. Moved here from useConnectionSummary so the
 * derivation exists exactly once.
 */
function deriveTerminalExecution(
  status: TerminalStatus,
  sessionId: string | null,
  cwd: string | null,
  serverReachable: boolean,
): TerminalExecutionState {
  // PTY is only "available" when the store says connected AND a verified
  // cwd exists (set by session:ready, not by socket connect).
  if (status === "connected" && cwd) return "available";
  // Store says connected but no cwd — PTY not truly ready yet.
  if (status === "connected" || status === "connecting") return "connecting";
  if (
    status === "error" ||
    status === "auth_failed" ||
    status === "pty_failed" ||
    status === "unavailable" ||
    status === "project_context_missing"
  ) {
    return "error";
  }
  // Client says disconnected — "idle" = server reachable, no PTY session
  // (normal idle state); "unavailable" = server unreachable (real error).
  return serverReachable ? "idle" : "unavailable";
}

async function probeTerminalServerReachable(
  headers: Record<string, string>,
): Promise<boolean> {
  try {
    const response = await fetch("/api/capabilities/project-terminal", {
      cache: "no-store",
      credentials: "include",
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { serverReachable?: unknown };
    return data.serverReachable === true;
  } catch {
    return false;
  }
}

export function useProjectRuntime(options?: { disabled?: boolean }): UseProjectRuntimeResult {
  const [state, setState] = useState<ProjectRuntimeState>(INITIAL_RUNTIME_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { getToken, isLoaded: authLoaded, isSignedIn } = useClerkAuth();
  const searchParams = useSearchParams();
  const explicitProjectId = resolveStudioProjectId(searchParams.get("project"));

  // Client-side terminal store — source of truth for the PTY status feed.
  // This hook is the ONLY consumer of the store besides the TerminalPanel
  // producer. Everything below is re-exported via `terminal` — consumers
  // must NOT read useTerminalStore directly.
  const terminalStatus = useTerminalStore((s) => s.status);
  const terminalSessionId = useTerminalStore((s) => s.sessionId);
  const terminalCwd = useTerminalStore((s) => s.cwd);
  const terminalError = useTerminalStore((s) => s.error);
  const terminalFailureStage = useTerminalStore((s) => s.failureStage);
  const terminalUsable = useTerminalStore((s) => s.isUsable());

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
      const [runtimeResponse, serverReachable] = await Promise.all([
        fetch(url, {
          cache: "no-store",
          credentials: "include",
          headers,
          signal: AbortSignal.timeout(8000),
        }),
        probeTerminalServerReachable(headers),
      ]);
      if (!runtimeResponse.ok) {
        throw new Error(`Runtime resolve failed (${runtimeResponse.status})`);
      }
      const serverState = (await runtimeResponse.json()) as ProjectRuntimeState;
      if (!mountedRef.current) return;

      // Merge server workspace state with the real reachability probe.
      // (Direct object form — nothing here depends on previous state.)
      const workspaceReady = serverState.workspaceProvisioned && serverState.workspaceStatus === "ready";
      // PTY attachment state — status feed only; it no longer gates phases.
      const terminalConnected =
        terminalStatus === "connected" && Boolean(terminalSessionId) && Boolean(terminalCwd);

      // Separated concepts:
      // - executionAvailable = workspace ready AND terminal SERVER reachable.
      //   Agent execution goes through transport.exec → terminal-server HTTP
      //   (server-side, PTY-independent) — never gated on PTY attachment.
      // - "ready" = workspace ready + server reachable (provably executable
      //   after a fresh load / refresh, no terminal drawer needed).
      // - "terminal_unreachable" = workspace ready but the server itself is
      //   down (replaces the dead "terminal_disconnected" phase, which was
      //   produced from PTY state and never matched the real blocker).
      let phase: RuntimePhase = serverState.phase;
      if (workspaceReady && serverReachable) {
        phase = "ready";
      } else if (workspaceReady && !serverReachable) {
        phase = "terminal_unreachable";
      }

      // A write surface exists when the workspace is ready OR the PTY is
      // attached (the PTY can execute file writes in local dev).
      const writeSurfaceAvailable = workspaceReady || terminalConnected;

      setState({
        ...serverState,
        phase,
        terminalConnected,
        terminalSessionId: terminalSessionId ?? serverState.terminalSessionId,
        // Real probe — replaces the old hardcoded `false`.
        terminalServerReachable: serverReachable,
        executionAvailable: workspaceReady && serverReachable,
        readAccess: workspaceReady, // reads work even if terminal is down (via API)
        writeSurfaceAvailable,
        writeAccess: writeSurfaceAvailable, // legacy alias
        writeApprovalRequired: true, // policy — not derived from connection
        lastCheckedAt: new Date().toISOString(),
      });
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to resolve runtime");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [authLoaded, isSignedIn, getToken, explicitProjectId, terminalStatus, terminalSessionId, terminalCwd]);

  // Initial resolve + polling — skipped entirely when disabled so a
  // second hook instance can't double the runtime poll stack.
  useEffect(() => {
    if (options?.disabled) return;
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
  }, [refresh, options?.disabled]);

  // Re-merge PTY status-feed fields when the store changes (without
  // re-fetching from the server). Phase and executionAvailable are NOT
  // touched here — they depend on the server-side workspace state and the
  // reachability probe, never on PTY attachment.
  useEffect(() => {
    setState((prev) => {
      // Only refine if we have a server state already
      if (prev.phase === "idle" || prev.phase === "unauthenticated") return prev;

      const terminalConnected =
        terminalStatus === "connected" && Boolean(terminalSessionId) && Boolean(terminalCwd);
      if (
        terminalConnected === prev.terminalConnected &&
        (terminalSessionId ?? prev.terminalSessionId) === prev.terminalSessionId
      ) {
        return prev;
      }

      const workspaceReady = prev.workspaceProvisioned && prev.workspaceStatus === "ready";
      const writeSurfaceAvailable = workspaceReady || terminalConnected;

      return {
        ...prev,
        terminalConnected,
        terminalSessionId: terminalSessionId ?? prev.terminalSessionId,
        writeSurfaceAvailable,
        writeAccess: writeSurfaceAvailable, // legacy alias
        writeApprovalRequired: true, // policy — not derived from connection
      };
    });
  }, [terminalStatus, terminalSessionId, terminalCwd]);

  // The canonical terminal derivation — the ONLY place terminal state is
  // derived. Consumers map these fields; they never re-derive.
  const terminal = useMemo<TerminalRuntimeInfo>(() => {
    const serverReachable = state.terminalServerReachable;
    return {
      status: terminalStatus,
      sessionId: terminalSessionId,
      execution: deriveTerminalExecution(terminalStatus, terminalSessionId, terminalCwd, serverReachable),
      cwd: terminalCwd,
      error: terminalError,
      failureStage: terminalFailureStage,
      serverReachable,
      usable: terminalUsable,
    };
  }, [
    terminalStatus,
    terminalSessionId,
    terminalCwd,
    terminalError,
    terminalFailureStage,
    terminalUsable,
    state.terminalServerReachable,
  ]);

  return { state, terminal, loading, error, refresh };
}
