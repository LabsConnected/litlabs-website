"use client";

/**
 * LiTT panel — left side of the Ultra Vision shell, desktop/laptop tier
 * (lg breakpoint and up). One agent, two views: Chat | Live.
 *
 * Chat: conversation transcript + composer
 * Live: real-time execution telemetry (tool calls, diffs, checks, approvals)
 *
 * Both tabs share the same conversation/execution state instances
 * (passed in as content from the parent), so switching never drops
 * SSE connections or unsent drafts.
 *
 * Phase C2.1 — this is now a SINGLE persistent container across
 * collapse/expand. Collapsing does not unmount chatContent/liveContent;
 * it hides them (display:none) while the width shrinks to 64px and the
 * ambient HUD chrome is shown instead. This preserves scroll position,
 * in-flight requests, and any composer-local UI state across toggles.
 *
 * Active tab is fully controlled by the parent (CommandStudio) — this
 * component owns no tab state of its own, so header actions, collapse/
 * expand, and the panel's own tab buttons always agree on what's active.
 */

import type { ReactNode } from "react";
import { MessageSquare, Activity, PanelLeftClose } from "lucide-react";
import LiTTAmbientHUD from "./litt/LiTTAmbientHUD";
import type { DeviceStatus } from "@/lib/litt/live/types";

export type LiTTTab = "chat" | "live";

interface LiTTPanelProps {
  /** Chat tab content — transcript + composer */
  chatContent: ReactNode;
  /** Live tab content — execution activity (LiTTLiveActivity) */
  liveContent: ReactNode;
  /** Controlled active tab */
  activeTab: LiTTTab;
  onTabChange: (tab: LiTTTab) => void;
  /** Collapsed (64px ambient HUD) vs expanded (320px) */
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  /** Truthful voice/mic state for the collapsed HUD */
  voiceConnected?: boolean;
  microphoneStatus?: DeviceStatus;
}

export default function LiTTPanel({
  chatContent,
  liveContent,
  activeTab,
  onTabChange,
  collapsed,
  onCollapse,
  onExpand,
  voiceConnected,
  microphoneStatus,
}: LiTTPanelProps) {
  return (
    <aside
      className="hidden h-full shrink-0 flex-col overflow-hidden border-r transition-[width] duration-150 ease-out lg:flex"
      style={{
        width: collapsed ? 64 : 320,
        maxWidth: collapsed ? 64 : "30vw",
        backgroundColor: "var(--studio-surface)",
        borderRight: "1px solid var(--studio-border)",
        backdropFilter: "blur(12px)",
      }}
      data-testid="litt-panel"
      data-collapsed={collapsed}
      aria-label="LiTT assistant panel"
    >
      {/* Collapsed chrome — always mounted, shown only while collapsed.
          Kept as a sibling (not a ternary branch) so toggling collapse
          never unmounts the expanded chrome/content below. */}
      <div style={{ display: collapsed ? "flex" : "none" }} className="h-full min-h-0 flex-1 flex-col" data-testid="litt-panel-collapsed-chrome">
        <LiTTAmbientHUD
          onExpand={onExpand}
          voiceConnected={voiceConnected}
          microphoneStatus={microphoneStatus}
        />
      </div>

      {/* Expanded chrome + content — always mounted, hidden (not
          unmounted) while collapsed. This is what preserves scroll
          position, in-flight requests, and composer-local UI state
          across collapse/expand (Phase C2.1). */}
      <div style={{ display: collapsed ? "none" : "flex" }} className="h-full min-h-0 flex-1 flex-col overflow-hidden" data-testid="litt-panel-expanded-chrome">
        {/* Tab header */}
        <div
          className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1.5"
          style={{
            borderColor: "var(--studio-border)",
            backgroundColor: "rgba(13,9,22,0.6)",
          }}
        >
          {/* LiTT identity mark */}
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
            style={{
              background: "linear-gradient(135deg, rgba(139,92,246,0.2), rgba(99,102,241,0.1))",
              border: "1px solid rgba(139,92,246,0.2)",
            }}
            aria-hidden
          >
            <span
              className="text-[9px] font-black"
              style={{ color: "var(--litt-primary)" }}
            >
              L
            </span>
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
            data-testid="litt-tab-chat"
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
            data-testid="litt-tab-live"
          >
            <Activity size={12} className="pointer-events-none" />
            Live
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCollapse}
            className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-white/10"
            style={{ color: "var(--text-muted)" }}
            aria-label="Collapse LiTT panel"
            data-testid="litt-panel-collapse"
            title="Collapse"
          >
            <PanelLeftClose size={14} className="pointer-events-none" />
          </button>
        </div>

        {/* Tab panels — grid-stacked for zero layout shift.
            Both panels stay mounted so SSE state, scroll position,
            and unsent composer drafts survive tab switches. */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className="absolute inset-0 flex flex-col overflow-hidden"
            style={{
              visibility: activeTab === "chat" ? "visible" : "hidden",
              pointerEvents: activeTab === "chat" ? "auto" : "none",
            }}
            data-active={activeTab === "chat"}
            data-testid="litt-chat-panel"
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
            data-testid="litt-live-panel"
          >
            {liveContent}
          </div>
        </div>
      </div>
    </aside>
  );
}
