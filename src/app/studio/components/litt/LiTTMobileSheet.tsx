"use client";

/**
 * LiTTMobileSheet — mobile (<1024px) access to LiTT.
 *
 * Phase C2.1: mobile previously had NO way to reach LiTT (the desktop
 * rail is `hidden` below `lg`, and the earlier collapsed HUD had no
 * mobile-hide rule, so mobile could show a stray 64px rail). This is a
 * minimal, real fix — not the full Phase I mobile redesign.
 *
 * Reuses the exact same chatContent/liveContent the desktop LiTTPanel
 * uses. Only mounted while the sheet is open, so there is never a
 * second CommandComposer / LiTTLiveActivity instance alongside the
 * desktop rail — the desktop rail simply isn't rendered on this tier.
 */

import type { ReactNode } from "react";
import { MessageSquare, Activity, X } from "lucide-react";
import type { LiTTTab } from "../LiTTPanel";

export interface LiTTMobileSheetProps {
  activeTab: LiTTTab;
  onTabChange: (tab: LiTTTab) => void;
  onClose: () => void;
  chatContent: ReactNode;
  liveContent: ReactNode;
}

export default function LiTTMobileSheet({
  activeTab,
  onTabChange,
  onClose,
  chatContent,
  liveContent,
}: LiTTMobileSheetProps) {
  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[10020] bg-black/55"
        onClick={onClose}
        aria-label="Close LiTT"
        tabIndex={-1}
      />
      <div
        className="fixed inset-x-0 bottom-0 z-[10021] flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl border-t"
        style={{
          backgroundColor: "var(--studio-surface)",
          borderColor: "var(--studio-border)",
          paddingBottom: "env(safe-area-inset-bottom)",
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
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all"
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
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all"
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
            className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-white/10"
            style={{ color: "var(--text-muted)" }}
            aria-label="Close LiTT"
            data-testid="litt-mobile-sheet-close"
          >
            <X size={14} className="pointer-events-none" />
          </button>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className="absolute inset-0 flex flex-col overflow-hidden"
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
            className="absolute inset-0 flex flex-col overflow-hidden"
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
