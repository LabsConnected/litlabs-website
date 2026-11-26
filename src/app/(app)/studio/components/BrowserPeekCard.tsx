"use client";

/**
 * BrowserPeekCard — stage one of the two-stage pop-out system
 * (Larry's design rulings, 2026-11-25), applied to the Browser.
 *
 * When LiTT starts working in the browser, the full side dock does
 * NOT open uninvited. A SMALL peek card appears at the top of the
 * right-side pop-up area instead: it names the surface, shows the
 * session's real status (the same live probe the status chip uses —
 * never a confident wrong state), and waits. It never auto-expands.
 * Clicking the card (or its Open button) is stage two: the full
 * Browser dock takes the area. Closing the card dismisses the peek
 * without touching the session.
 *
 * The full browser panel exists exactly once: it mounts only in
 * the dock (stage two), never inside this card.
 */

import { Globe, Maximize2, X } from "lucide-react";
import { useBrowserSessionStatus } from "../hooks/useBrowserSessionStatus";

interface BrowserPeekCardProps {
  conversationId?: string | null;
  onExpand: () => void;
  onClose: () => void;
}

export default function BrowserPeekCard({
  conversationId,
  onExpand,
  onClose,
}: BrowserPeekCardProps) {
  const { status } = useBrowserSessionStatus(conversationId ?? undefined, {
    active: true,
  });

  const statusLine =
    status.controller === "human"
      ? "You have control"
      : status.state === "live"
        ? "Live — LiTT is working"
        : status.state === "idle"
          ? "Idle"
          : status.state === "unknown"
            ? "Connecting…"
            : "Disconnected";

  return (
    <div
      className="m-2 flex w-[calc(100%-16px)] max-w-[320px] shrink-0 flex-col gap-2 rounded-xl border p-3 shadow-lg"
      style={{
        backgroundColor: "var(--studio-elevated)",
        borderColor: "var(--studio-border-strong)",
      }}
      data-testid="browser-peek-card"
    >
      <div className="flex items-center gap-2">
        <Globe size={14} style={{ color: "var(--color-accent)" }} aria-hidden />
        <span
          className="text-[11px] font-black uppercase tracking-[0.12em]"
          style={{ color: "var(--text-main)" }}
        >
          Browser
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold"
          style={{
            backgroundColor: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
            color: "var(--text-secondary)",
          }}
          data-testid="browser-peek-status"
        >
          {statusLine}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-black/5"
          style={{ color: "var(--text-muted)" }}
          aria-label="Dismiss browser peek"
          title="Dismiss"
          data-testid="browser-peek-close"
        >
          <X size={13} className="pointer-events-none" />
        </button>
      </div>
      <p className="text-[11px] leading-4" style={{ color: "var(--text-muted)" }}>
        LiTT is working in the browser. The full browser opens only when you ask.
      </p>
      <button
        type="button"
        onClick={onExpand}
        className="flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-bold transition-all hover:opacity-90 active:scale-95"
        style={{
          backgroundColor: "var(--color-accent)",
          color: "var(--on-accent, #fff)",
        }}
        data-testid="browser-peek-open"
      >
        <Maximize2 size={12} className="pointer-events-none" />
        Open the full browser
      </button>
    </div>
  );
}
