"use client";

/**
 * StudioBrowserStatusChip — chat-visible browser session indicator
 * (Phase 2 + Phase 3).
 *
 * Shows `Browser · Live` / `Browser · Idle` / `Browser · You have control`
 * / `Browser · Disconnected`, backed by the live probe at
 * GET /api/litt/browser/status via useBrowserSessionStatus. Honesty
 * contract (#397 precedent): the chip never says "live" unless the server
 * probe says so; a failed probe renders "unknown", never a confident wrong
 * state.
 *
 * Phase 2: a Stop button closes the session server-side; the chip flips
 * only after the server confirms the close.
 *
 * Phase 3 — cooperative control: a "Take control" button transfers the
 * session to the human (login wall, CAPTCHA, anything the agent cannot do);
 * while the human is in control the chip says so, offers the live view
 * link (where the human actually drives the browser), and a "Resume"
 * button hands control back to the agent. Agent actions during
 * human_control are refused server-side (browser-session-manager).
 *
 * Mounted above the Studio composer so it is visible during any browser
 * session. Lime accent per the visual-identity decision; mobile-first
 * compact pill.
 */
import { Globe, Square, Loader2, Hand, Play, ExternalLink } from "lucide-react";
import { useBrowserSessionStatus } from "../hooks/useBrowserSessionStatus";

const LIME = "var(--litt-primary)";

function dotColor(state: string, humanControl: boolean): string {
  if (humanControl) return "#e3b341";
  if (state === "live") return LIME;
  if (state === "idle") return "#e3b341";
  return "var(--text-muted)";
}

function label(state: string, humanControl: boolean, burn: { billableMinutes: number; bits: number } | null): string {
  // Phase 4 — live burn display, e.g. "Browser · Live · 3 min · 135
  // LiTTBits". The numbers come from the real session accumulator via the
  // status probe; burn is null (and the segment omitted) when unknown.
  const burnSeg = burn ? ` · ${burn.billableMinutes} min · ${burn.bits} LiTTBits` : "";
  if (humanControl) return `Browser · You have control${burnSeg}`;
  if (state === "live") return `Browser · Live${burnSeg}`;
  if (state === "idle") return `Browser · Idle${burnSeg}`;
  if (state === "unknown") return "Browser · …";
  return "Browser · Disconnected";
}

export default function StudioBrowserStatusChip({
  conversationId,
  active = false,
}: {
  conversationId?: string;
  /** True while an agent run is in flight — keeps polling so a session the
   *  run starts gets discovered. Idle views do not poll. */
  active?: boolean;
}) {
  const {
    status,
    error,
    stopping,
    stop,
    controlBusy,
    liveViewUrl,
    takeControl,
    returnControl,
  } = useBrowserSessionStatus(conversationId, { active });

  const humanControl = status.controller === "human";
  const agentControl =
    status.controller === "agent" || status.controller == null;
  const hasSession =
    (status.state === "live" || status.state === "idle") && status.sessionId;

  // No session = nothing to show. The chip exists to expose control of a
  // real session; a permanent "Disconnected" pill for users who have never
  // started a browser is noise, not status.
  if (!hasSession) return null;
  const showStop = hasSession;
  // Take control is offered while the agent holds the session; Resume
  // only while the human holds it. Control transfers flip only after the
  // server confirms (see the hook).
  const showTakeControl = hasSession && agentControl && !humanControl;
  const showResume = hasSession && humanControl;

  return (
    <div
      className="flex shrink-0 flex-col items-center justify-center px-3 pt-2"
      aria-live="polite"
      data-testid="browser-status-chip"
    >
      <div
        className="flex items-center gap-2 rounded-full border px-3 py-1.5"
        style={{
          borderColor: "var(--studio-border)",
          backgroundColor: "var(--studio-card)",
        }}
        role="status"
        aria-label={label(status.state, humanControl, status.burn)}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${status.state === "live" && !humanControl ? "animate-pulse" : ""}`}
            style={{ backgroundColor: dotColor(status.state, humanControl) }}
            aria-hidden
          />
          <Globe size={11} style={{ color: "var(--text-secondary)" }} aria-hidden />
          <span
            className="text-[10px] font-black tracking-wide"
            style={{ color: status.state === "live" && !humanControl ? LIME : "var(--text-secondary)" }}
          >
            {label(status.state, humanControl, status.burn)}
          </span>
        </span>
        {showTakeControl && (
          <button
            type="button"
            onClick={takeControl}
            disabled={controlBusy}
            data-testid="browser-take-control"
            className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black transition hover:bg-white/8 disabled:opacity-50"
            style={{ borderColor: "var(--studio-border-strong)", color: "var(--text-secondary)" }}
            aria-label="Take control of the browser"
            title="Take over the browser yourself (e.g. to sign in or solve a CAPTCHA)"
          >
            {controlBusy ? (
              <Loader2 size={9} className="animate-spin" />
            ) : (
              <Hand size={9} />
            )}
            {controlBusy ? "…" : "Take control"}
          </button>
        )}
        {showResume && (
          <>
            {liveViewUrl && (
              <a
                href={liveViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="browser-live-view"
                className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black transition hover:bg-white/8"
                style={{ borderColor: "var(--studio-border-strong)", color: "var(--text-secondary)" }}
                aria-label="Open the live browser view"
                title="Open the live browser view to drive it yourself"
              >
                <ExternalLink size={9} />
                Live view
              </a>
            )}
            <button
              type="button"
              onClick={returnControl}
              disabled={controlBusy}
              data-testid="browser-resume"
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black transition hover:bg-white/8 disabled:opacity-50"
              style={{ borderColor: "var(--studio-border-strong)", color: LIME }}
              aria-label="Resume agent control of the browser"
              title="Hand the browser back to LiTT"
            >
              {controlBusy ? (
                <Loader2 size={9} className="animate-spin" />
              ) : (
                <Play size={9} />
              )}
              {controlBusy ? "…" : "Resume"}
            </button>
          </>
        )}
        {showStop && (
          <button
            type="button"
            onClick={stop}
            disabled={stopping}
            className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black transition hover:bg-white/8 disabled:opacity-50"
            style={{ borderColor: "var(--studio-border-strong)", color: "var(--text-secondary)" }}
            aria-label="Stop browser session"
            title={status.sessionId ? `Close browser session ${status.sessionId}` : "Close browser session"}
          >
            {stopping ? (
              <Loader2 size={9} className="animate-spin" />
            ) : (
              <Square size={8} />
            )}
            {stopping ? "Closing…" : "Stop"}
          </button>
        )}
        {error && (
          <span
            className="max-w-40 truncate text-[9px]"
            style={{ color: "#e3b341" }}
            title={error}
          >
            check failed
          </span>
        )}
      </div>
      {humanControl && hasSession && (
        <div
          className="pt-1 text-center text-[9px] leading-snug"
          style={{ color: "var(--text-muted)" }}
          data-testid="browser-human-hint"
        >
          You&apos;re driving — sign in or solve the challenge
          {liveViewUrl ? " in the live view" : ""}, then tap Resume.
        </div>
      )}
    </div>
  );
}
