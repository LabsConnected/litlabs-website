"use client";

import { useMemo } from "react";
import { GitBranch, FileEdit, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { MutationEvidence } from "@/lib/litt-intelligence/mutation-evidence";

/* ─────────────────────────────────────────────────────────────────
 * StudioChangesPanel — renders real Git/worktree truth from
 * MutationEvidence records. No placeholder values.
 *
 * Shows:
 * - Branch
 * - HEAD SHA
 * - Base SHA
 * - Dirty/clean
 * - Modified/created/deleted files
 * - Additions/deletions
 * - Unified diff
 * - Evidence ID
 * - Approval ID
 * - Mutation status
 * - Timestamp
 *
 * Phase 7 — Studio Control Plane V1
 * ───────────────────────────────────────────────────────────────── */

interface StudioChangesPanelProps {
  evidence: MutationEvidence[];
  loading: boolean;
}

export function StudioChangesPanel({ evidence, loading }: StudioChangesPanelProps) {
  const latest = evidence[evidence.length - 1];

  const fileChanges = useMemo(() => {
    if (!latest) return null;
    const changes: Array<{
      path: string;
      status: "created" | "modified" | "deleted";
      beforeHash: string | null;
      afterHash: string | null;
    }> = [];

    for (const path of latest.paths) {
      const before = latest.beforeHashes[path] ?? null;
      const after = latest.afterHashes[path] ?? null;
      let status: "created" | "modified" | "deleted" = "modified";
      if (before === null && after !== null) status = "created";
      else if (before !== null && after === null) status = "deleted";
      changes.push({ path, status, beforeHash: before, afterHash: after });
    }
    return changes;
  }, [latest]);

  if (loading && evidence.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-[10px]" style={{ color: "var(--text-muted)" }}>
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        Loading changes…
      </div>
    );
  }

  if (!latest) {
    return (
      <div className="space-y-3">
        <div
          className="flex items-center justify-center rounded-lg border px-3 py-6 text-center text-[10px]"
          style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
          role="status"
          data-testid="changes-empty"
        >
          No changes yet. When LiTT edits files in ACT mode, the diff and evidence will appear here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="studio-changes-panel">
      {/* ── Branch + SHA truth ── */}
      <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
        <div className="flex items-center gap-2 text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>
          <GitBranch className="h-3 w-3" />
          {latest.branch}
        </div>
        <div className="mt-2 space-y-1 text-[9px]" style={{ color: "var(--text-muted)" }}>
          <div className="flex justify-between">
            <span>HEAD</span>
            <span className="font-mono" data-testid="changes-head-sha">{latest.headShaAfter ?? latest.headShaBefore?.slice(0, 12) ?? "unknown"}</span>
          </div>
          <div className="flex justify-between">
            <span>Base</span>
            <span className="font-mono">{latest.baseSha?.slice(0, 12) ?? "unknown"}</span>
          </div>
          <div className="flex justify-between">
            <span>Worktree</span>
            <span style={{ color: latest.workingTreeDirty ? "#fb923c" : "var(--litt-primary)" }} data-testid="changes-worktree-status">
              {latest.workingTreeDirty ? "Dirty (uncommitted)" : "Clean"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Mutation status ── */}
      <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--studio-border)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>
            {latest.status === "succeeded" && <CheckCircle2 className="h-3 w-3 text-green-400" />}
            {latest.status === "failed" && <AlertCircle className="h-3 w-3 text-red-400" />}
            {latest.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-violet-400" />}
            <span data-testid="changes-mutation-status">{latest.status}</span>
          </div>
          <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>{latest.toolId}</span>
        </div>
        {latest.error && (
          <div className="mt-1 text-[9px] text-red-400" data-testid="changes-error">{latest.error}</div>
        )}
      </div>

      {/* ── File changes ── */}
      {fileChanges && fileChanges.length > 0 && (
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--studio-border)" }}>
          <div className="text-[9px] uppercase tracking-[0.14em] mb-2" style={{ color: "var(--text-muted)" }}>
            Files ({fileChanges.length})
          </div>
          <div className="space-y-1">
            {fileChanges.map((change) => (
              <div key={change.path} className="flex items-center gap-2 text-[10px]" data-testid={`changes-file-${change.path}`}>
                <FileEdit className="h-3 w-3 shrink-0" style={{ color: change.status === "created" ? "text-green-400" : change.status === "deleted" ? "text-red-400" : "var(--text-muted)" }} />
                <span className="truncate font-mono" style={{ color: "var(--text-secondary)" }}>{change.path}</span>
                <span className="shrink-0 text-[9px] uppercase" style={{
                  color: change.status === "created" ? "#4ade80" : change.status === "deleted" ? "#f87171" : "var(--text-muted)"
                }}>
                  {change.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Unified diff ── */}
      {latest.diff && (
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--studio-border)" }}>
          <div className="text-[9px] uppercase tracking-[0.14em] mb-2" style={{ color: "var(--text-muted)" }}>
            Diff
          </div>
          <pre className="max-h-64 overflow-auto text-[9px] leading-4 font-mono" data-testid="changes-diff">
            {latest.diff}
          </pre>
        </div>
      )}

      {/* ── Evidence metadata ── */}
      <div className="rounded-lg border px-3 py-2 text-[9px]" style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}>
        <div className="flex justify-between">
          <span>Evidence ID</span>
          <span className="font-mono" data-testid="changes-evidence-id">{latest.id.slice(0, 16)}</span>
        </div>
        {latest.approvalTokenId && (
          <div className="flex justify-between mt-1">
            <span>Approval</span>
            <span className="font-mono">{latest.approvalTokenId.slice(0, 16)}</span>
          </div>
        )}
        <div className="flex justify-between mt-1">
          <span>Started</span>
          <span>{new Date(latest.startedAt).toLocaleTimeString()}</span>
        </div>
        {latest.completedAt && (
          <div className="flex justify-between mt-1">
            <span>Completed</span>
            <span>{new Date(latest.completedAt).toLocaleTimeString()}</span>
          </div>
        )}
      </div>
    </div>
  );
}
