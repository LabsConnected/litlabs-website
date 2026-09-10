"use client";

/**
 * LiTTMobileSheet — mobile (<1024px) access to LiTT.
 *
 * Reuses the exact same chatContent/liveContent the desktop LiTTPanel
 * uses. Only mounted while the sheet is open, so there is never a
 * second CommandComposer / LiTTLiveActivity instance alongside the
 * desktop rail.
 *
 * Geometry is driven by the Visual Viewport API so the sheet stays
 * pinned above the mobile keyboard instead of being covered by it.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MessageSquare, Activity, X } from "lucide-react";
import { useVisualViewport } from "../../hooks/useVisualViewport";
import type { LiTTTab } from "../LiTTPanel";

export interface LiTTMobileSheetProps {
  activeTab: LiTTTab;
  onTabChange: (tab: LiTTTab) => void;
  onClose: () => void;
  chatContent: ReactNode;
  liveContent: ReactNode;
}

const MOBILE_BOTTOM_NAV_H = 62;

export default function LiTTMobileSheet({
  activeTab,
  onTabChange,
  onClose,
  chatContent,
  liveContent,
}: LiTTMobileSheetProps) {
  const vv = useVisualViewport();
  const contentRef = useRef<HTMLDivElement>(null);
  const [safeBottom, setSafeBottom] = useState(0);

  // Read the bottom safe-area once (env() cannot be read directly in JS).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:-9999px;padding-bottom:env(safe-area-inset-bottom);";
    document.body.appendChild(probe);
    const computed = window.getComputedStyle(probe);
    const pb = parseInt(computed.paddingBottom || "0", 10);
    setSafeBottom(Number.isFinite(pb) ? pb : 0);
    document.body.removeChild(probe);
  }, []);

  const bottomInset = Math.max(0, Math.round(vv.bottomInset));
  const bottomOffset = MOBILE_BOTTOM_NAV_H + safeBottom + bottomInset;
  const availableHeight = Math.max(
    200,
    Math.round(vv.height - MOBILE_BOTTOM_NAV_H - safeBottom),
  );
  const sheetHeight = Math.min(Math.round(vv.height * 0.88), availableHeight);

  // When the keyboard opens, make sure the focused input (composer) is
  // scrolled into view inside the sheet's scrollable content area.
  useEffect(() => {
    if (!contentRef.current) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
      active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [vv.bottomInset, vv.height]);

  return (
    <>
      <button
        type="button"
        className="fixed inset-x-0 top-0 z-[10020] bg-black/55"
        style={{ bottom: `${bottomOffset}px` }}
        onClick={onClose}
        aria-label="Close LiTT"
        tabIndex={-1}
        aria-hidden
      />
      <div
        className="fixed inset-x-0 z-[10021] flex min-h-0 min-w-0 flex-col overflow-hidden rounded-t-2xl border-t"
        style={{
          bottom: `${bottomOffset}px`,
          height: `${sheetHeight}px`,
          maxHeight: `calc(${vv.height}px - var(--studio-mobile-bottom-h) - env(safe-area-inset-bottom))`,
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border)",
        }}
        data-testid="litt-mobile-sheet"
        role="dialog"
        aria-label="LiTT assistant"
        aria-modal="true"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/20" aria-hidden />

        <div
          className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1.5"
          style={{
            borderColor: "var(--studio-border)",
            backgroundColor: "rgba(13,9,22,0.6)",
          }}
        >
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
            style={{
              background: "linear-gradient(135deg, rgba(139,92,246,0.2), rgba(99,102,241,0.1))",
              border: "1px solid rgba(139,92,246,0.2)",
            }}
            aria-hidden
          >
            <span className="text-[9px] font-black" style={{ color: "var(--litt-primary)" }}>L</span>
          </div>
          <button
            type="button"
            onClick={() => onTabChange("chat")}
            className="flex min-h-10 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all"
            style={{
              color: activeTab === "chat" ? "var(--litt-primary)" : "var(--text-muted)",
              backgroundColor: activeTab === "chat" ? "rgba(139,92,246,0.1)" : "transparent",
            }}
            aria-pressed={activeTab === "chat"}
            data-testid="litt-mobile-tab-chat"
          >
            <MessageSquare size={12} className="pointer-events-none" />
            Chat
          </button>
          <button
            type="button"
            onClick={() => onTabChange("live")}
            className="flex min-h-10 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all"
            style={{
              color: activeTab === "live" ? "var(--litt-primary)" : "var(--text-muted)",
              backgroundColor: activeTab === "live" ? "rgba(139,92,246,0.1)" : "transparent",
            }}
            aria-pressed={activeTab === "live"}
            data-testid="litt-mobile-tab-live"
          >
            <Activity size={12} className="pointer-events-none" />
            Live
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-md transition hover:bg-white/10"
            style={{ color: "var(--text-muted)" }}
            aria-label="Close LiTT"
            data-testid="litt-mobile-sheet-close"
          >
            <X size={16} className="pointer-events-none" />
          </button>
        </div>

        <div
          ref={contentRef}
          className="relative min-h-0 flex-1 overflow-hidden overscroll-contain"
          data-testid="litt-mobile-sheet-content"
        >
          <div
            className="absolute inset-0 flex min-w-0 flex-col overflow-hidden"
            style={{
              visibility: activeTab === "chat" ? "visible" : "hidden",
              pointerEvents: activeTab === "chat" ? "auto" : "none",
            }}
            data-active={activeTab === "chat"}
            data-testid="litt-mobile-chat-panel"
          >
            {chatContent}
          </div>
          <div
            className="absolute inset-0 flex min-w-0 flex-col overflow-hidden"
            style={{
              visibility: activeTab === "live" ? "visible" : "hidden",
              pointerEvents: activeTab === "live" ? "auto" : "none",
            }}
            data-active={activeTab === "live"}
            data-testid="litt-mobile-live-panel"
          >
            {liveContent}
          </div>
        </div>
      </div>
    </>
  );
}
