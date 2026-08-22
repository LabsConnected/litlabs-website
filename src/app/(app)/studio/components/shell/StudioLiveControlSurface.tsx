"use client";

import { type ReactNode, useState, useEffect, useCallback, useRef } from "react";
import { studioColors, studioSpacing, studioTypography, studioRadius, studioMotion } from "@/lib/studio/design-tokens";
import { StudioButton } from "../primitives/StudioButton";
import { StudioStatus } from "../primitives/StudioStatus";
import { StudioEmptyState } from "../primitives/StudioEmptyState";
import { StudioSkeleton } from "../primitives/StudioSkeleton";

/* ─────────────────────────────────────────────────────────────────
 * StudioLiveControlSurface — LiTT Live Browser Control.
 *
 * The difference between this and Playwright testing:
 * - Playwright testing = automated tests verify Studio
 * - LiTT using browser automation as a tool = LiTT can operate the site
 *
 * This surface lets you WATCH LiTT operate the browser:
 * - Real browser viewport inside Studio
 * - DOM inspection
 * - click/type/scroll/navigation
 * - screenshot capture
 * - visual verification
 * - console/network errors
 * - terminal control
 * - file/code editing
 * - preview refresh/reload
 * - tool activity streamed into Activity
 * - ability to stop LiTT immediately
 * - PLAN vs ACT enforcement
 * - approvals for dangerous actions
 * - full audit/evidence trail
 *
 * Phase 10.9 — LiTT Live Control Surface
 * ───────────────────────────────────────────────────────────────── */

// ─── Types ───────────────────────────────────────────────────────

export interface BrowserAction {
  id: string;
  type: "navigate" | "click" | "type" | "scroll" | "screenshot" | "snapshot" | "inspect" | "refresh" | "console" | "network";
  summary: string;
  status: "running" | "success" | "failed";
  timestamp: number;
  durationMs?: number;
  screenshotUrl?: string;
  error?: string;
}

export interface BrowserState {
  sessionId: string | null;
  status: "disconnected" | "connecting" | "connected" | "human_control" | "error";
  url: string | null;
  title: string | null;
  screenshotUrl: string | null;
  consoleErrors: string[];
  networkErrors: string[];
}

interface StudioLiveControlSurfaceProps {
  /** Browser state from the session manager */
  browserState: BrowserState;
  /** Streamed browser actions */
  actions: BrowserAction[];
  /** Whether LiTT is currently acting */
  isActing: boolean;
  /** Whether we're in PLAN or ACT mode */
  mode: "PLAN" | "ACT";
  /** Whether there's a pending approval */
  pendingApproval?: { toolId: string; reason: string } | null;
  /** Callbacks */
  onNavigate?: (url: string) => void;
  onRefresh?: () => void;
  onScreenshot?: () => void;
  onStop?: () => void;
  onTakeControl?: () => void;
  onReturnControl?: () => void;
  loading?: boolean;
}

// ─── Action Item ─────────────────────────────────────────────────

function actionIcon(type: BrowserAction["type"]): string {
  switch (type) {
    case "navigate": return "→";
    case "click": return "⊙";
    case "type": return "⌨";
    case "scroll": return "↕";
    case "screenshot": return "📷";
    case "snapshot": return "📋";
    case "inspect": return "🔍";
    case "refresh": return "↻";
    case "console": return "⚠";
    case "network": return "🌐";
    default: return "•";
  }
}

function actionTone(action: BrowserAction): "idle" | "info" | "success" | "warning" | "error" | "violet" {
  if (action.status === "failed") return "error";
  if (action.status === "running") return "info";
  if (action.type === "console" || action.type === "network") return "warning";
  return "success";
}

