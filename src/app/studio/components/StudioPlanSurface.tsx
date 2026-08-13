"use client";

/**
 * StudioPlanSurface — the canonical "Plan" workspace stage.
 *
 * This is project intelligence, NOT another chat screen. It surfaces
 * real data from existing stores/hooks:
 *   - useConnectionSummary  → project, repo, branch, workspace status
 *   - useExecutionStore     → phase, run status, approvals, checkpoints, changes
 *   - useStudioAgentStore   → active agent, execution mode
 *   - useConversationStore  → conversation count, last message
 *
 * No fabricated data. Empty states where fields are unavailable.
 * Actions reuse existing handlers passed from CommandStudio.
 */

import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  Eye,
  Edit3,
  FolderOpen,
  GitBranch,
  GitCommit,
  Hammer,
  Layout,
  Play,
  RotateCcw,
  Shield,
  Terminal,
  XCircle,
  Zap,
} from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import type { ConnectionCapabilities } from "../hooks/useConnectionSummary";
import { useExecutionStore, type ExecutionPhase } from "../stores/useExecutionStore";
import { useStudioAgentStore, AGENT_META } from "../stores/useStudioAgentStore";
import { useConversationStore } from "../stores/useConversationStore";

/* ── Phase config (mirrors LiTTLiveActivity) ──────────────────── */

