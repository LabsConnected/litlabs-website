"use client";

/**
 * ChatBrowserLiveView — the live browser session embedded in the
 * ordinary Studio chat thread.
 *
 * This is the chat-first-class surface: when the conversation has a
 * browser session (auto-started by chat intent via the intent-router
 * browser lane, or attached to this conversation), this panel renders
 * directly in the thread — the live browser visible inside the
 * conversation, drivable on mobile, with Take control / Resume / Stop
 * wired to the same server-enforced control endpoints as the
 * browser-jobs panel.
 *
 * Honesty contract (same as the jobs panel):
 * - The embedded iframe is shown ONLY when the session-scoped probe
 *   (GET /api/litt/browser/session/live-view) says available. The
 *   capability URL never reaches the client otherwise.
 * - When not live, the panel shows exactly why (probe reason copy),
 *   never a stale frame presented as live.
 * - When the conversation has no browser session, this renders
 *   nothing — zero clutter in ordinary chats.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useBrowserSessionStatus } from "../hooks/useBrowserSessionStatus";
import {
  LIVE_VIEW_DISCONNECTED_COPY,
  LIVE_VIEW_REASON_COPY,
  type LiveViewUnavailableReason,
} from "@/lib/browser-live-view";

interface SessionLiveViewProbe {
  available: boolean;
  reason: string;
  embedUrl: string | null;
  openUrl: string | null;
  sessionId: string | null;
  sessionStatus: string | null;
  checkedAt: string;
}

const PROBE_POLL_MS = 15_000;

/** Button base: 44px tap targets so the panel is drivable on mobile. */
const CONTROL_BUTTON_CLASS =
  "min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

function ControllerBadge({ controller }: { controller: string | null }) {
  if (controller === "human") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-300" />
        You&apos;re in control
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--litt-lime,#a3e635)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--litt-lime,#a3e635)]">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--litt-lime,#a3e635)] opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--litt-lime,#a3e635)]" />
      </span>
      Agent driving
    </span>
  );
}

export function ChatBrowserLiveView({ conversationId }: { conversationId: string }) {
  const {
    status,
    error,
    stopping,
    stop,
    controlBusy,
    liveViewUrl,
    takeControl,
    returnControl,
  } = useBrowserSessionStatus(conversationId);

  const [probe, setProbe] = useState<SessionLiveViewProbe | null>(null);
  const [iframeAlive, setIframeAlive] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sessionId = status.sessionId;
  const humanControl = status.controller === "human";
  const agentControl = status.controller === "agent" || status.controller == null;
  const hasSession =
    (status.state === "live" || status.state === "idle") && !!sessionId;
  const showTakeControl = hasSession && agentControl && !humanControl;
  const showResume = hasSession && humanControl;
  const showStop = !!hasSession;
  const busy = controlBusy || stopping;

  const fetchProbe = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/litt/browser/session/live-view?conversationId=${encodeURIComponent(conversationId)}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (res.status === 404) {
        setProbe(null);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as SessionLiveViewProbe;
      setProbe(data);
      setIframeAlive(true);
    } catch {
      // Network blip: keep the last probe; the next poll retries.
      // A failed probe is not "disconnected" — never flip to a
      // confident wrong state.
    }
  }, [conversationId]);

  useEffect(() => {
    if (!sessionId) {
      setProbe(null);
      return;
    }
    void fetchProbe();
    pollRef.current = setInterval(() => {
      if (document.visibilityState === "visible") void fetchProbe();
    }, PROBE_POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [sessionId, fetchProbe]);

  // No browser session for this conversation (or still probing) →
  // render nothing. Zero clutter in ordinary chats.
  if (!hasSession) return null;

  const live = probe?.available === true && !!probe.embedUrl && iframeAlive;
  const reasonCopy = probe
    ? (LIVE_VIEW_REASON_COPY[probe.reason as LiveViewUnavailableReason] ?? null)
    : null;
  const openUrl = probe?.openUrl ?? liveViewUrl;

  return (
    <section
      aria-label="Live browser session"
      data-testid="chat-browser-live-view"
      className="mb-3 overflow-hidden rounded-2xl border border-white/10 bg-black/40"
    >
      {/* Header: live badge + controller + controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${
            live
              ? "bg-[var(--litt-lime,#a3e635)] text-black"
              : "bg-white/10 text-white/70"
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-black" : "bg-white/50"}`}
          />
          {live ? "LIVE" : "BROWSER"}
        </span>
        <ControllerBadge controller={status.controller} />
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {showTakeControl && (
            <button
              type="button"
              onClick={() => void takeControl()}
              disabled={busy}
              data-testid="chat-browser-take-control"
              className={`${CONTROL_BUTTON_CLASS} bg-amber-400/20 text-amber-200 hover:bg-amber-400/30`}
            >
              {busy ? "…" : "Take control"}
            </button>
          )}
          {showResume && (
            <button
              type="button"
              onClick={() => void returnControl()}
              disabled={busy}
              data-testid="chat-browser-resume"
              className={`${CONTROL_BUTTON_CLASS} bg-[var(--litt-lime,#a3e635)] text-black hover:brightness-110`}
            >
              {busy ? "…" : "Resume agent"}
            </button>
          )}
          {showStop && (
            <button
              type="button"
              onClick={() => void stop()}
              disabled={busy}
              data-testid="chat-browser-stop"
              className={`${CONTROL_BUTTON_CLASS} bg-white/10 text-white/80 hover:bg-white/15`}
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
        </span>
      </div>

      {/* Live iframe or honest fallback */}
      {live && probe?.embedUrl ? (
        <div className="relative">
          <iframe
            key={probe.embedUrl}
            src={probe.embedUrl}
            title="Live browser session"
            data-testid="chat-browser-live-iframe"
            className="aspect-video min-h-[280px] w-full border-0 bg-black md:min-h-[420px]"
            allow="clipboard-read; clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onError={() => setIframeAlive(false)}
          />
          {openUrl && (
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute right-2 top-2 min-h-[44px] inline-flex items-center rounded-lg bg-black/70 px-3 text-[12px] font-semibold text-white backdrop-blur hover:bg-black/90"
            >
              Open in new tab
            </a>
          )}
        </div>
      ) : (
        <div className="px-4 py-5 text-center" data-testid="chat-browser-offline">
          <p className="text-[13px] font-semibold text-white/85">
            {reasonCopy?.title ?? LIVE_VIEW_DISCONNECTED_COPY.title}
          </p>
          <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-white/55">
            {reasonCopy?.detail ?? LIVE_VIEW_DISCONNECTED_COPY.detail}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {openUrl && (
              <a
                href={openUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${CONTROL_BUTTON_CLASS} bg-white/10 text-white/85 hover:bg-white/15`}
              >
                Open session page
              </a>
            )}
            <button
              type="button"
              onClick={() => void fetchProbe()}
              className={`${CONTROL_BUTTON_CLASS} bg-white/10 text-white/85 hover:bg-white/15`}
            >
              Recheck
            </button>
          </div>
          {error && (
            <p className="mt-2 text-[12px] text-red-300/90">{error}</p>
          )}
        </div>
      )}
    </section>
  );
}
