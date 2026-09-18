"use client";

import { AlertTriangle } from "lucide-react";

/* ── Types ────────────────────────────────────────────────────────── */

export interface ApprovalInputs {
  toolId: string;
  reason: string;
  pausedRunId?: string;
  inputs?: Record<string, unknown>;
}

export interface ApprovalCardProps {
  approval: ApprovalInputs;
  onResolve?: (decision: "approved" | "rejected") => void;
  onEdit?: () => void;
  autoApproved?: boolean;
  isDeploy?: boolean;
  compact?: boolean;
  /**
   * Client-side approval lifecycle phase. The card stays mounted through
   * every phase: "submitting" disables the buttons, "executing" shows the
   * run in progress, and "failed" shows the backend error with a Retry
   * affordance (re-POSTs the same pausedRunId — no silent clear, no auto
   * re-request; when `expired` is set the retry re-requests a fresh gate).
   */
  phase?: "idle" | "submitting" | "executing" | "failed";
  /** Backend error shown when phase is "failed". */
  error?: string | null;
  /** Whether the failed approval may be retried. Defaults to true. */
  retryable?: boolean;
  /**
   * True when the failure was an expiry: the retry affordance re-requests
   * a fresh gate, so the button reads "Request again" instead of
   * "Retry approval".
   */
  expired?: boolean;
  /** Re-submits the approval decision for the same paused run. */
  onRetry?: () => void;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

/** Keys that strongly suggest a value is a list of files/paths. */
const FILE_LIKE_KEY = /^(files?|paths?|file[_-]?paths?|filenames?|file[_-]?names?|targets?|changed|added|modified|deleted|creations?)$/i;

/** Heuristic: does this string look like a file path or filename? */
function looksLikePath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes("/") || trimmed.includes("\\")) return true;
  if (trimmed.startsWith("~")) return true;
  return /\.[a-z0-9]{1,8}$/i.test(trimmed);
}

/**
 * Count affected files from tool inputs when it can be done confidently.
 * Looks for arrays/objects under file-like keys, or arrays whose items all
 * look like paths. Returns null when nothing file-like is found so the
 * caller can omit the line entirely.
 */
function countAffectedFiles(inputs?: Record<string, unknown>): number | null {
  if (!inputs) return null;
  let count = 0;
  let found = false;

  for (const [key, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) {
      const strings = value.filter(
        (item): item is string => typeof item === "string"
      );
      if (strings.length > 0 && FILE_LIKE_KEY.test(key)) {
        // Key explicitly says files/paths — trust the count even for bare names.
        count += strings.length;
        found = true;
      } else if (strings.length > 0 && strings.every(looksLikePath)) {
        count += strings.length;
        found = true;
      } else {
        // Arrays of objects with path-ish fields (e.g. [{ path, kind }]).
        const objects = value.filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null && !Array.isArray(item)
        );
        if (objects.length > 0) {
          const pathish = objects.filter((obj) => {
            const candidate =
              obj.path ?? obj.file ?? obj.filePath ?? obj.filename ?? obj.name;
            return typeof candidate === "string" && looksLikePath(candidate);
          });
          if (pathish.length > 0 && pathish.length === objects.length) {
            count += pathish.length;
            found = true;
          }
        }
      }
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      // Nested object: check for file-like keys one level down.
      const nested = value as Record<string, unknown>;
      for (const [nestedKey, nestedValue] of Object.entries(nested)) {
        if (!FILE_LIKE_KEY.test(nestedKey)) continue;
        if (Array.isArray(nestedValue)) {
          count += nestedValue.length;
          found = true;
        } else if (typeof nestedValue === "string" && looksLikePath(nestedValue)) {
          count += 1;
          found = true;
        } else if (
          typeof nestedValue === "object" &&
          nestedValue !== null &&
          !Array.isArray(nestedValue)
        ) {
          count += Object.keys(nestedValue).length;
          found = true;
        }
      }
    } else if (
      typeof value === "string" &&
      FILE_LIKE_KEY.test(key) &&
      looksLikePath(value)
    ) {
      count += 1;
      found = true;
    }
  }

  return found ? count : null;
}

/* ── Component ────────────────────────────────────────────────────── */

