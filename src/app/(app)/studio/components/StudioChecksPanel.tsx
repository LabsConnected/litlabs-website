"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Circle,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import type { CheckEvidence, CheckKind } from "@/lib/litt-intelligence/check-evidence";

/* ─────────────────────────────────────────────────────────────────
 * StudioChecksPanel — renders real check evidence from the
 * CheckEvidenceStore. No placeholder values.
 *
 * Shows:
 * ✓ Targeted tests     14 passed     1.8s
 * ✓ Lint                              4.2s
 * ✓ TypeScript                        6.7s
 * ✓ Tests             532 passed     9.4s
 * ✓ Production build                 31.2s
 * ○ Browser checks     Not required
 *
 * Failures expand into logs.
 * Code state provenance: headSha + workingTreeDiffHash
 *
 * Phase 8 — Studio Control Plane V1
 * ───────────────────────────────────────────────────────────────── */

interface StudioChecksPanelProps {
  checks: CheckEvidence[];
  loading: boolean;
}

const KIND_LABELS: Record<CheckKind, string> = {
  "targeted-test": "Targeted tests",
  lint: "Lint",
  typecheck: "TypeScript",
  test: "Tests",
  build: "Production build",
  browser: "Browser checks",
};

function StatusIcon({ status }: { status: CheckEvidence["status"] }) {
  switch (status) {
    case "passed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />;
    case "skipped":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />;
    case "queued":
      return <Circle className="h-3.5 w-3.5 text-gray-400" />;
  }
}

function formatDuration(ms?: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function StudioChecksPanel({ checks, loading }: StudioChecksPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...checks].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()),
    [checks],
  );

  const latest = sorted[sorted.length - 1];

  if (loading && checks.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-[10px]" style={{ color: "var(--text-muted)" }}>
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        Loading checks…
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div
        className="flex min-h-24 items-center justify-center rounded-lg border px-3 text-center text-[10px]"
        style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
        role="status"
        data-testid="checks-empty"
      >
        No checks yet. When LiTT runs validation, results will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="studio-checks-panel">
      {sorted.map((check) => {
        const isExpanded = expandedId === check.id;
        const canExpand = check.status === "failed" || check.status === "skipped";
        const hasLogs = check.stderrRef || check.stdoutRef;

        return (
          <div key={check.id}>
            <div
              className="flex items-center gap-2 rounded-lg border px-2.5 py-2"
              style={{
                borderColor: check.stale ? "rgba(251,146,60,0.3)" : "var(--studio-border)",
                backgroundColor: check.stale ? "rgba(251,146,60,0.04)" : "var(--studio-card)",
              }}
              data-testid={`check-${check.kind}`}
            >
              <StatusIcon status={check.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>
                    {KIND_LABELS[check.kind] ?? check.kind}
                  </span>
                  {check.required && (
                    <span className="text-[8px] uppercase tracking-wider text-amber-400">REQUIRED</span>
                  )}
                  {!check.required && check.status === "skipped" && (
                    <span className="text-[8px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                      optional
                    </span>
                  )}
                  {check.stale && (
                    <span className="text-[8px] uppercase tracking-wider text-amber-400" data-testid={`check-${check.kind}-stale`}>
                      STALE
                    </span>
                  )}
                </div>
                {check.skipReason && (
                  <div className="mt-0.5 text-[9px]" style={{ color: "var(--text-muted)" }} data-testid={`check-${check.kind}-skip-reason`}>
                    {check.skipReason}
                  </div>
                )}
                {check.failureReason && (
                  <div className="mt-0.5 text-[9px] text-red-400" data-testid={`check-${check.kind}-failure-reason`}>
                    {check.failureReason}
                  </div>
                )}
              </div>
              {check.durationMs !== undefined && check.durationMs > 0 && (
                <span className="shrink-0 text-[9px]" style={{ color: "var(--text-muted)" }}>
                  {formatDuration(check.durationMs)}
                </span>
              )}
              {canExpand && hasLogs && (
                <button
                  onClick={() => setExpandedId(isExpanded ? null : check.id)}
                  className="shrink-0"
                  aria-label={isExpanded ? "Collapse logs" : "Expand logs"}
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
              )}
            </div>

            {/* Expanded logs */}
            {isExpanded && hasLogs && (
              <div className="mt-1 rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--studio-border)" }}>
                {check.stderrRef && (
                  <div className="mb-2">
                    <div className="text-[8px] uppercase tracking-wider text-red-400 mb-1">stderr</div>
                    <pre className="max-h-32 overflow-auto text-[9px] leading-4 font-mono text-red-300" data-testid={`check-${check.kind}-stderr`}>
                      {check.stderrRef.replace(/^inline:/, "")}
                    </pre>
                  </div>
                )}
                {check.stdoutRef && (
                  <div>
                    <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>stdout</div>
                    <pre className="max-h-32 overflow-auto text-[9px] leading-4 font-mono" style={{ color: "var(--text-secondary)" }} data-testid={`check-${check.kind}-stdout`}>
                      {check.stdoutRef.replace(/^inline:/, "")}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Code state provenance */}
      {latest && (
        <div className="rounded-lg border px-2.5 py-2 text-[9px]" style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }} data-testid="checks-code-state">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="h-3 w-3" />
            <span className="font-bold">Code state</span>
          </div>
          <div className="flex justify-between">
            <span>HEAD</span>
            <span className="font-mono">{latest.headSha.slice(0, 12)}</span>
          </div>
          <div className="flex justify-between">
            <span>Worktree</span>
            <span className="font-mono">{latest.workingTreeDiffHash.slice(0, 12)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
