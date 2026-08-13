"use client";

/**
 * LiTT panel — left side of the Ultra Vision shell.
 *
 * One agent, two views: Chat | Live.
 *
 * Chat: conversation transcript + composer
 * Live: real-time execution telemetry (tool calls, diffs, checks, approvals)
 *
 * Both tabs share the same conversation/execution state instances
 * (passed in as content from the parent), so switching never drops
 * SSE connections or unsent drafts.
 *
 * Phase C2: moved from right to left. Now always visible with
 * expand/collapse support. When collapsed, the parent renders
 * LiTTAmbientHUD instead.
 */

import { useState, useCallback, useEffect, type ReactNode } from "react";
import { MessageSquare, Activity, PanelLeftClose } from "lucide-react";

type LiTTTab = "chat" | "live";

interface LiTTPanelProps {
  /** Chat tab content — transcript + composer */
  chatContent: ReactNode;
  /** Live tab content — execution activity (LiTTLiveActivity) */
  liveContent: ReactNode;
  /** Called when the panel should collapse (not close — LiTT is always present) */
  onCollapse?: () => void;
  /** Called when the panel should close completely (legacy/mobile) */
  onClose?: () => void;
  /** Initial active tab */
  initialTab?: LiTTTab;
  /** External tab preference — when changed, switches the active tab */
  preferredTab?: LiTTTab;
}

export default function LiTTPanel({
  chatContent,
  liveContent,
  onCollapse,
  onClose,
  initialTab = "chat",
  preferredTab,
}: LiTTPanelProps) {
  const [activeTab, setActiveTab] = useState<LiTTTab>(initialTab);

  // External tab preference — switches tab without unmounting content
  useEffect(() => {
    if (preferredTab) setActiveTab(preferredTab);
  }, [preferredTab]);

  const handleTabChange = useCallback((tab: LiTTTab) => {
    setActiveTab(tab);
  }, []);

  return (
    <aside
      className="hidden h-full shrink-0 flex-col overflow-hidden border-r md:flex"
      style={{
        width: 320,
        maxWidth: "30vw",
        backgroundColor: "var(--studio-surface)",
        borderRight: "1px solid var(--studio-border)",
        backdropFilter: "blur(12px)",
      }}
      data-testid="litt-panel"
      aria-label="LiTT assistant panel"
    >
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
          onClick={() => handleTabChange("chat")}
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
          onClick={() => handleTabChange("live")}
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
        {onCollapse && (
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
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-white/10 md:hidden"
            style={{ color: "var(--text-muted)" }}
            aria-label="Close LiTT panel"
            data-testid="litt-panel-close"
          >
            ✕
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
    </aside>
  );
}
