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
import { mobileDiag } from "../../lib/mobileDiagnostics";
import type { LiTTTab } from "../LiTTPanel";

export interface LiTTMobileSheetProps {
  activeTab: LiTTTab;
  onTabChange: (tab: LiTTTab) => void;
  onClose: () => void;
  chatContent: ReactNode;
  liveContent: ReactNode;
  /** Optional approval UI rendered full-width at the top of the sheet, above the tabs */
  approvalSlot?: ReactNode;
}

const MOBILE_BOTTOM_NAV_H = 62;

export default function LiTTMobileSheet({
  activeTab,
  onTabChange,
  onClose,
  chatContent,
  liveContent,
  approvalSlot,
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
  const MIN_SHEET_HEIGHT = 150;
  // Full-screen sheet: spans from the top of the viewport down to the
  // bottom offset (mobile nav + safe area + keyboard inset), so it still
  // stays pinned above the on-screen keyboard.
  const rawSheetHeight = Math.round(vv.height) + bottomInset - bottomOffset;
  // Never let the sheet render at (near-)0px — a bad viewport reading
  // should degrade to "small but usable", not "invisible/unusable".
  const sheetHeight = Math.max(MIN_SHEET_HEIGHT, rawSheetHeight);

  const loggedDegenerateRef = useRef(false);
  useEffect(() => {
    const degenerate = rawSheetHeight < MIN_SHEET_HEIGHT;
    if (degenerate && !loggedDegenerateRef.current) {
      loggedDegenerateRef.current = true;
      mobileDiag("viewport", "degenerate_sheet_height", {
        vvHeight: Math.round(vv.height),
        vvWidth: Math.round(vv.width),
        rawSheetHeight,
      });
    } else if (!degenerate) {
      loggedDegenerateRef.current = false;
    }
  }, [rawSheetHeight, vv.height, vv.width]);

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
        className="fixed inset-x-0 top-0 z-[10021] flex min-h-0 min-w-0 flex-col overflow-hidden border-t"
        style={{
          top: "0px",
          height: `${sheetHeight}px`,
          backgroundColor: "#0d0916",
          borderColor: "rgba(255,255,255,0.07)",
        }}
        data-testid="litt-mobile-sheet"
        role="dialog"
        aria-label="LiTT assistant"
        aria-modal="true"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/20" aria-hidden />

        {approvalSlot && (
          <div className="w-full shrink-0" data-testid="litt-mobile-approval-slot">
            {approvalSlot}
          </div>
        )}

        <div
          className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1.5"
          style={{
            borderColor: "rgba(255,255,255,0.07)",
            backgroundColor: "rgba(24,18,38,0.96)",
          }}
        >
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
            style={{
              background: "linear-gradient(135deg, rgba(34,211,238,0.2), rgba(34,211,238,0.08))",
              border: "1px solid rgba(255,255,255,0.13)",
            }}
            aria-hidden
          >
            <span className="text-[9px] font-black" style={{ color: "#22d3ee" }}>L</span>
          </div>
          <button
            type="button"
            onClick={() => onTabChange("chat")}
            className="flex min-h-10 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all"
            style={{
              color: activeTab === "chat" ? "#22d3ee" : "var(--text-muted)",
              backgroundColor: activeTab === "chat" ? "rgba(34,211,238,0.1)" : "transparent",
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
              color: activeTab === "live" ? "#22d3ee" : "var(--text-muted)",
              backgroundColor: activeTab === "live" ? "rgba(34,211,238,0.1)" : "transparent",
            }}
            aria-pressed={activeTab === "live"}
            data-testid="litt-mobile-tab-live"
          >
            <Activity size={12} className="pointer-events-none" />
            Activity
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
