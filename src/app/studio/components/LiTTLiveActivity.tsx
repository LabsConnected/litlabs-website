"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  GitBranch,
  Edit3,
  Shield,
  Circle,
  PanelRightClose,
  AlertTriangle,
  RotateCcw,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";
import {
  useExecutionStore,
  type ExecutionEvent,
  type ExecutionPhase,
} from "../stores/useExecutionStore";

/* ─────────────────────────────────────────────────────────────────
 * LiTTLiveActivity — right-side panel showing real agent execution.
 *
 * Consumes useExecutionStore, which is fed by real SSE events from
 * the agent loop. No fabricated activity. Shows the full lifecycle:
 *   Planning → Inspecting → Reading → Editing → Running → Testing
 *   → Verifying → Complete/Failed
 *
 * Activity rows are actionable: clicking a file opens Code, clicking
 * a diff opens Changes, clicking a check opens its output.
 * ───────────────────────────────────────────────────────────────── */

interface LiTTLiveActivityProps {
  onClose?: () => void;
  /** Called when a file is clicked — should open Code view with that file. */
  onOpenFile?: (filePath: string) => void;
  /** Called when a diff is clicked — should open Changes/diff view. */
  onOpenDiff?: (diff: string) => void;
  /** Called when a check output is clicked — should open terminal/check output. */
  onOpenCheck?: (checkId: string, output?: string) => void;
  /** Called when terminal should open. */
  onOpenTerminal?: () => void;
  /** Called when an approval should be resolved. */
  onResolveApproval?: (decision: "approved" | "rejected") => void;
  /** Called when the user clicks Stop while LiTT is running. */
  onStop?: () => void;
  /** Called when the user clicks Rollback to the last checkpoint. */
  onRollback?: () => void;
}

const PHASE_CONFIG: Record<ExecutionPhase, { label: string; icon: typeof Activity; color: string }> = {
  idle: { label: "Idle", icon: Circle, color: "var(--text-muted)" },
  planning: { label: "Planning", icon: Activity, color: "var(--spark-primary)" },
  inspecting: { label: "Inspecting", icon: Eye, color: "var(--spark-primary)" },
  editing: { label: "Editing", icon: Edit3, color: "var(--litt-primary)" },
  testing: { label: "Testing", icon: CheckCircle2, color: "#e3b341" },
  verifying: { label: "Verifying", icon: Shield, color: "var(--litt-primary)" },
  done: { label: "Complete", icon: CheckCircle2, color: "var(--litt-primary)" },
  cancelled: { label: "Cancelled", icon: XCircle, color: "var(--error)" },
  awaiting_approval: { label: "Approval needed", icon: AlertTriangle, color: "#e3b341" },
};

