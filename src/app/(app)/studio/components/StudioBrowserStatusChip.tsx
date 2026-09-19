"use client";

/**
 * StudioBrowserStatusChip — chat-visible browser session indicator
 * (Phase 2).
 *
 * Shows `Browser · Live` / `Browser · Idle` / `Browser · Disconnected`,
 * backed by the live probe at GET /api/litt/browser/status via
 * useBrowserSessionStatus. Honesty contract (#397 precedent): the chip
 * never says "live" unless the server probe says so; a failed probe
 * renders "unknown", never a confident wrong state.
 *
 * Includes a Stop button that closes the session server-side; the chip
 * flips only after the server confirms the close.
 *
 * Mounted above the Studio composer so it is visible during any browser
 * session. Lime accent per the visual-identity decision; mobile-first
 * compact pill.
 */
import { Globe, Square, Loader2 } from "lucide-react";
import { useBrowserSessionStatus } from "../hooks/useBrowserSessionStatus";

const LIME = "var(--litt-primary)";

function dotColor(state: string): string {
  if (state === "live") return LIME;
  if (state === "idle") return "#e3b341";
  return "var(--text-muted)";
}

function label(state: string): string {
  if (state === "live") return "Browser · Live";
  if (state === "idle") return "Browser · Idle";
  if (state === "unknown") return "Browser · …";
  return "Browser · Disconnected";
}

export default function StudioBrowserStatusChip({
  conversationId,
}: {
  conversationId?: string;
}) {
  const { status, error, stopping, stop } = useBrowserSessionStatus(conversationId);
  const showStop = (status.state === "live" || status.state === "idle") && status.sessionId;

  return (
    <div
      className="flex shrink-0 items-center justify-center px-3 pt-2"
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
        aria-label={label(status.state)}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${status.state === "live" ? "animate-pulse" : ""}`}
            style={{ backgroundColor: dotColor(status.state) }}
            aria-hidden
          />
          <Globe size={11} style={{ color: "var(--text-secondary)" }} aria-hidden />
          <span
            className="text-[10px] font-black tracking-wide"
            style={{ color: status.state === "live" ? LIME : "var(--text-secondary)" }}
          >
            {label(status.state)}
          </span>
        </span>
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
    </div>
  );
}