const PHASE_CONFIG: Record<ExecutionPhase, { label: string; icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: CSSProperties }>; color: string }> = {
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

/* ── Props ─────────────────────────────────────────────────────── */

export interface StudioPlanSurfaceProps {
  capabilities: ConnectionCapabilities;
  modelLabel: string;
  onOpenCode: () => void;
  onOpenCanvas: () => void;
  onOpenPreview: () => void;
  onOpenTerminal: () => void;
  onOpenActivity: () => void;
  onOpenFiles: () => void;
  onRollback: () => void;
}

/* ── Sub-components ────────────────────────────────────────────── */

function PlanCard({
  title,
  icon: Icon,
  children,
  accent,
}: {
  title: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: CSSProperties }>;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div
      className="glass-panel rounded-xl border p-4"
      style={{
        borderColor: "var(--studio-border)",
        backgroundColor: "var(--studio-card)",
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Icon size={15} strokeWidth={2} className="pointer-events-none" style={{ color: accent ?? "var(--text-secondary)" }} />
        <span
          className="text-[10px] font-black uppercase tracking-[0.12em]"
          style={{ color: "var(--text-secondary)" }}
        >
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function PlanRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (value === null || value === undefined || value === "") {
    return (
      <div className="flex items-center justify-between py-1">
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{label}</span>
        <span className="text-[12px] italic" style={{ color: "var(--text-muted)" }}>—</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>{label}</span>
      <span
        className={`text-[12px] font-semibold ${mono ? "font-mono" : ""}`}
        style={{ color: "var(--text-main)" }}
      >
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: CSSProperties }>;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10"
      style={{
        backgroundColor: "rgba(155,77,255,0.06)",
        border: "1px solid var(--studio-border)",
        color: "var(--text-main)",
      }}
      aria-label={label}
    >
      <Icon size={13} strokeWidth={2} className="pointer-events-none" />
      {label}
    </button>
  );
}

/* ── Main component ────────────────────────────────────────────── */

export default function StudioPlanSurface({
  capabilities,
  modelLabel,
  onOpenCode,
  onOpenCanvas,
  onOpenPreview,
  onOpenTerminal,
  onOpenActivity,
  onOpenFiles,
  onRollback,
}: StudioPlanSurfaceProps) {
  const events = useExecutionStore((s) => s.events);
  const phase = useExecutionStore((s) => s.phase);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const pendingApproval = useExecutionStore((s) => s.pendingApproval);
  const checkpoint = useExecutionStore((s) => s.checkpoint);
  const changesSummary = useExecutionStore((s) => s.changesSummary);
  const toolCalls = useExecutionStore((s) => s.toolCalls);

  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const executionMode = useStudioAgentStore((s) => s.executionMode);

  const conversations = useConversationStore((s) => s.conversations);
  const selectedConversationId = useConversationStore((s) => s.selectedConversationId);

  const agentMeta = AGENT_META[activeAgentId];
  const phaseCfg = PHASE_CONFIG[phase] ?? PHASE_CONFIG.idle;
  const PhaseIcon = phaseCfg.icon;

  const recentEvents = useMemo(() => events.slice(-6).reverse(), [events]);
  const activeConversation = conversations.find((c) => c.id === selectedConversationId);

  const hasProject = Boolean(capabilities.projectId);
  const hasCheckpoint = Boolean(checkpoint?.gitSha);

  /* ── No project state ──────────────────────────────────────── */
  if (!hasProject) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center overflow-y-auto studio-scroll"
        data-testid="studio-plan-surface"
      >
        <div
          className="glass-panel rounded-2xl border p-8 text-center"
          style={{
            borderColor: "var(--studio-border)",
            backgroundColor: "var(--studio-card)",
            maxWidth: 420,
          }}
        >
          <FolderOpen size={32} strokeWidth={1.5} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
          <h2 className="text-[15px] font-black" style={{ color: "var(--text-main)" }}>
            No active project
          </h2>
          <p className="mt-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
            Select or create a project to see plan intelligence, run status, checkpoints, and recommendations.
          </p>
        </div>
      </div>
    );
  }

  /* ── Main render ────────────────────────────────────────────── */
  return (
    <div
      className="h-full overflow-y-auto studio-scroll p-4"
      data-testid="studio-plan-surface"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3">

        {/* ── Project header ──────────────────────────────────── */}
        <PlanCard title="Project" icon={FolderOpen}>
          <div className="grid grid-cols-2 gap-x-6">
            <PlanRow label="Name" value={capabilities.projectName} />
            <PlanRow label="Source" value={capabilities.sourceType ?? undefined} />
            <PlanRow label="Repository" value={capabilities.repositoryName} mono />
            <PlanRow label="Branch" value={capabilities.activeBranch ?? capabilities.defaultBranch} mono />
            <PlanRow label="Workspace" value={capabilities.workspaceStatus ?? undefined} />
            <PlanRow label="Write access" value={capabilities.writeAccess ? "Allowed" : "Requires approval"} />
          </div>
        </PlanCard>

        {/* ── Run status ──────────────────────────────────────── */}
        <PlanCard title="Run Status" icon={PhaseIcon} accent={phaseCfg.color}>
          <div className="flex items-center gap-3 py-1">
            <PhaseIcon size={20} strokeWidth={2} style={{ color: phaseCfg.color }} />
            <div className="flex-1">
              <div className="text-[14px] font-black" style={{ color: phaseCfg.color }}>
                {phaseCfg.label}
              </div>
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {isRunning ? `Step ${toolCalls.length + 1} in progress` : "Not running"}
              </div>
            </div>
            {pendingApproval && (
              <div
                className="rounded-lg px-2.5 py-1 text-[11px] font-bold"
                style={{
                  backgroundColor: "rgba(227,179,65,0.12)",
                  color: "#e3b341",
                  border: "1px solid rgba(227,179,65,0.25)",
                }}
              >
                Approval waiting
              </div>
            )}
          </div>

          {/* Changes summary */}
          {changesSummary && (changesSummary.added > 0 || changesSummary.modified > 0 || changesSummary.deleted > 0) && (
            <div className="mt-2 flex gap-3 border-t pt-2" style={{ borderColor: "var(--studio-border)" }}>
              <span className="text-[11px]" style={{ color: "var(--litt-primary)" }}>
                +{changesSummary.added} added
              </span>
              <span className="text-[11px]" style={{ color: "#e3b341" }}>
                ~{changesSummary.modified} modified
              </span>
              <span className="text-[11px]" style={{ color: "var(--error)" }}>
                -{changesSummary.deleted} deleted
              </span>
            </div>
          )}
        </PlanCard>

        {/* ── Agent & execution mode ──────────────────────────── */}
        <PlanCard title="Agent" icon={Zap}>
          <div className="grid grid-cols-2 gap-x-6">
            <PlanRow label="Active agent" value={agentMeta?.displayName ?? activeAgentId} />
            <PlanRow label="Execution mode" value={executionMode.toUpperCase()} />
            <PlanRow label="Model" value={modelLabel} />
            <PlanRow label="Conversation" value={activeConversation?.title ?? (selectedConversationId ? "Untitled" : undefined)} />
          </div>
        </PlanCard>

        {/* ── Checkpoint ──────────────────────────────────────── */}
        <PlanCard title="Checkpoint" icon={GitCommit}>
          {hasCheckpoint ? (
            <div className="flex items-center justify-between py-1">
              <div>
                <div className="text-[13px] font-bold" style={{ color: "var(--text-main)" }}>
                  {checkpoint!.label}
                </div>
                <div className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {checkpoint!.gitSha.slice(0, 12)}
                </div>
              </div>
              <ActionButton
                label="Restore"
                icon={RotateCcw}
                onClick={onRollback}
                disabled={isRunning}
              />
            </div>
          ) : (
            <div className="py-1 text-[12px] italic" style={{ color: "var(--text-muted)" }}>
              No checkpoint recorded for this session.
            </div>
          )}
        </PlanCard>

        {/* ── Recent activity ──────────────────────────────────── */}
        <PlanCard title="Recent Activity" icon={Activity}>
          {recentEvents.length === 0 ? (
            <div className="py-1 text-[12px] italic" style={{ color: "var(--text-muted)" }}>
              No activity yet. Start a task from LiTT chat.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {recentEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="flex items-start gap-2 rounded-md px-2 py-1.5"
                  style={{ backgroundColor: "rgba(255,255,255,0.02)" }}
                >
                  <div className="mt-0.5 shrink-0">
                    {evt.type === "tool_result" && evt.success && <CheckCircle2 size={12} style={{ color: "var(--litt-primary)" }} />}
                    {evt.type === "tool_error" && <XCircle size={12} style={{ color: "var(--error)" }} />}
                    {evt.type === "checkpoint" && <GitCommit size={12} style={{ color: "var(--spark-primary)" }} />}
                    {evt.type === "approval_required" && <AlertTriangle size={12} style={{ color: "#e3b341" }} />}
                    {evt.type === "phase" && <Activity size={12} style={{ color: "var(--spark-primary)" }} />}
                    {evt.type === "finished" && <CheckCircle2 size={12} style={{ color: "var(--litt-primary)" }} />}
                    {evt.type === "cancelled" && <XCircle size={12} style={{ color: "var(--error)" }} />}
                    {(evt.type === "tool_start" || evt.type === "build_start" || evt.type === "reasoning" || evt.type === "status" || evt.type === "model_routing" || evt.type === "model_failed" || evt.type === "repair_attempt" || evt.type === "approval_resolved") && (
                      <Clock3 size={12} style={{ color: "var(--text-muted)" }} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px]" style={{ color: "var(--text-main)" }}>
                      {evt.summary}
                    </div>
                    {evt.durationMs != null && (
                      <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {(evt.durationMs / 1000).toFixed(1)}s
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </PlanCard>

        {/* ── Actions ──────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 pt-1">
          <ActionButton label="Open Code" icon={Hammer} onClick={onOpenCode} />
          <ActionButton label="Open Canvas" icon={Layout} onClick={onOpenCanvas} />
          <ActionButton label="Open Preview" icon={Play} onClick={onOpenPreview} />
          <ActionButton label="Open Files" icon={FolderOpen} onClick={onOpenFiles} />
          <ActionButton label="Open Terminal" icon={Terminal} onClick={onOpenTerminal} />
          <ActionButton label="View Activity" icon={Activity} onClick={onOpenActivity} />
        </div>
      </div>
    </div>
  );
}
