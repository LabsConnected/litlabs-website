"use client";

/**
 * MobileBuildStatusBar — compact Build status bar for the mobile LiTT Studio chat.
 *
 * Replaces the Mission / Checkpoints / Next Actions card stack with a single
 * ~36px button on mobile. Tapping it opens a bottom sheet with the full cards.
 *
 * Reads the SAME zustand stores as MissionCards (useExecutionStore,
 * useStudioAgentStore) — no new state.
 */

import { Activity, CheckCircle2, ChevronDown } from "lucide-react";
import { PHASE_META } from "../MissionCards";
import { useExecutionStore } from "../../stores/useExecutionStore";
import { useStudioAgentStore, AGENT_META } from "../../stores/useStudioAgentStore";

/* ── Design tokens (literals, matching MissionCards) ───────────── */

const CARD_SURFACE = "rgba(16,12,26,0.92)";
const CARD_BORDER = "rgba(255,255,255,0.07)";
const CYAN = "#22d3ee";
const AMBER = "#e3b341";

export interface MobileBuildStatusBarProps {
  open: boolean;
  onOpen: () => void;
}

export default function MobileBuildStatusBar({ open, onOpen }: MobileBuildStatusBarProps) {
  const phase = useExecutionStore((s) => s.phase);
  const pendingApproval = useExecutionStore((s) => s.pendingApproval);
  const checkpoint = useExecutionStore((s) => s.checkpoint);

  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const executionMode = useStudioAgentStore((s) => s.executionMode);

  const agentMeta = AGENT_META[activeAgentId];
  const phaseMeta = PHASE_META[phase] ?? PHASE_META.idle;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="mobile-build-status"
      aria-expanded={open}
      aria-label="Build status — open details"
      style={{
        height: 36,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 12px",
        width: "100%",
        borderRadius: 12,
        border: `1px solid ${CARD_BORDER}`,
        backgroundColor: CARD_SURFACE,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      {/* Phase pill */}
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

      {/* Agent + mode */}
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--text-main)",
          minWidth: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          flex: 1,
        }}
      >
        {agentMeta?.displayName ?? activeAgentId} · {executionMode.toUpperCase()}
      </span>

      {/* Checkpoint indicator */}
      {checkpoint?.gitSha && (
        <span
          data-testid="mobile-build-checkpoint-dot"
          title="Checkpoint recorded"
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: CYAN,
            flexShrink: 0,
          }}
        />
      )}

      {/* Pending approval badge */}
      {pendingApproval && (
        <span
          data-testid="mobile-build-approval"
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 999,
            backgroundColor: "rgba(227,179,65,0.12)",
            color: AMBER,
            border: "1px solid rgba(227,179,65,0.25)",
            flexShrink: 0,
          }}
        >
          Approval waiting
        </span>
      )}

      {/* Sheet toggle chevron */}
      <ChevronDown
        size={14}
        className="pointer-events-none"
        aria-hidden
        style={{
          color: "var(--text-muted)",
          transform: open ? "rotate(180deg)" : undefined,
          transition: "transform 150ms",
          flexShrink: 0,
        }}
      />
    </button>
  );
}
