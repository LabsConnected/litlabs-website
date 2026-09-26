"use client";

/**
 * MissionCards — compact operational state at the top of the Activity panel.
 *
 * Folds the "Plan" workspace tab into three collapsible cards:
 *   1. Mission     — live plan summary (agent, mode, model, phase, changes)
 *   2. Checkpoints — latest checkpoint with the rollback action
 *   3. Next actions — contextual hints + quick-action buttons
 *
 * All data comes from the same sources as StudioPlanSurface
 * (useExecutionStore, useStudioAgentStore, describeSourceRows).
 * No fabricated data — empty states where fields are unavailable.
 */

import { useState } from "react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FolderOpen,
  GitCommit,
  Hammer,
  Layout,
  Play,
  RotateCcw,
  Rocket,
  Terminal,
} from "lucide-react";
import type { ConnectionCapabilities } from "../hooks/useConnectionSummary";
import { describeSourceRows } from "../lib/source-rows";
import { useExecutionStore, type ExecutionPhase } from "../stores/useExecutionStore";
import { useStudioAgentStore, AGENT_META } from "../stores/useStudioAgentStore";

export interface MissionCardsProps {
  capabilities: ConnectionCapabilities;
  modelLabel: string;
  onOpenCode: () => void;
  onOpenCanvas: () => void;
  onOpenPreview: () => void;
  onOpenTerminal: () => void;
  onOpenActivity: () => void;
  onOpenFiles: () => void;
  onRollback: () => void;
  /**
   * When false, the "Next actions" card is omitted and the contextual hints
   * render above the mission card instead. Used on mobile where the actions
   * live in the Tools sheet. Defaults to true (desktop unchanged).
   */
  showActions?: boolean;
}

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: CSSProperties }>;

/* ── Design tokens (literals) ──────────────────────────────────── */

const CARD_SURFACE = "rgba(16,12,26,0.92)";
const CARD_BORDER = "rgba(255,255,255,0.07)";
const ACCENT = "var(--color-accent)";
const AMBER = "#e3b341";

/* ── Phase meta (mirrors StudioPlanSurface) ─────────────────────── */
/* Exported for MobileBuildStatusBar (mobile Build status control). */

export const PHASE_META: Record<ExecutionPhase, { label: string; color: string }> = {
  idle: { label: "Idle", color: "var(--text-muted)" },
  planning: { label: "Planning", color: ACCENT },
  inspecting: { label: "Inspecting", color: ACCENT },
  editing: { label: "Editing", color: "var(--litt-primary)" },
  testing: { label: "Testing", color: AMBER },
  verifying: { label: "Verifying", color: "var(--litt-primary)" },
  done: { label: "Complete", color: "var(--litt-primary)" },
  failed: { label: "Needs verification", color: "var(--error)" },
  cancelled: { label: "Cancelled", color: "var(--error)" },
  awaiting_approval: { label: "Approval needed", color: AMBER },
  awaiting_input: { label: "Awaiting input", color: AMBER },
};

/* ── Collapsible card shell ─────────────────────────────────────── */

function CardShell({
  id,
  label,
  icon: Icon,
  defaultOpen,
  headerAction,
  children,
}: {
  id: string;
  label: string;
  icon: IconType;
  defaultOpen: boolean;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      data-testid={`mission-card-${id}`}
      style={{
        backgroundColor: CARD_SURFACE,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 12,
        padding: "10px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={14} strokeWidth={2} style={{ color: ACCENT }} className="pointer-events-none" />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--text-secondary)",
          }}
        >
          {label}
        </span>
        <div style={{ flex: 1 }} />
        {headerAction}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={open}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 6,
            border: `1px solid ${CARD_BORDER}`,
            backgroundColor: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <ChevronDown
            size={13}
            className="pointer-events-none"
            style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 150ms" }}
          />
        </button>
      </div>
      {open && (
        <div data-testid={`mission-card-body-${id}`} style={{ marginTop: 8 }}>
          {children}
        </div>
      )}
    </section>
  );
}