export function ApprovalCard({
  approval,
  onResolve,
  onEdit,
  autoApproved = false,
  isDeploy = false,
  compact = false,
  phase = "idle",
  error = null,
  retryable = true,
  expired = false,
  onRetry,
}: ApprovalCardProps) {
  const toolLabel = approval.toolId.replace(/_/g, " ");
  const affectedCount = countAffectedFiles(approval.inputs);
  // Once a decision is submitted the gate is consumed server-side — the
  // buttons must not be clickable again while submitting/executing, and a
  // failed gate offers Retry (same paused run) instead of a second decision.
  const showButtons = !autoApproved && onResolve != null && phase !== "failed";
  const buttonsDisabled = phase === "submitting" || phase === "executing";

  const borderColor = isDeploy ? "#ef444480" : "#e3b34140";
  const backgroundColor = isDeploy ? "#ef44440d" : "#e3b34108";
  const accentColor = isDeploy ? "#ef4444" : "#e3b341";

  return (
    <div
      data-testid="approval-card"
      className={compact ? "rounded-xl border p-2" : "rounded-xl border p-2.5"}
      style={{ borderColor, backgroundColor }}
    >
      {/* Header */}
      <div className={`flex items-center gap-2 ${compact ? "pb-1" : "pb-1.5"}`}>
        <AlertTriangle
          size={14}
          style={{ color: accentColor }}
          className="pointer-events-none shrink-0"
        />
        <span
          className="text-[10px] font-black uppercase tracking-wider"
          style={{ color: accentColor }}
        >
          {isDeploy ? "Deploy approval — always requires you" : "Approval required"}
        </span>
      </div>

      {/* Body */}
      <div
        className={`leading-tight ${compact ? "pb-1.5" : "pb-2"}`}
        style={{ color: "var(--text-secondary)" }}
      >
        <div className="text-[11px]">
          <span className="font-bold">{toolLabel}</span>
          {affectedCount !== null && (
            <span
              className="ml-1.5 text-[10px] font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              · {affectedCount} {affectedCount === 1 ? "file" : "files"} affected
            </span>
          )}
        </div>
        <div className="pt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
          {approval.reason}
        </div>
        {approval.pausedRunId && (
          <div
            className="pt-1 font-mono text-[9px]"
            style={{ color: "var(--text-muted)" }}
          >
            run {approval.pausedRunId.slice(0, 8)}
          </div>
        )}
      </div>

      {/* Status line — submitting / executing / failed */}
      {phase === "submitting" && (
        <div
          data-testid="approval-status"
          className="pb-1.5 text-[10px] font-bold"
          style={{ color: "var(--text-secondary)" }}
        >
          Submitting approval…
        </div>
      )}
      {phase === "executing" && (
        <div
          data-testid="approval-status"
          className="pb-1.5 text-[10px] font-bold"
          style={{ color: "var(--text-secondary)" }}
        >
          Approved — running…
        </div>
      )}
      {phase === "failed" && (
        <div
          data-testid="approval-error"
          className="mb-1.5 rounded-lg border px-2 py-1.5 text-[10px] leading-snug"
          style={{
            borderColor: "#ef444466",
            backgroundColor: "#ef444412",
            color: "#fca5a5",
          }}
          role="alert"
        >
          <span className="font-bold">Approval failed: </span>
          {error || "The approval request failed."}
        </div>
      )}

      {/* Actions */}
      {autoApproved ? (
        <div
          className="text-[10px] italic"
          style={{ color: "var(--text-muted)" }}
        >
          Auto-approved in AUTO mode
        </div>
      ) : phase === "failed" ? (
        <div className="flex gap-1.5">
          {retryable && onRetry ? (
            <button
              type="button"
              data-testid="approval-retry"
              onClick={onRetry}
              className="flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold transition hover:bg-white/10"
              style={{
                borderColor: "#22d3ee66",
                backgroundColor: "#22d3ee12",
                color: "#22d3ee",
              }}
            >
              {expired ? "Request again" : "Retry approval"}
            </button>
          ) : (
            <div
              className="flex-1 py-1.5 text-center text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              This approval can no longer be retried.
            </div>
          )}
        </div>
      ) : (
        showButtons && (
          <div className="flex gap-1.5">
            <button
              type="button"
              data-testid="approval-approve"
              onClick={() => onResolve?.("approved")}
              disabled={buttonsDisabled}
              className="flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold transition hover:bg-white/10 disabled:opacity-40"
              style={{
                borderColor: "#22d3ee66",
                backgroundColor: "#22d3ee12",
                color: "#22d3ee",
              }}
            >
              {phase === "submitting" ? "Submitting…" : phase === "executing" ? "Running…" : "Approve"}
            </button>
            {onEdit && !buttonsDisabled && (
              <button
                type="button"
                data-testid="approval-edit"
                onClick={onEdit}
                className="rounded-lg border px-3 py-1.5 text-[10px] font-bold transition hover:bg-white/10"
                style={{
                  borderColor: "rgba(255,255,255,0.07)",
                  backgroundColor: "rgba(255,255,255,0.04)",
                  color: "var(--text-secondary)",
                }}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              data-testid="approval-deny"
              onClick={() => onResolve?.("rejected")}
              disabled={buttonsDisabled}
              className="flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold transition hover:bg-white/10 disabled:opacity-40"
              style={{
                borderColor: "#ef444466",
                backgroundColor: "#ef444412",
                color: "#ef4444",
              }}
            >
              Deny
            </button>
          </div>
        )
      )}
    </div>
  );
}
