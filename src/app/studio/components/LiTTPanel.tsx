"use client";

import { useState, useCallback, type ReactNode } from "react";
import { MessageSquare, Activity, PanelRightClose } from "lucide-react";

type LiTTTab = "chat" | "live";

interface LiTTPanelProps {
  /** Chat tab content — transcript + composer */
  chatContent: ReactNode;
  /** Live tab content — execution activity (LiTTLiveActivity) */
  liveContent: ReactNode;
  /** Called when the panel should close */
  onClose?: () => void;
  /** Initial active tab */
  initialTab?: LiTTTab;
}

/**
 * LiTT right panel — one agent, two views.
 *
 * Chat: conversation transcript + composer
 * Live: real-time execution telemetry (tool calls, diffs, checks, approvals)
 *
 * Both tabs share the same conversation/execution state instances
 * (passed in as content from the parent), so switching never drops
 * SSE connections or unsent drafts.
 */
export default function LiTTPanel({
  chatContent,
  liveContent,
  onClose,
  initialTab = "chat",
}: LiTTPanelProps) {
  const [activeTab, setActiveTab] = useState<LiTTTab>(initialTab);

  const handleTabChange = useCallback((tab: LiTTTab) => {
    setActiveTab(tab);
  }, []);

  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden border-l"
      style={{
        width: "var(--studio-rail-w, 360px)",
        maxWidth: "85vw",
        backgroundColor: "var(--studio-surface)",
        borderLeft: "1px solid var(--studio-border)",
        backdropFilter: "blur(12px)",
      }}
      data-testid="litt-panel"
    >
      {/* Tab header */}
      <div
        className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1.5"
        style={{
          borderColor: "var(--studio-border)",
          backgroundColor: "rgba(13,9,22,0.6)",
        }}
      >
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
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-white/10"
            style={{ color: "var(--text-muted)" }}
            aria-label="Close LiTT panel"
            data-testid="litt-panel-close"
          >
            <PanelRightClose size={14} className="pointer-events-none" />
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
