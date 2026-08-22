"use client";

import { useMemo } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Circle,
  Clock,
  Link2,
} from "lucide-react";
import type { AcceptanceEvidence, AcceptanceStatus } from "@/lib/litt-intelligence/acceptance-evidence";

/* ─────────────────────────────────────────────────────────────────
 * StudioAcceptancePanel — renders real acceptance evidence.
 *
 * Shows:
 * - Criterion text
 * - Required/optional badge
 * - Verified/failed/skipped/pending status
 * - Evidence source and references
 * - Stale state
 * - Failure or skip reason
 *
 * No fake status or placeholder data.
 *
 * Phase 9 — Studio Control Plane V1
 * ───────────────────────────────────────────────────────────────── */

interface StudioAcceptancePanelProps {
  acceptance: AcceptanceEvidence[];
  loading: boolean;
}

function StatusIcon({ status }: { status: AcceptanceStatus }) {
  switch (status) {
    case "verified":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    case "verifying":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />;
    case "skipped":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />;
    case "queued":
      return <Circle className="h-3.5 w-3.5 text-gray-400" />;
  }
}

const STATUS_LABELS: Record<AcceptanceStatus, string> = {
  verified: "Verified",
  failed: "Failed",
  verifying: "Verifying",
  skipped: "Skipped",
  queued: "Pending",
};

export function StudioAcceptancePanel({ acceptance, loading }: StudioAcceptancePanelProps) {
  const sorted = useMemo(
    () =>
      [...acceptance].sort(
        (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      ),
    [acceptance],
  );

  if (loading && acceptance.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-[10px]" style={{ color: "var(--text-muted)" }}>
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        Loading acceptance criteria…
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div
        className="flex min-h-24 items-center justify-center rounded-lg border px-3 text-center text-[10px]"
        style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
        role="status"
        data-testid="acceptance-empty"
      >
        No acceptance criteria yet. Criteria from the plan will appear here for verification.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="studio-acceptance-panel">
      {sorted.map((item) => (
        <div
          key={item.id}
          className="rounded-lg border px-2.5 py-2"
          style={{
            borderColor: item.stale ? "rgba(251,146,60,0.3)" : "var(--studio-border)",
            backgroundColor: item.stale ? "rgba(251,146,60,0.04)" : "var(--studio-card)",
          }}
          data-testid={`acceptance-${item.id.slice(0, 12)}`}
        >
          <div className="flex items-start gap-2">
            <StatusIcon status={item.status} />
            <div className="min-w-0 flex-1">
              {/* Criterion text */}
              <div className="text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>
                {item.criterion}
              </div>

              {/* Badges */}
              <div className="mt-1 flex items-center gap-1.5">
                {item.required ? (
                  <span className="text-[8px] uppercase tracking-wider text-amber-400">REQUIRED</span>
                ) : (
                  <span className="text-[8px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                    optional
                  </span>
                )}
                <span
                  className="text-[8px] uppercase tracking-wider"
                  style={{
                    color: item.status === "verified" ? "#4ade80" : item.status === "failed" ? "#f87171" : "var(--text-muted)",
                  }}
                  data-testid={`acceptance-${item.id.slice(0, 12)}-status`}
                >
                  {STATUS_LABELS[item.status]}
                </span>
                {item.stale && (
                  <span
                    className="text-[8px] uppercase tracking-wider text-amber-400"
                    data-testid={`acceptance-${item.id.slice(0, 12)}-stale`}
                  >
                    STALE
                  </span>
                )}
              </div>

              {/* Verification source + evidence refs */}
              {item.verificationSource && (
                <div className="mt-1 flex items-center gap-1 text-[9px]" style={{ color: "var(--text-muted)" }}>
                  <Link2 className="h-2.5 w-2.5" />
                  <span>{item.verificationSource}</span>
                  {item.evidenceRefs.length > 0 && (
                    <span className="font-mono">({item.evidenceRefs.length} ref{item.evidenceRefs.length === 1 ? "" : "s"})</span>
                  )}
                </div>
              )}

              {/* Verification summary */}
              {item.verificationSummary && (
                <div className="mt-1 text-[9px]" style={{ color: "var(--text-secondary)" }} data-testid={`acceptance-${item.id.slice(0, 12)}-summary`}>
                  {item.verificationSummary}
                </div>
              )}

              {/* Failure reason */}
              {item.failureReason && (
                <div className="mt-1 text-[9px] text-red-400" data-testid={`acceptance-${item.id.slice(0, 12)}-failure`}>
                  {item.failureReason}
                </div>
              )}

              {/* Skip reason */}
              {item.skipReason && (
                <div className="mt-1 text-[9px] text-amber-400" data-testid={`acceptance-${item.id.slice(0, 12)}-skip`}>
                  {item.skipReason}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Code state provenance */}
      {sorted[0] && (
        <div className="rounded-lg border px-2.5 py-2 text-[9px]" style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }} data-testid="acceptance-code-state">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="h-3 w-3" />
            <span className="font-bold">Code state</span>
          </div>
          <div className="flex justify-between">
            <span>HEAD</span>
            <span className="font-mono">{sorted[0].headSha.slice(0, 12)}</span>
          </div>
          <div className="flex justify-between">
            <span>Worktree</span>
            <span className="font-mono">{sorted[0].workingTreeDiffHash.slice(0, 12)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
