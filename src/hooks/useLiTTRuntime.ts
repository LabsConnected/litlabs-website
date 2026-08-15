"use client";

/**
 * useLiTTRuntime — the ONE Socket.IO consumer for canonical agent runtime state.
 *
 * Phase 2D: Both PowerShell and litbit-web must consume the same canonical
 * RuntimeStore from terminal-server. This hook is the web-side boundary.
 *
 * Flow:
 *   socket connect → runtime:snapshot → runtime:state updates → runtime:event activity
 *   disconnect → mark stale/offline
 *   reconnect → full snapshot resync
 *
 * Freshness is derived from heartbeat timestamps:
 *   fresh       — heartbeat within 2x interval
 *   stale       — heartbeat older than 2x interval, or failures >= maxFailures
 *   unreachable — socket disconnected
 *
 * Multiple components should use this hook; it manages a single shared
 * Socket.IO connection internally. Do NOT create independent socket
 * listeners in visual components.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";

// ─── Types (mirror @litt/agent-core RuntimeState) ──────────────────

export interface HeartbeatStatus {
  seq: number;
  lastHeartbeatAt: number;
  failures: number;
  maxFailures: number;
  intervalMs: number;
  latencyMs: number | null;
}

export interface ActiveCommand {
  command: string;
  args: string[];
  startedAt: number;
  cwd: string;
  runId: string;
}

export interface LastResult {
  command: string;
  success: boolean;
  exitCode: number | null;
  durationMs: number;
  finishedAt: number;
  message: string;
  runId: string;
}

export interface ProjectContext {
  root: string;
  name: string;
  branch: string | null;
  remote: string | null;
  isGitRepo: boolean;
}

export interface RuntimeState {
  phase: string;
  project: ProjectContext | null;
  branch: string | null;
  model: string | null;
  profile: string | null;
  gitChanges: number;
  online: boolean;
  pingMs: number;
  contextTokens: number;
  heartbeat: HeartbeatStatus;
  activeCommand: ActiveCommand | null;
  lastResult: LastResult | null;
  updatedAt: number;
}

export type RuntimeFreshness = "fresh" | "stale" | "unreachable";

export interface RuntimeEvent {
  type: string;
  ts: number;
  data: Record<string, unknown>;
}

export interface UseLiTTRuntimeResult {
  state: RuntimeState | null;
  freshness: RuntimeFreshness;
  connected: boolean;
  events: RuntimeEvent[];
  error: string | null;
}

// ─── Singleton socket management ───────────────────────────────────
// One socket shared across all hook instances.

let sharedSocket: Socket | null = null;
let refCount = 0;
let lastSnapshot: RuntimeState | null = null;
let lastEvent: RuntimeEvent[] = [];

function getSharedSocket(url: string, token?: string | null): Socket {
  if (sharedSocket) return sharedSocket;

  const auth = token ? { token } : {};
  sharedSocket = io(url, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    auth,
  });

  // Snapshot on connect/reconnect
  sharedSocket.on("runtime:snapshot", (snapshot: RuntimeState) => {
    lastSnapshot = snapshot;
  });

  // Incremental state updates
  sharedSocket.on("runtime:state", (state: RuntimeState) => {
    lastSnapshot = state;
  });

  // Event stream (keep last 50)
  sharedSocket.on("runtime:event", (event: RuntimeEvent) => {
    lastEvent = [...lastEvent, event].slice(-50);
  });

  return sharedSocket;
}

// ─── Freshness computation ─────────────────────────────────────────

function computeFreshness(
  state: RuntimeState | null,
  connected: boolean,
  now: number,
): RuntimeFreshness {
  if (!connected) return "unreachable";
  if (!state) return "unreachable";

  const hb = state.heartbeat;
  if (!hb) return "stale";

  const elapsed = now - (hb.lastHeartbeatAt || 0);
  const staleThreshold = (hb.intervalMs || 15000) * 2;

  if (hb.lastHeartbeatAt === 0) return "stale";
  if (elapsed > staleThreshold) return "stale";
  if ((hb.failures ?? 0) >= (hb.maxFailures ?? 3)) return "stale";

  return "fresh";
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useLiTTRuntime(options?: {
  url?: string;
  /** Auth token for terminal server. undefined = not yet loaded (wait). null = no auth. string = auth. */
  token?: string | null | undefined;
  pollIntervalMs?: number;
}): UseLiTTRuntimeResult {
  const wsUrl =
    options?.url ??
    process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
    "http://127.0.0.1:4001";

  const token = options?.token ?? null;
  const pollMs = options?.pollIntervalMs ?? 5000;

  const [state, setState] = useState<RuntimeState | null>(lastSnapshot);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<RuntimeEvent[]>(lastEvent);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // forces freshness recompute

  const socketRef = useRef<Socket | null>(null);

  // Connect / disconnect
  // Wait for token before connecting — connecting without auth causes 401s.
  // If no token is provided (null), we still connect (for test/dev without auth).
  // If a token is explicitly undefined, we skip connection.
  useEffect(() => {
    // If token was explicitly set to undefined (vs null), don't connect yet
    // null = "no token provided, connect anyway" (for dev without auth)
    // undefined = "token not yet loaded, wait"
    // string = "token loaded, connect with auth"
    const shouldConnect = token !== undefined;
    if (!shouldConnect) return;

    refCount++;
    const socket = getSharedSocket(wsUrl, token ?? undefined);
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      setError(null);
      // Snapshot is received via runtime:snapshot listener
      if (lastSnapshot) setState(lastSnapshot);
    };

    const onDisconnect = (reason: string) => {
      setConnected(false);
      setError(reason);
      // Retain last known snapshot — do NOT clear it
      // Freshness will show stale/unreachable
    };

    const onConnectError = (err: Error) => {
      setConnected(false);
      setError(err.message);
    };

    const onSnapshot = (snapshot: RuntimeState) => {
      lastSnapshot = snapshot;
      setState(snapshot);
    };

    const onState = (s: RuntimeState) => {
      lastSnapshot = s;
      setState(s);
    };

    const onEvent = (event: RuntimeEvent) => {
      lastEvent = [...lastEvent, event].slice(-50);
      setEvents([...lastEvent]);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("runtime:snapshot", onSnapshot);
    socket.on("runtime:state", onState);
    socket.on("runtime:event", onEvent);

    // If already connected, sync immediately
    if (socket.connected) {
      setConnected(true);
      if (lastSnapshot) setState(lastSnapshot);
    }

    return () => {
      // If we returned early (no token), there's nothing to clean up
      if (!shouldConnect || !socketRef.current) return;

      const socket = socketRef.current;
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("runtime:snapshot", onSnapshot);
      socket.off("runtime:state", onState);
      socket.off("runtime:event", onEvent);

      refCount--;
      if (refCount <= 0 && sharedSocket) {
        sharedSocket.disconnect();
        sharedSocket = null;
        lastSnapshot = null;
        lastEvent = [];
        refCount = 0;
      }
      socketRef.current = null;
    };
  }, [wsUrl, token]);

  // Freshness tick — recompute periodically based on wall clock
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, pollMs);
    return () => clearInterval(timer);
  }, [pollMs]);

  const freshness = computeFreshness(state, connected, Date.now());

  return { state, freshness, connected, events, error };
}

// ─── Pure helpers (exported for testing) ───────────────────────────

export { computeFreshness };
