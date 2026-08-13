"use client";

/**
 * LiTTAmbientHUD — collapsed-state chrome for the LiTT panel.
 *
 * Pure presentational content — no state, no width/border of its own.
 * The parent (LiTTPanel) owns the 64px width and border so the LiTT
 * panel can stay a single mounted element across collapse/expand
 * (Phase C2.1 — no unmount/remount on collapse).
 *
 * Shows truthful state using existing stores:
 * - LiTT mark/head
 * - Phase indicator
 * - Running pulse
 * - Approval indicator
 * - Microphone indicator — reflects the REAL device status, never
 *   inferred from "is a live session active" alone.
 *
 * No raw reasoning. No second runtime status system.
 */

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Eye,
  Edit3,
  Shield,
  XCircle,
  PanelRightOpen,
  Mic,
  MicOff,
} from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import { useExecutionStore, type ExecutionPhase } from "../../stores/useExecutionStore";
import type { DeviceStatus } from "@/lib/litt/live/types";

const PHASE_ICON: Record<ExecutionPhase, ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: CSSProperties }>> = {
  idle: Circle,
  planning: Activity,
  inspecting: Eye,
  editing: Edit3,
  testing: CheckCircle2,
  verifying: Shield,
  done: CheckCircle2,
  cancelled: XCircle,
  awaiting_approval: AlertTriangle,
};

const PHASE_COLOR: Record<ExecutionPhase, string> = {
  idle: "var(--text-muted)",
  planning: "var(--spark-primary)",
  inspecting: "var(--spark-primary)",
  editing: "var(--litt-primary)",
  testing: "#e3b341",
  verifying: "var(--litt-primary)",
  done: "var(--litt-primary)",
  cancelled: "var(--error)",
  awaiting_approval: "#e3b341",
};

export interface LiTTAmbientHUDProps {
  onExpand: () => void;
  /** Whether a Live voice/vision session is connected at all */
  voiceConnected?: boolean;
  /**
   * REAL microphone device status from the realtime session's
   * indicators (e.g. `liveSession.indicators.microphone`). Only
   * "active" renders as mic-on — every other status (inactive, muted,
   * denied, error) renders as mic-off. Do not derive this from
   * `isLive` alone; a live session does not guarantee an active mic.
   */
  microphoneStatus?: DeviceStatus;
}

export default function LiTTAmbientHUD({
  onExpand,
  voiceConnected,
  microphoneStatus,
}: LiTTAmbientHUDProps) {
  const phase = useExecutionStore((s) => s.phase);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const pendingApproval = useExecutionStore((s) => s.pendingApproval);

  const PhaseIcon = PHASE_ICON[phase] ?? Circle;
  const phaseColor = PHASE_COLOR[phase] ?? "var(--text-muted)";
  const micOn = microphoneStatus === "active";

  return (
    <div
      className="flex h-full w-16 shrink-0 flex-col items-center gap-2 py-3"
      data-testid="litt-ambient-hud"
    >
      {/* LiTT mark — expand button */}
      <button
        type="button"
        onClick={onExpand}
        className="group flex h-10 w-10 items-center justify-center rounded-xl transition-all hover:bg-white/5"
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(139,92,246,0.12), transparent 70%)",
        }}
        aria-label="Expand LiTT panel"
        title="Expand LiTT"
        data-testid="litt-hud-expand"
      >
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{
            background: "linear-gradient(135deg, rgba(139,92,246,0.2), rgba(99,102,241,0.1))",
            border: "1px solid rgba(139,92,246,0.2)",
          }}
        >
          <span
            className="text-[10px] font-black"
            style={{ color: "var(--litt-primary)" }}
          >
            L
          </span>
        </div>
      </button>

      {/* Phase indicator */}
      <div
        className="flex h-8 w-8 items-center justify-center rounded-lg"
        style={{
          backgroundColor: "rgba(255,255,255,0.03)",
          border: `1px solid ${phaseColor}22`,
        }}
        title={phase}
        aria-label={`Phase: ${phase}`}
      >
        <PhaseIcon
          size={14}
          strokeWidth={2}
          className="pointer-events-none"
          style={{ color: phaseColor }}
        />
      </div>

      {/* Running pulse */}
      {isRunning && (
        <div
          className="h-1.5 w-1.5 animate-pulse rounded-full"
          style={{ backgroundColor: "var(--spark-primary)" }}
          aria-label="Run in progress"
          aria-hidden
        />
      )}

      {/* Approval indicator */}
      {pendingApproval && (
        <div
          className="flex h-6 w-6 items-center justify-center rounded-md"
          style={{
            backgroundColor: "rgba(227,179,65,0.1)",
            border: "1px solid rgba(227,179,65,0.25)",
          }}
          title="Approval waiting"
          aria-label="Approval waiting"
        >
          <AlertTriangle
            size={11}
            strokeWidth={2}
            className="pointer-events-none"
            style={{ color: "#e3b341" }}
          />
        </div>
      )}

      {/* Voice/mic indicator — only shown while a Live session is
          connected, and only ever reports mic-on when the real device
          status is "active". */}
      {voiceConnected && (
        <div
          className="flex h-6 w-6 items-center justify-center rounded-md"
          style={{
            backgroundColor: micOn ? "rgba(114,242,56,0.08)" : "rgba(255,255,255,0.03)",
          }}
          title={micOn ? "Microphone on" : "Microphone off"}
          aria-label={micOn ? "Microphone on" : "Microphone off"}
          data-testid="litt-hud-mic-indicator"
          data-mic-on={micOn}
        >
          {micOn ? (
            <Mic size={11} strokeWidth={2} className="pointer-events-none" style={{ color: "var(--litt-primary)" }} />
          ) : (
            <MicOff size={11} strokeWidth={2} className="pointer-events-none" style={{ color: "var(--text-muted)" }} />
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* Expand button at bottom */}
      <button
        type="button"
        onClick={onExpand}
        className="grid h-7 w-7 place-items-center rounded-md transition hover:bg-white/10"
        style={{ color: "var(--text-muted)" }}
        aria-label="Expand LiTT panel"
        title="Expand LiTT"
      >
        <PanelRightOpen size={13} className="pointer-events-none" />
      </button>
    </div>
  );
}
