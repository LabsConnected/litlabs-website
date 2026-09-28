"use client";

/**
 * LiTT panel — left side of the Ultra Vision shell, desktop/laptop tier
 * (lg breakpoint and up). One agent, two views: Chat | Activity.
 *
 * Chat: conversation transcript + composer
 * Activity: real-time execution telemetry (tool calls, diffs, checks, approvals)
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
 * F1 (SLICE B) — overlay mode: `overlay` turns the panel into a floating
 * surface (fixed position, right side, elevated shadow, close button)
 * instead of a layout column. When closed (collapsed) in overlay mode the
 * whole panel hides with display:none — content stays mounted so SSE,
 * scroll, and drafts survive (the proven pattern). The overlay renders NO
 * composer: the persistent bottom CommandComposer is the single command
 * surface, and chatContent/liveContent are parent-provided transcript slots,
 * so there is never a duplicate composer.
 *
 * Active tab is fully controlled by the parent (CommandStudio) — this
 * component owns no tab state of its own, so header actions, collapse/
 * expand, and the panel's own tab buttons always agree on what's active.
 */

import type { ReactNode } from "react";
import { MessageSquare, Activity, PanelLeftClose, X } from "lucide-react";
import { BrandLogo } from "@/components/branding/BrandLogo";
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
  /** Collapsed (64px ambient HUD) vs expanded (resizable) */
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  /**
   * F1 overlay mode (SLICE B): render as a floating panel (fixed, right
   * side, elevated shadow, close button) instead of a layout column.
   * Closed overlay panels hide with display:none (content stays mounted).
   * No composer is rendered in overlay mode — the bottom command bar owns it.
   */
  overlay?: boolean;
  /** Truthful voice/mic state for the collapsed HUD */
  voiceConnected?: boolean;
  microphoneStatus?: DeviceStatus;
  /** Expanded width in pixels (controlled by parent via useResizableWidth) */
  expandedWidth?: number;
}

export default function LiTTPanel({
  chatContent,
  liveContent,
  activeTab,
  onTabChange,
  collapsed,
  onCollapse,
  onExpand,
  overlay = false,
  voiceConnected,
  microphoneStatus,
  expandedWidth = 320,
}: LiTTPanelProps) {
  return (
    <aside
      className={
        overlay
          ? "fixed z-[70] flex flex-col overflow-hidden rounded-2xl border"
          : "hidden h-full shrink-0 flex-col overflow-hidden border-r transition-[width] duration-150 ease-out lg:flex"
      }
      style={
        overlay
          ? {
              // Floating panel: pinned right, clears the header above and
              // the persistent bottom command bar below. Clamped so it
              // always fits a 390px viewport.
              display: collapsed ? "none" : "flex",
              top: 64,
              right: 12,
              bottom: 104,
              width: `min(${expandedWidth}px, calc(100vw - 24px))`,
              backgroundColor: "#0d0916",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow:
                "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(168,255,47,0.08), 0 8px 32px rgba(0,0,0,0.5)",
            }
          : {
              width: collapsed ? 64 : `clamp(300px, ${expandedWidth}px, min(640px, 26vw))`,
              minWidth: collapsed ? 64 : 280,
              maxWidth: collapsed ? 64 : "36vw",
              backgroundColor: "#0d0916",
              borderRight: "1px solid rgba(255,255,255,0.07)",
              backdropFilter: "blur(12px)",
            }
      }
      data-testid="litt-panel"
      data-collapsed={collapsed}
      data-overlay={overlay}
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
            borderColor: "rgba(255,255,255,0.07)",
            backgroundColor: "rgba(24,18,38,0.96)",
          }}
        >
          {/* LiTT identity mark — canonical brand logo (F1 brand consolidation).
              No invented "L" tiles. */}
          <span className="mr-0.5 shrink-0" aria-hidden data-testid="litt-panel-brand">
            <BrandLogo showText={false} size={22} variant="mark" />
          </span>
          <button
            type="button"
            onClick={() => onTabChange("chat")}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-bold transition-all"
            style={{
              color: activeTab === "chat" ? "var(--color-accent)" : "var(--text-muted)",
              backgroundColor: activeTab === "chat" ? "color-mix(in srgb, var(--color-accent) 10%, transparent)" : "transparent",
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
              color: activeTab === "live" ? "var(--color-accent)" : "var(--text-muted)",
              backgroundColor: activeTab === "live" ? "color-mix(in srgb, var(--color-accent) 10%, transparent)" : "transparent",
            }}
            aria-pressed={activeTab === "live"}
            data-testid="litt-tab-live"
          >
            <Activity size={12} className="pointer-events-none" />
            Activity
          </button>
          <div className="flex-1" />
          {overlay ? (
            <button
              type="button"
              onClick={onCollapse}
              className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
              aria-label="Close LiTT panel"
              data-testid="litt-panel-close"
              title="Close"
            >
              <X size={14} className="pointer-events-none" />
            </button>
          ) : (
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
          )}
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
