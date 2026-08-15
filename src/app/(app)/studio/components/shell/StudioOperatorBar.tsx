"use client";

/**
 * StudioOperatorBar — shared bottom execution/status bar.
 *
 * Uses REAL execution state from useExecutionStore.
 * No fake progress, no fake ETA, no fake cost.
 *
 * Actions reuse existing handlers passed from CommandStudio.
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
  Terminal,
  RotateCcw,
  X,
} from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import { useExecutionStore, type ExecutionPhase } from "../../stores/useExecutionStore";

const PHASE_META: Record<ExecutionPhase, { label: string; icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: CSSProperties }>; color: string }> = {
  idle: { label: "Idle", icon: Circle, color: "var(--text-muted)" },
  planning: { label: "Planning", icon: Activity, color: "var(--spark-primary)" },
  inspecting: { label: "Inspecting", icon: Eye, color: "var(--spark-primary)" },
  editing: { label: "Editing", icon: Edit3, color: "var(--litt-primary)" },
  testing: { label: "Testing", icon: CheckCircle2, color: "#e3b341" },
  verifying: { label: "Verifying", icon: Shield, color: "var(--litt-primary)" },
  done: { label: "Complete", icon: CheckCircle2, color: "var(--litt-primary)" },
  cancelled: { label: "Cancelled", icon: XCircle, color: "var(--error)" },
  awaiting_approval: { label: "Waiting for approval", icon: AlertTriangle, color: "#e3b341" },
};

export interface StudioOperatorBarProps {
  onOpenTerminal?: () => void;
  onOpenActivity?: () => void;
  onRollback?: () => void;
  onStop?: () => void;
  onResolveApproval?: (decision: "approved" | "rejected") => void;
  terminalStatus?: string;
  modelLabel?: string;
}

export default function StudioOperatorBar({
  onOpenTerminal,
  onOpenActivity,
  onRollback,
  onStop,
  onResolveApproval,
  terminalStatus,
  modelLabel,
}: StudioOperatorBarProps) {
  const phase = useExecutionStore((s) => s.phase);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const pendingApproval = useExecutionStore((s) => s.pendingApproval);
  const checkpoint = useExecutionStore((s) => s.checkpoint);
  const changesSummary = useExecutionStore((s) => s.changesSummary);

  const meta = PHASE_META[phase] ?? PHASE_META.idle;
  const PhaseIcon = meta.icon;

  const fileCount = changesSummary
    ? changesSummary.added + changesSummary.modified + changesSummary.deleted
    : 0;

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-2 border-t px-3 text-[11px]"
      style={{
        backgroundColor: "rgba(8,6,14,0.92)",
        borderColor: "var(--studio-border)",
        color: "var(--text-muted)",
        backdropFilter: "blur(8px)",
      }}
      data-testid="studio-operator-bar"
      role="status"
      aria-label="Operator status"
    >
      {/* Phase indicator */}
      <div className="flex items-center gap-1.5">
        <PhaseIcon
          size={12}
          strokeWidth={2}
          className="pointer-events-none"
          style={{ color: meta.color }}
        />
        <span
          className="font-bold"
          style={{ color: meta.color }}
        >
          Operator
        </span>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <span style={{ color: meta.color }}>{meta.label}</span>
      </div>

      {/* File changes (only when real data exists) */}
      {fileCount > 0 && (
        <span className="hidden sm:inline" style={{ color: "var(--text-muted)" }}>
          · {fileCount} file{fileCount === 1 ? "" : "s"}
        </span>
      )}

      {/* Terminal status */}
      {terminalStatus && (
        <span className="hidden md:inline" style={{ color: "var(--text-muted)" }}>
          · Terminal: {terminalStatus}
        </span>
      )}

      {/* Model */}
      {modelLabel && (
        <span className="hidden lg:inline" style={{ color: "var(--text-muted)" }}>
          · {modelLabel}
        </span>
      )}

      {/* Checkpoint indicator */}
      {checkpoint?.gitSha && (
        <span className="hidden lg:inline font-mono" style={{ color: "var(--text-muted)" }}>
          · {checkpoint.gitSha.slice(0, 8)}
        </span>
      )}

      <div className="flex-1" />

      {/* Running pulse — no fake percentage */}
      {isRunning && (
        <span
          className="flex items-center gap-1"
          style={{ color: "var(--spark-primary)" }}
          aria-label="Run in progress"
        >
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full"
            style={{ backgroundColor: "var(--spark-primary)" }}
            aria-hidden
          />
          <span className="hidden sm:inline">Running</span>
        </span>
      )}

      {/* Approval actions */}
      {pendingApproval && onResolveApproval && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onResolveApproval("approved")}
            className="rounded px-2 py-0.5 text-[10px] font-bold transition hover:bg-white/10"
            style={{
              backgroundColor: "rgba(114,242,56,0.1)",
              color: "var(--litt-primary)",
              border: "1px solid rgba(114,242,56,0.2)",
            }}
            aria-label="Approve"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => onResolveApproval("rejected")}
            className="rounded px-2 py-0.5 text-[10px] font-bold transition hover:bg-white/10"
            style={{
              backgroundColor: "rgba(239,68,68,0.1)",
              color: "var(--error)",
              border: "1px solid rgba(239,68,68,0.2)",
            }}
            aria-label="Reject"
          >
            Reject
          </button>
        </div>
      )}

      {/* Action buttons — only when handlers exist */}
      <div className="flex items-center gap-0.5">
        {isRunning && onStop && (
          <button
            type="button"
            onClick={onStop}
            className="grid h-5 w-5 place-items-center rounded transition hover:bg-white/10"
            style={{ color: "var(--text-muted)" }}
            aria-label="Stop run"
            title="Stop"
          >
            <X size={11} className="pointer-events-none" />
          </button>
        )}
        {onOpenActivity && (
          <button
            type="button"
            onClick={onOpenActivity}
            className="grid h-5 w-5 place-items-center rounded transition hover:bg-white/10"
            style={{ color: "var(--text-muted)" }}
            aria-label="View activity"
            title="Activity"
          >
            <Activity size={11} className="pointer-events-none" />
          </button>
        )}
        {onOpenTerminal && (
          <button
            type="button"
            onClick={onOpenTerminal}
            className="grid h-5 w-5 place-items-center rounded transition hover:bg-white/10"
            style={{ color: "var(--text-muted)" }}
            aria-label="Open terminal"
            title="Terminal"
          >
            <Terminal size={11} className="pointer-events-none" />
          </button>
        )}
        {checkpoint?.gitSha && onRollback && !isRunning && (
          <button
            type="button"
            onClick={onRollback}
            className="grid h-5 w-5 place-items-center rounded transition hover:bg-white/10"
            style={{ color: "var(--text-muted)" }}
            aria-label="Rollback to checkpoint"
            title="Rollback"
          >
            <RotateCcw size={11} className="pointer-events-none" />
          </button>
        )}
      </div>
    </div>
  );
}
