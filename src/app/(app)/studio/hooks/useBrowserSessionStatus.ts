"use client";

/**
 * useBrowserSessionStatus — live browser session state for the Studio
 * status chip (Phase 2).
 *
 * Polls GET /api/litt/browser/status (the honest liveness probe) and
 * exposes:
 *   - status: { state: "live"|"idle"|"disconnected", sessionId, ... }
 *   - stop(): close the active session, then re-poll so the chip flips
 *     to "disconnected" on the server's word, not optimistically.
 *
 * Polling pauses while the tab is hidden to avoid pointless traffic.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type BrowserChipState = "live" | "idle" | "disconnected" | "unknown";

export interface BrowserSessionStatus {
  state: BrowserChipState;
  sessionId: string | null;
  controller: string | null;
  sessionStatus: string | null;
  lastActivityAt: string | null;
}

const POLL_INTERVAL_MS = 15_000;

const UNKNOWN: BrowserSessionStatus = {
  state: "unknown",
  sessionId: null,
  controller: null,
  sessionStatus: null,
  lastActivityAt: null,
};

function parseStatus(json: unknown): BrowserSessionStatus {
  const o = (json ?? {}) as Record<string, unknown>;
  const state = o.state;
  if (state !== "live" && state !== "idle" && state !== "disconnected") {
    return UNKNOWN;
  }
  return {
    state,
    sessionId: typeof o.sessionId === "string" ? o.sessionId : null,
    controller: typeof o.controller === "string" ? o.controller : null,
    sessionStatus: typeof o.sessionStatus === "string" ? o.sessionStatus : null,
    lastActivityAt: typeof o.lastActivityAt === "string" ? o.lastActivityAt : null,
  };
}

export function useBrowserSessionStatus(conversationId?: string) {
  const [status, setStatus] = useState<BrowserSessionStatus>(UNKNOWN);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    try {
      const params = conversationId
        ? `?conversationId=${encodeURIComponent(conversationId)}`
        : "";
      const res = await fetch(`/api/litt/browser/status${params}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      setStatus(parseStatus(json));
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      // A failed probe is not "disconnected" — it's unknown. Never let a
      // network blip flip the chip to a confident wrong state.
      setError(err instanceof Error ? err.message : "status check failed");
    }
  }, [conversationId]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchStatus();

    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchStatus();
      }
    }, POLL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchStatus();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchStatus]);

  const stop = useCallback(async () => {
    const sessionId = status.sessionId;
    if (!sessionId || stopping) return;
    setStopping(true);
    try {
      const res = await fetch("/api/litt/browser/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", sessionId }),
      });
      if (!res.ok) throw new Error(`close ${res.status}`);
      // Re-poll: the chip flips only when the server confirms.
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to stop session");
    } finally {
      if (mountedRef.current) setStopping(false);
    }
  }, [status.sessionId, stopping, fetchStatus]);

  return { status, error, stopping, refresh: fetchStatus, stop };
}