function ActionItem({ action }: { action: BrowserAction }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: studioSpacing[4],
        padding: `${studioSpacing[4]} ${studioSpacing[6]}`,
        borderRadius: studioRadius.md,
        background: studioColors.card,
        border: `1px solid ${studioColors.borderNeutral}`,
      }}
      data-testid={`browser-action-${action.id}`}
    >
      <span style={{ fontSize: studioTypography.md, flexShrink: 0 }}>
        {actionIcon(action.type)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: studioSpacing[4],
        }}>
          <span style={{
            fontSize: studioTypography.md,
            color: action.status === "failed" ? studioColors.red :
                   action.status === "running" ? studioColors.blue :
                   studioColors.textPrimary,
          }}>
            {action.summary}
          </span>
          {action.status === "running" && (
            <span style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              border: `2px solid ${studioColors.blue}`,
              borderTopColor: "transparent",
              animation: "studio-spin 0.6s linear infinite",
              flexShrink: 0,
            }} />
          )}
          {action.status === "success" && (
            <span style={{ color: studioColors.green, fontSize: studioTypography.sm }}>✓</span>
          )}
          {action.status === "failed" && (
            <span style={{ color: studioColors.red, fontSize: studioTypography.sm }}>✗</span>
          )}
        </div>
        {action.error && (
          <div style={{
            marginTop: studioSpacing[2],
            fontSize: studioTypography.sm,
            color: studioColors.red,
          }}>
            {action.error}
          </div>
        )}
        {action.screenshotUrl && (
          <div style={{
            marginTop: studioSpacing[4],
            borderRadius: studioRadius.md,
            overflow: "hidden",
            border: `1px solid ${studioColors.borderNeutral}`,
          }}>
            <img
              src={action.screenshotUrl}
              alt="Screenshot"
              style={{ display: "block", width: "100%", height: "auto" }}
              data-testid={`browser-action-screenshot-${action.id}`}
            />
          </div>
        )}
        <div style={{
          marginTop: studioSpacing[2],
          fontSize: studioTypography.xs,
          color: studioColors.textMuted,
        }}>
          {new Date(action.timestamp).toLocaleTimeString("en-US", { hour12: false })}
          {action.durationMs !== undefined && ` · ${(action.durationMs / 1000).toFixed(1)}s`}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function StudioLiveControlSurface({
  browserState,
  actions,
  isActing,
  mode,
  pendingApproval,
  onNavigate,
  onRefresh,
  onScreenshot,
  onStop,
  onTakeControl,
  onReturnControl,
  loading,
}: StudioLiveControlSurfaceProps) {
  const [urlInput, setUrlInput] = useState("");
  const actionsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest action
  useEffect(() => {
    if (actionsEndRef.current && typeof actionsEndRef.current.scrollIntoView === "function") {
      actionsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [actions.length]);

  const handleNavigate = useCallback(() => {
    if (urlInput && onNavigate) {
      onNavigate(urlInput);
    }
  }, [urlInput, onNavigate]);

  if (loading) {
    return (
      <div style={{ padding: studioSpacing[8], display: "flex", flexDirection: "column", gap: studioSpacing[4] }}>
        <StudioSkeleton height={200} />
        <SkeletonText />
      </div>
    );
  }

  // Disconnected state
  if (browserState.status === "disconnected") {
    return (
      <StudioEmptyState
        title="Browser not connected"
        description="When LiTT starts working, the browser viewport will appear here. You'll be able to watch it navigate, click, type, and verify in real-time."
        testId="live-control-disconnected"
      />
    );
  }

  const isConnected = browserState.status === "connected" || browserState.status === "human_control";
  const isHumanControl = browserState.status === "human_control";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: studioColors.canvas,
      }}
      data-testid="studio-live-control-surface"
    >
      {/* ── Toolbar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: studioSpacing[4],
          padding: `${studioSpacing[4]} ${studioSpacing[6]}`,
          borderBottom: `1px solid ${studioColors.borderNeutral}`,
          background: studioColors.shell,
          flexShrink: 0,
        }}
      >
        {/* URL bar */}
        <input
          type="text"
          value={urlInput || browserState.url || ""}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleNavigate()}
          placeholder="Enter URL or let LiTT navigate"
          disabled={!isConnected || isHumanControl}
          style={{
            flex: 1,
            padding: `${studioSpacing[2]} ${studioSpacing[4]}`,
            background: studioColors.surface,
            border: `1px solid ${studioColors.borderNeutral}`,
            borderRadius: studioRadius.md,
            color: studioColors.textPrimary,
            fontSize: studioTypography.sm,
            fontFamily: studioTypography.mono,
            outline: "none",
            opacity: (!isConnected || isHumanControl) ? 0.5 : 1,
          }}
          data-testid="live-control-url-input"
        />

        {/* Refresh */}
        {onRefresh && (
          <StudioButton
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={!isConnected || isHumanControl}
            data-testid="live-control-refresh"
          >
            ↻
          </StudioButton>
        )}

        {/* Screenshot */}
        {onScreenshot && (
          <StudioButton
            variant="ghost"
            size="sm"
            onClick={onScreenshot}
            disabled={!isConnected || isHumanControl}
            data-testid="live-control-screenshot"
          >
            📷
          </StudioButton>
        )}

        {/* Mode badge */}
        <StudioStatus
          tone={mode === "ACT" ? "violet" : "idle"}
          label={mode}
          size="sm"
          dot={false}
        />

        {/* Stop button */}
        {isActing && onStop && (
          <StudioButton
            variant="danger"
            size="sm"
            onClick={onStop}
            data-testid="live-control-stop"
          >
            ■ Stop
          </StudioButton>
        )}

        {/* Human control toggle */}
        {isConnected && isHumanControl && onReturnControl && (
          <StudioButton
            variant="primary"
            size="sm"
            onClick={onReturnControl}
            data-testid="live-control-return-control"
          >
            Return Control to LiTT
          </StudioButton>
        )}
        {isConnected && !isHumanControl && onTakeControl && (
          <StudioButton
            variant="secondary"
            size="sm"
            onClick={onTakeControl}
            data-testid="live-control-take-control"
          >
            Take Control
          </StudioButton>
        )}
      </div>

      {/* ── Pending approval ── */}
      {pendingApproval && (
        <div
          style={{
            padding: `${studioSpacing[6]} ${studioSpacing[8]}`,
            background: studioColors.amberSoft,
            borderBottom: `1px solid rgba(251, 178, 68, 0.25)`,
            color: studioColors.amber,
            fontSize: studioTypography.md,
            display: "flex",
            alignItems: "center",
            gap: studioSpacing[4],
          }}
          data-testid="live-control-pending-approval"
        >
          <span>⏸</span>
          <span>Approval required: {pendingApproval.reason}</span>
        </div>
      )}

      {/* ── Browser viewport ── */}
      {browserState.screenshotUrl && (
        <div
          style={{
            flex: 1,
            minHeight: 200,
            overflow: "hidden",
            borderBottom: `1px solid ${studioColors.borderNeutral}`,
            position: "relative",
            background: studioColors.canvas,
          }}
          data-testid="live-control-viewport"
        >
          <img
            src={browserState.screenshotUrl}
            alt="Browser viewport"
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
            data-testid="live-control-viewport-screenshot"
          />
          {isActing && (
            <div
              style={{
                position: "absolute",
                top: studioSpacing[4],
                right: studioSpacing[4],
                display: "flex",
                alignItems: "center",
                gap: studioSpacing[2],
                padding: `${studioSpacing[2]} ${studioSpacing[4]}`,
                borderRadius: studioRadius.full,
                background: "rgba(155, 77, 255, 0.2)",
                color: studioColors.violet,
                fontSize: studioTypography.xs,
                fontWeight: 600,
              }}
            >
              <span style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: studioColors.violet,
                animation: `studio-spin ${studioMotion.normal} linear infinite`,
              }} />
              LiTT is operating
            </div>
          )}
        </div>
      )}

      {/* ── Console/network errors ── */}
      {(browserState.consoleErrors.length > 0 || browserState.networkErrors.length > 0) && (
        <div
          style={{
            padding: studioSpacing[6],
            background: studioColors.shell,
            borderBottom: `1px solid ${studioColors.borderNeutral}`,
            maxHeight: 120,
            overflow: "auto",
          }}
          data-testid="live-control-errors"
        >
          {browserState.consoleErrors.map((err, i) => (
            <div
              key={`console-${i}`}
              style={{
                fontSize: studioTypography.xs,
                color: studioColors.red,
                fontFamily: studioTypography.mono,
                padding: `${studioSpacing[1]} 0`,
              }}
            >
              ⚠ {err}
            </div>
          ))}
          {browserState.networkErrors.map((err, i) => (
            <div
              key={`network-${i}`}
              style={{
                fontSize: studioTypography.xs,
                color: studioColors.amber,
                fontFamily: studioTypography.mono,
                padding: `${studioSpacing[1]} 0`,
              }}
            >
              🌐 {err}
            </div>
          ))}
        </div>
      )}

      {/* ── Action stream ── */}
      <div
        style={{
          flex: browserState.screenshotUrl ? undefined : 1,
          maxHeight: 300,
          overflow: "auto",
          padding: studioSpacing[6],
          display: "flex",
          flexDirection: "column",
          gap: studioSpacing[2],
        }}
        data-testid="live-control-actions"
      >
        {actions.length === 0 && !isActing && (
          <div style={{
            fontSize: studioTypography.sm,
            color: studioColors.textMuted,
            textAlign: "center",
            padding: studioSpacing[12],
          }}>
            No browser actions yet. LiTT's browser activity will stream here.
          </div>
        )}
        {actions.map((action) => (
          <ActionItem key={action.id} action={action} />
        ))}
        <div ref={actionsEndRef} />
      </div>
    </div>
  );
}

function SkeletonText() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: studioSpacing[2] }}>
      <StudioSkeleton height={12} width="60%" />
      <StudioSkeleton height={12} width="40%" />
    </div>
  );
}
