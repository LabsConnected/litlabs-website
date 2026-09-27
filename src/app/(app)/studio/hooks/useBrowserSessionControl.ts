"use client";

/**
 * useBrowserSessionControl — session-scoped control of a live Browserbase
 * session (the sibling of useBrowserSessionStatus, which is scoped to a
 * conversation — a jobs-panel card needs the session's own id).
 *
 * Polls GET /api/litt/browser/session?sessionId= for the authoritative
 * controller/status (server-persisted — ownership survives reloads and
 * rerenders), and exposes takeControl/returnControl/stop that POST the
 * session route and re-poll: control flips only on the server's word.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type SessionController = "agent" | "human" | null;

export interface BrowserSessionControlState {
  /** who owns the session right now (server truth) */
  controller: SessionController;
  /** lifecycle status: active | agent_control | human_control | paused | closed | error */
  sessionStatus: string | null;
  /** embeddable live-view URL (metadata.liveEmbedUrl preferred) */
  liveUrl: string | null;
  busy: boolean;
  error: string | null;
}

const EMPTY: BrowserSessionControlState = {
  controller: null,
  sessionStatus: null,
  liveUrl: null,
  busy: false,
  error: null,
};

const POLL_MS = 5_000;

export function useBrowserSessionControl(sessionId: string | null) {
  const [state, setState] = useState<BrowserSessionControlState>(EMPTY);
  const mountedRef = useRef(true);

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(
        `/api/litt/browser/session?sessionId=${encodeURIComponent(sessionId)}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!res.ok) throw new Error(`session ${res.status}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      const sess = (json?.session ?? {}) as Record<string, unknown>;
      const meta = (sess.metadata ?? {}) as Record<string, unknown>;
      const controller =
        sess.controller === "agent" || sess.controller === "human"
          ? (sess.controller as "agent" | "human")
          : null;
      const embed = meta.liveEmbedUrl;
      const live = sess.liveViewUrl;
      setState((prev) => ({
        ...prev,
        controller,
        sessionStatus: typeof sess.status === "string" ? sess.status : null,
        liveUrl:
          typeof embed === "string" && embed
            ? embed
            : typeof live === "string" && live
              ? live
              : null,
        error: null,
      }));
    } catch (err) {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : "session check failed",
      }));
    }
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    setState(EMPTY);
    if (!sessionId) return () => { mountedRef.current = false; };
    void fetchSession();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchSession();
    }, POLL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
    };
  }, [sessionId, fetchSession]);

  const postAction = useCallback(
    async (action: "take_control" | "return_control" | "close") => {
      if (!sessionId || state.busy) return;
      setState((prev) => ({ ...prev, busy: true, error: null }));
      try {
        const res = await fetch("/api/litt/browser/session", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, sessionId }),
        });
        if (!res.ok) throw new Error(`${action} ${res.status}`);
        await fetchSession();
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : `${action} failed`,
        }));
      } finally {
        if (mountedRef.current) setState((prev) => ({ ...prev, busy: false }));
      }
    },
    [sessionId, state.busy, fetchSession],
  );

  return {
    ...state,
    isLive:
      state.sessionStatus != null &&
      state.sessionStatus !== "closed" &&
      state.sessionStatus !== "error",
    takeControl: () => postAction("take_control"),
    returnControl: () => postAction("return_control"),
    stop: () => postAction("close"),
  };
}