export default function LiTTLiveActivity({
  onClose,
  onOpenFile,
  onOpenDiff,
  onOpenCheck,
  onOpenTerminal,
  onResolveApproval,
  onStop,
  onRollback,
}: LiTTLiveActivityProps) {
  const events = useExecutionStore((s) => s.events);
  const phase = useExecutionStore((s) => s.phase);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const pendingApproval = useExecutionStore((s) => s.pendingApproval);
  const checkpoint = useExecutionStore((s) => s.checkpoint);
  const changesSummary = useExecutionStore((s) => s.changesSummary);
  const collapseEvent = useExecutionStore((s) => s.collapseEvent);
  const collapseLowLevel = useExecutionStore((s) => s.collapseLowLevel);
  const clearEvents = useExecutionStore((s) => s.clearEvents);

  const [elapsed, setElapsed] = useState(0);
  const [hideLowLevel, setHideLowLevel] = useState(false);
  const [collapsedAll, setCollapsedAll] = useState(false);

  // Track elapsed time while running
  useEffect(() => {
    if (!isRunning) return;
    const startTs = events[0]?.ts ?? Date.now();
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTs);
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning, events]);

  // Auto-collapse low-level ops when run finishes
  useEffect(() => {
    if (!isRunning && events.length > 0) {
      collapseLowLevel();
    }
  }, [isRunning, events.length, collapseLowLevel]);

  const visibleEvents = useMemo(() => {
    let list = events;
    if (hideLowLevel) list = list.filter((e) => !e.lowLevel);
    if (collapsedAll) list = list.map((e) => ({ ...e, collapsed: true }));
    return list;
  }, [events, hideLowLevel, collapsedAll]);

  const phaseCfg = PHASE_CONFIG[phase] ?? PHASE_CONFIG.idle;
  const PhaseIcon = phaseCfg.icon;

  // Group consecutive tool operations for cleaner display
  const completedSteps = events.filter(
    (e) => e.type === "tool_result" || e.type === "tool_error" || e.type === "build_result",
  ).length;
  const failedSteps = events.filter(
    (e) => e.type === "tool_error" || (e.type === "build_result" && e.success === false),
  ).length;

  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden border-l"
      style={{
        width: "var(--studio-rail-w, 340px)",
        maxWidth: "85vw",
        backgroundColor: "var(--studio-surface)",
        borderLeft: "1px solid var(--studio-border)",
        backdropFilter: "blur(12px)",
      }}
      data-testid="litt-live-activity"
    >
      {/* ── Header ── */}
      <div
        className="flex shrink-0 items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--studio-border)" }}
      >
        <div className="flex items-center gap-2">
          <div className="relative">
            <PhaseIcon
              size={14}
              style={{ color: phaseCfg.color }}
              className={`pointer-events-none ${isRunning ? "animate-pulse" : ""}`}
            />
            {isRunning && (
              <span
                className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: phaseCfg.color, boxShadow: `0 0 4px ${phaseCfg.color}` }}
                aria-hidden
              />
            )}
          </div>
          <span
            className="text-[10px] font-black uppercase tracking-[0.18em]"
            style={{ color: "var(--text-secondary)" }}
          >
            LiTT Live
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span
              className="text-[9px] font-bold tabular-nums"
              style={{ color: "var(--text-muted)" }}
            >
              {(elapsed / 1000).toFixed(1)}s
            </span>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-md hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
              aria-label="Hide LiTT Live Activity"
              title="Hide panel"
              data-testid="litt-live-close"
            >
              <PanelRightClose size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Status Bar ── */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
        style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}
      >
        <span
          className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-bold"
          style={{
            color: phaseCfg.color,
            borderColor: `${phaseCfg.color}40`,
            backgroundColor: `${phaseCfg.color}10`,
          }}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${isRunning ? "animate-pulse" : ""}`}
            style={{ backgroundColor: phaseCfg.color, boxShadow: `0 0 4px ${phaseCfg.color}` }}
            aria-hidden
          />
          {phaseCfg.label}
        </span>
        {completedSteps > 0 && (
          <span
            className="text-[9px] font-bold"
            style={{ color: "var(--text-muted)" }}
          >
            {completedSteps} step{completedSteps !== 1 ? "s" : ""}
            {failedSteps > 0 && (
              <span style={{ color: "var(--error)" }}> · {failedSteps} failed</span>
            )}
          </span>
        )}
        {changesSummary && (changesSummary.modified + changesSummary.added + changesSummary.deleted) > 0 && (
          <span
            className="ml-auto flex items-center gap-1 text-[9px] font-bold"
            style={{ color: "var(--litt-primary)" }}
          >
            <Edit3 size={9} className="pointer-events-none" />
            {changesSummary.modified + changesSummary.added + changesSummary.deleted} change{(changesSummary.modified + changesSummary.added + changesSummary.deleted) !== 1 ? "s" : ""}
          </span>
        )}
        {/* Stop control — visible while LiTT is running */}
        {isRunning && onStop && (
          <button
            type="button"
            onClick={onStop}
            className="ml-auto flex items-center gap-1 rounded-md border px-2 py-0.5 text-[9px] font-bold transition hover:bg-white/10"
            style={{
              borderColor: "var(--error)40",
              backgroundColor: "var(--error)10",
              color: "var(--error)",
            }}
            aria-label="Stop LiTT"
            title="Stop execution"
            data-testid="litt-live-stop"
          >
            <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: "var(--error)" }} aria-hidden />
            Stop
          </button>
        )}
        {/* Rollback control — visible when a checkpoint exists and not running */}
        {!isRunning && checkpoint && onRollback && (
          <button
            type="button"
            onClick={onRollback}
            className="ml-auto flex items-center gap-1 rounded-md border px-2 py-0.5 text-[9px] font-bold transition hover:bg-white/10"
            style={{
              borderColor: "var(--studio-border-strong)",
              backgroundColor: "var(--studio-card)",
              color: "var(--text-secondary)",
            }}
            aria-label="Rollback to checkpoint"
            title={`Rollback to ${checkpoint.label}`}
            data-testid="litt-live-rollback"
          >
            <RotateCcw size={9} className="pointer-events-none" />
            Rollback
          </button>
        )}
      </div>

      {/* ── Scrollable Activity Feed ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 studio-scroll">
        {events.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-1 pb-1">
              <ToolButton
                icon={Trash2}
                label="Clear"
                title="Clear activity"
                onClick={clearEvents}
              />
              <ToolButton
                icon={collapsedAll ? ChevronDown : ChevronRight}
                label="Collapse"
                title="Collapse all"
                active={collapsedAll}
                onClick={() => setCollapsedAll((v) => !v)}
              />
              <ToolButton
                icon={hideLowLevel ? Eye : EyeOff}
                label={hideLowLevel ? "Show all" : "Hide noise"}
                title="Toggle low-level operations"
                active={hideLowLevel}
                onClick={() => setHideLowLevel((v) => !v)}
              />
            </div>

            {/* Pending Approval Card */}
            {pendingApproval && (
              <ApprovalCard
                approval={pendingApproval}
                onResolve={onResolveApproval}
              />
            )}

            {/* Checkpoint Banner */}
            {checkpoint && (
              <CheckpointBanner checkpoint={checkpoint} />
            )}

            {/* Activity Timeline */}
            <div className="flex flex-col gap-0.5">
              {visibleEvents.map((evt) => (
                <ActivityRow
                  key={evt.id}
                  event={evt}
                  onToggleCollapse={() => collapseEvent(evt.id)}
                  onOpenFile={onOpenFile}
                  onOpenDiff={onOpenDiff}
                  onOpenCheck={onOpenCheck}
                  onOpenTerminal={onOpenTerminal}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

/* ── Empty State ────────────────────────────────────────────────── */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div
        className="grid h-10 w-10 place-items-center rounded-full"
        style={{ backgroundColor: "var(--studio-border)" }}
      >
        <Activity size={18} style={{ color: "var(--text-muted)" }} className="pointer-events-none" />
      </div>
      <div className="text-[11px] font-bold" style={{ color: "var(--text-secondary)" }}>
        No activity yet
      </div>
      <div className="text-[9px] leading-tight" style={{ color: "var(--text-muted)" }}>
        Send a message to LiTT.<br />Real execution events will appear here.
      </div>
    </div>
  );
}

/* ── Approval Card ──────────────────────────────────────────────── */
function ApprovalCard({
  approval,
  onResolve,
}: {
  approval: { toolId: string; reason: string; pausedRunId?: string };
  onResolve?: (decision: "approved" | "rejected") => void;
}) {
  return (
    <div
      className="rounded-xl border p-2.5"
      style={{
        borderColor: "#e3b34140",
        backgroundColor: "#e3b34108",
      }}
    >
      <div className="flex items-center gap-2 pb-1.5">
        <AlertTriangle size={14} style={{ color: "#e3b341" }} className="pointer-events-none shrink-0" />
        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: "#e3b341" }}>
          Approval Required
        </span>
      </div>
      <div className="text-[10px] leading-tight pb-2" style={{ color: "var(--text-secondary)" }}>
        <span className="font-bold">{approval.toolId.replace(/_/g, " ")}</span>
        <div className="pt-0.5" style={{ color: "var(--text-muted)" }}>{approval.reason}</div>
      </div>
      {onResolve && (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onResolve("approved")}
            className="flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold transition hover:bg-white/10"
            style={{
              borderColor: "var(--litt-primary)40",
              backgroundColor: "var(--litt-primary)10",
              color: "var(--litt-primary)",
            }}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => onResolve("rejected")}
            className="flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold transition hover:bg-white/10"
            style={{
              borderColor: "var(--error)40",
              backgroundColor: "var(--error)10",
              color: "var(--error)",
            }}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Checkpoint Banner ──────────────────────────────────────────── */
function CheckpointBanner({
  checkpoint,
}: {
  checkpoint: { label: string; gitSha: string };
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
      style={{
        borderColor: "var(--litt-primary)30",
        backgroundColor: "var(--litt-primary)06",
      }}
    >
      <GitBranch size={12} style={{ color: "var(--litt-primary)" }} className="pointer-events-none shrink-0" />
      <span className="text-[10px] font-bold" style={{ color: "var(--litt-primary)" }}>
        {checkpoint.label}
      </span>
      <span
        className="ml-auto rounded px-1.5 py-0.5 text-[8px] font-mono font-bold"
        style={{ color: "var(--text-muted)", backgroundColor: "var(--studio-border)" }}
      >
        {checkpoint.gitSha.slice(0, 7)}
      </span>
    </div>
  );
}

/* ── Activity Row ───────────────────────────────────────────────── */
function ActivityRow({
  event,
  onToggleCollapse,
  onOpenFile,
  onOpenDiff,
  onOpenCheck,
  onOpenTerminal,
}: {
  event: ExecutionEvent;
  onToggleCollapse: () => void;
  onOpenFile?: (filePath: string) => void;
  onOpenDiff?: (diff: string) => void;
  onOpenCheck?: (checkId: string, output?: string) => void;
  onOpenTerminal?: () => void;
}) {
  const cfg = getEventConfig(event);
  const Icon = cfg.icon;
  const timeStr = useMemo(() => {
    const d = new Date(event.ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }, [event.ts]);

  const hasDetails = (event.diff || event.filePath || event.check) && !event.collapsed;
  const isClickable = !!(
    (event.filePath && onOpenFile) ||
    (event.diff && onOpenDiff) ||
    (event.check && onOpenCheck)
  );

  return (
    <div
      className={`group flex items-start gap-2 rounded-md px-1.5 py-1 transition hover:bg-white/5 ${event.collapsed ? "opacity-60" : ""}`}
    >
      <span className="relative mt-0.5 shrink-0">
        <Icon
          size={12}
          strokeWidth={2}
          style={{ color: cfg.color }}
          className={`pointer-events-none ${cfg.spin ? "animate-spin" : ""}`}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={() => {
              if (event.filePath && onOpenFile) onOpenFile(event.filePath);
              else if (event.diff && onOpenDiff) onOpenDiff(event.diff);
              else if (event.check && onOpenCheck) onOpenCheck(event.check);
              else if (event.type === "tool_start" && event.toolId === "run_project_checks" && onOpenTerminal) onOpenTerminal();
              else onToggleCollapse();
            }}
            disabled={!isClickable && !event.collapsed && !hasDetails}
            className={`min-w-0 flex-1 text-left ${isClickable ? "cursor-pointer hover:underline" : "cursor-default"}`}
            title={isClickable ? `Open ${event.filePath ?? event.check ?? "details"}` : undefined}
          >
            <span
              className="text-[10px] font-bold truncate"
              style={{ color: "var(--text-primary)" }}
            >
              {event.summary}
            </span>
          </button>
          <div className="flex items-center gap-1 shrink-0">
            {event.durationMs !== undefined && (
              <span className="text-[8px] font-medium tabular-nums" style={{ color: "var(--text-muted)" }}>
                {(event.durationMs / 1000).toFixed(1)}s
              </span>
            )}
            <span className="text-[8px] font-medium" style={{ color: "var(--text-muted)" }}>
              {timeStr}
            </span>
          </div>
        </div>
        {hasDetails && (
          <div className="text-[9px] leading-tight pt-0.5" style={{ color: "var(--text-muted)" }}>
            {event.filePath && (
              <span className="font-mono">{event.filePath}</span>
            )}
            {event.check && (
              <span>{event.success === false ? `${event.errorCount ?? 0} error${(event.errorCount ?? 0) !== 1 ? "s" : ""}` : "Passed"}</span>
            )}
            {event.diff && (
              <button
                type="button"
                onClick={() => onOpenDiff?.(event.diff!)}
                className="font-bold hover:underline"
                style={{ color: "var(--litt-primary)" }}
              >
                View diff →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Event Config ───────────────────────────────────────────────── */
function getEventConfig(event: ExecutionEvent): {
  icon: typeof Activity;
  color: string;
  spin?: boolean;
} {
  switch (event.type) {
    case "phase":
      return { icon: Activity, color: "var(--spark-primary)", spin: event.phase === "planning" || event.phase === "inspecting" };
    case "tool_start":
      return { icon: Loader2, color: "var(--spark-primary)", spin: true };
    case "tool_result":
      return { icon: CheckCircle2, color: event.success ? "var(--litt-primary)" : "var(--error)" };
    case "tool_error":
      return { icon: XCircle, color: "var(--error)" };
    case "checkpoint":
      return { icon: GitBranch, color: "var(--litt-primary)" };
    case "build_start":
      return { icon: Loader2, color: "#e3b341", spin: true };
    case "build_result":
      return { icon: event.success ? CheckCircle2 : XCircle, color: event.success ? "var(--litt-primary)" : "var(--error)" };
    case "approval_required":
      return { icon: AlertTriangle, color: "#e3b341" };
    case "approval_resolved":
      return { icon: event.success ? CheckCircle2 : XCircle, color: event.success ? "var(--litt-primary)" : "var(--error)" };
    case "finished":
      return { icon: CheckCircle2, color: "var(--litt-primary)" };
    case "cancelled":
      return { icon: XCircle, color: "var(--error)" };
    case "reasoning":
      return { icon: Circle, color: "var(--text-muted)" };
    case "status":
      return { icon: Activity, color: "var(--text-secondary)" };
    case "model_routing":
      return { icon: GitBranch, color: event.fallbackFrom ? "#e3b341" : "var(--text-secondary)" };
    case "model_failed":
      return { icon: XCircle, color: "var(--error)" };
    case "repair_attempt":
      return { icon: RotateCcw, color: "#e3b341", spin: true };
    default:
      return { icon: Circle, color: "var(--text-muted)" };
  }
}

/* ── Tool Button ────────────────────────────────────────────────── */
function ToolButton({
  icon: Icon,
  label,
  title,
  active,
  onClick,
}: {
  icon: typeof Activity;
  label?: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className="flex items-center gap-1 rounded-md border px-1.5 py-1 text-[9px] font-bold transition hover:bg-white/8"
      style={{
        borderColor: active ? "rgba(114,242,56,0.35)" : "var(--studio-border)",
        backgroundColor: active ? "rgba(114,242,56,0.08)" : "transparent",
        color: active ? "var(--litt-primary)" : "var(--text-secondary)",
      }}
    >
      <Icon size={11} className="pointer-events-none" />
      {label && <span>{label}</span>}
    </button>
  );
}
