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

export interface BrowserBurn {
  billableMinutes: number;
  modelCalls: number;
  bits: number;
  live: boolean;
}

export interface BrowserSessionStatus {
  state: BrowserChipState;
  sessionId: string | null;
  controller: string | null;
  sessionStatus: string | null;
  lastActivityAt: string | null;
  /**
   * Phase 4 — live burn from the real session accumulator (served by
   * GET /api/litt/browser/status). Null when unknown: the chip shows no
   * burn rather than a fake number.
   */
  burn: BrowserBurn | null;
}

const POLL_INTERVAL_MS = 15_000;

const UNKNOWN: BrowserSessionStatus = {
  state: "unknown",
  sessionId: null,
  controller: null,
  sessionStatus: null,
  lastActivityAt: null,
  burn: null,
};

function parseBurn(value: unknown): BrowserBurn | null {
  const o = (value ?? {}) as Record<string, unknown>;
  if (
    typeof o.billableMinutes !== "number" ||
    typeof o.modelCalls !== "number" ||
    typeof o.bits !== "number"
  ) {
    return null;
  }
  return {
    billableMinutes: o.billableMinutes,
    modelCalls: o.modelCalls,
    bits: o.bits,
    live: o.live === true,
  };
}

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
    burn: parseBurn(o.burn),
  };
}

export function useBrowserSessionStatus(conversationId?: string, opts?: { active?: boolean }) {
  const [status, setStatus] = useState<BrowserSessionStatus>(UNKNOWN);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  // Phase 3 — cooperative control: busy flag for take control / resume,
  // plus the session's live view URL (fetched on session change) so the
  // human can actually drive the browser after taking control.
  const [controlBusy, setControlBusy] = useState(false);
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
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
    // One-shot probe always runs so a persistent session from a previous
    // page load is discovered without requiring a run to be active.
    void fetchStatus();

    // Ongoing polling only while it can change something: a live session
    // (burn/control state) or an active agent run (a session the run may
    // start). Idle Studio views must not poll a beta-gated endpoint.
    if (!opts?.active && !status.sessionId) {
      return () => { mountedRef.current = false; };
    }

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
  }, [fetchStatus, opts?.active, status.sessionId]);

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

  // Fetch the session's live view URL whenever the active session changes.
  // The human opens this after taking control to actually drive the
  // browser (sign in, solve a CAPTCHA); the agent never drives through it.
  useEffect(() => {
    const sessionId = status.sessionId;
    if (!sessionId) {
      setLiveViewUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/litt/browser/session?sessionId=${encodeURIComponent(sessionId)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (!res.ok) return;
        const json = await res.json();
        const sess = (json?.session ?? {}) as Record<string, unknown>;
        const meta = (sess.metadata ?? {}) as Record<string, unknown>;
        // Phase 6 — prefer the embeddable debugger URL (navbar hidden)
        // for the human's drive-it-yourself tab; fall back to the
        // dashboard session page. Both are owner-scoped server-side.
        const embed = meta.liveEmbedUrl;
        const url = sess.liveViewUrl;
        const picked =
          typeof embed === "string" && embed
            ? embed
            : typeof url === "string" && url
              ? url
              : null;
        if (!cancelled && mountedRef.current) {
          setLiveViewUrl(picked);
        }
      } catch {
        // Non-fatal: the control buttons still work without the live view.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status.sessionId]);

  // Phase 3 — cooperative control. POST take_control / return_control and
  // re-poll: the chip flips only when the server confirms the transfer.
  const postControl = useCallback(
    async (action: "take_control" | "return_control") => {
      const sessionId = status.sessionId;
      if (!sessionId || controlBusy) return;
      setControlBusy(true);
      try {
        const res = await fetch("/api/litt/browser/session", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, sessionId }),
        });
        if (!res.ok) throw new Error(`${action} ${res.status}`);
        await fetchStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : `${action} failed`);
      } finally {
        if (mountedRef.current) setControlBusy(false);
      }
    },
    [status.sessionId, controlBusy, fetchStatus],
  );

  const takeControl = useCallback(
    () => postControl("take_control"),
    [postControl],
  );
  const returnControl = useCallback(
    () => postControl("return_control"),
    [postControl],
  );

  return {
    status,
    error,
    stopping,
    refresh: fetchStatus,
    stop,
    controlBusy,
    liveViewUrl,
    takeControl,
    returnControl,
  };
}