/* ── Small helpers ─────────────────────────────────────────────── */

function MetaLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-main)", textAlign: "right" }}>{value}</span>
    </div>
  );
}

function QuickAction({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: IconType;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        fontSize: 12,
        fontWeight: 500,
        borderRadius: 8,
        border: `1px solid ${CARD_BORDER}`,
        backgroundColor: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
        color: "var(--text-main)",
        cursor: "pointer",
      }}
    >
      <Icon size={13} strokeWidth={2} className="pointer-events-none" style={{ color: ACCENT }} />
      {label}
    </button>
  );
}

/* ── Main component ────────────────────────────────────────────── */

function HintsList({ hints, style }: { hints: string[]; style?: CSSProperties }) {
  if (hints.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      {hints.map((hint) => (
        <div
          key={hint}
          style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}
        >
          <span style={{ color: ACCENT, lineHeight: 1.4 }}>•</span>
          <span>{hint}</span>
        </div>
      ))}
    </div>
  );
}

export default function MissionCards({
  capabilities,
  modelLabel,
  onOpenCode,
  onOpenCanvas,
  onOpenPreview,
  onOpenTerminal,
  onOpenActivity,
  onOpenFiles,
  onRollback,
  showActions = true,
}: MissionCardsProps) {
  const phase = useExecutionStore((s) => s.phase);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const pendingApproval = useExecutionStore((s) => s.pendingApproval);
  const checkpoint = useExecutionStore((s) => s.checkpoint);
  const changesSummary = useExecutionStore((s) => s.changesSummary);
  const toolCalls = useExecutionStore((s) => s.toolCalls);

  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const executionMode = useStudioAgentStore((s) => s.executionMode);

  const agentMeta = AGENT_META[activeAgentId];
  const phaseMeta = PHASE_META[phase] ?? PHASE_META.idle;
  const sourceRow = describeSourceRows(capabilities);
  const hasMission = Boolean(capabilities.projectId);
  const hasCheckpoint = Boolean(checkpoint?.gitSha);
  const hasChanges =
    Boolean(changesSummary) &&
    (changesSummary!.added > 0 ||
      changesSummary!.modified > 0 ||
      changesSummary!.deleted > 0 ||
      changesSummary!.renamed > 0);

  /* ── Empty state: one compact card, not a dead end ─────────────── */
  if (!hasMission) {
    return (
      <div data-testid="mission-cards" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <CardShell id="empty" label="Mission" icon={Rocket} defaultOpen>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
            No active mission — describe what you want to build
          </p>
        </CardShell>
      </div>
    );
  }

  /* ── Contextual hints derived from real store state ───────────── */
  const hints: string[] = [];
  if (pendingApproval) hints.push("Approval waiting — review the request before work continues.");
  if (isRunning) hints.push(`Run in progress — step ${toolCalls.length + 1}.`);
  if (hasCheckpoint && !isRunning) hints.push("Checkpoint recorded — restore if you need to undo changes.");
  if (capabilities.terminalExecution === "unavailable")
    hints.push("Terminal unavailable — code changes still apply to the workspace.");

  return (
    <div data-testid="mission-cards" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Mobile (showActions=false): hints surface above the mission card —
          the actions themselves live in the Tools sheet. */}
      {!showActions && <HintsList hints={hints} />}
      {/* ── Mission summary ─────────────────────────────────────── */}
      <CardShell id="mission" label="Mission" icon={Rocket} defaultOpen>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>
            {agentMeta?.displayName ?? activeAgentId}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              padding: "2px 8px",
              borderRadius: 999,
              border: `1px solid ${CARD_BORDER}`,
              color: "var(--text-secondary)",
            }}
          >
            {executionMode.toUpperCase()}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 700,
              color: phaseMeta.color,
            }}
          >
            {phase === "done" ? (
              <CheckCircle2 size={12} style={{ color: phaseMeta.color }} className="pointer-events-none" />
            ) : (
              <Activity size={12} style={{ color: phaseMeta.color }} className="pointer-events-none" />
            )}
            {phaseMeta.label}
          </span>
        </div>
        <MetaLine label="Model" value={modelLabel} />
        <MetaLine
          label="Source"
          value={`${sourceRow.source} · ${sourceRow.branch}`}
        />
        <MetaLine label="Workspace" value={sourceRow.workspace} />
        <MetaLine
          label="Status"
          value={
            <span style={{ color: isRunning || phase === "awaiting_input" ? ACCENT : "var(--text-muted)" }}>
              {isRunning ? `Step ${toolCalls.length + 1} in progress` : phase === "awaiting_input" ? "Awaiting input" : "Idle"}
            </span>
          }
        />
        {pendingApproval && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 6,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 8,
              backgroundColor: "rgba(227,179,65,0.12)",
              color: AMBER,
              border: "1px solid rgba(227,179,65,0.25)",
            }}
          >
            <AlertTriangle size={12} className="pointer-events-none" />
            Approval waiting
          </div>
        )}
        {hasChanges && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
            {changesSummary!.added > 0 && (
              <span style={{ fontSize: 11, color: "var(--litt-primary)" }}>+{changesSummary!.added} created</span>
            )}
            {changesSummary!.modified > 0 && (
              <span style={{ fontSize: 11, color: AMBER }}>~{changesSummary!.modified} modified</span>
            )}
            {changesSummary!.deleted > 0 && (
              <span style={{ fontSize: 11, color: "var(--error)" }}>-{changesSummary!.deleted} deleted</span>
            )}
            {changesSummary!.renamed > 0 && (
              <span style={{ fontSize: 11, color: "#c4b5fd" }}>→{changesSummary!.renamed} renamed</span>
            )}
          </div>
        )}
      </CardShell>

      {/* ── Checkpoints ─────────────────────────────────────────── */}
      <CardShell
        id="checkpoints"
        label="Checkpoints"
        icon={GitCommit}
        defaultOpen={hasCheckpoint}
      >
        {hasCheckpoint ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>
                {checkpoint!.label}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>
                {checkpoint!.gitSha.slice(0, 12)}
              </div>
            </div>
            <button
              type="button"
              onClick={onRollback}
              disabled={isRunning}
              aria-label="Restore checkpoint"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 700,
                borderRadius: 8,
                border: `1px solid ${CARD_BORDER}`,
                backgroundColor: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
                color: "var(--text-main)",
                cursor: isRunning ? "not-allowed" : "pointer",
                opacity: isRunning ? 0.4 : 1,
              }}
            >
              <RotateCcw size={13} className="pointer-events-none" style={{ color: ACCENT }} />
              Restore
            </button>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 12, fontStyle: "italic", color: "var(--text-muted)" }}>
            No checkpoint recorded for this session.
          </p>
        )}
      </CardShell>

      {/* ── Next actions ────────────────────────────────────────── */}
      {showActions && (
      <CardShell id="actions" label="Next actions" icon={FolderOpen} defaultOpen>
        <HintsList hints={hints} style={{ marginBottom: 8 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <QuickAction label="Open Code" icon={Hammer} onClick={onOpenCode} />
          <QuickAction label="Open Canvas" icon={Layout} onClick={onOpenCanvas} />
          <QuickAction label="Open Preview" icon={Play} onClick={onOpenPreview} />
          <QuickAction label="Open Files" icon={FolderOpen} onClick={onOpenFiles} />
          <QuickAction label="Open Terminal" icon={Terminal} onClick={onOpenTerminal} />
          <QuickAction label="View Activity" icon={Activity} onClick={onOpenActivity} />
        </div>
      </CardShell>
      )}
    </div>
  );
}
