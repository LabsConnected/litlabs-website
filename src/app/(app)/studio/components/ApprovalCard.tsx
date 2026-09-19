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
  /**
   * Re-submits the approval decision for the same paused run.
   */
  onRetry?: () => void;
  /**
   * The agent execution mode in effect when the approval was raised
   * ("plan" | "act" | "auto"). Rendered as a pill in the header so the
   * user can see which lane they are approving into. Optional: when
   * absent no pill renders — the card never guesses the mode.
   *
   * Honesty note: this is the client's selected mode at render time,
   * passed down by the Studio surface. Binding the mode into the
   * server-side approval request is separate work (mode-pill honesty
   * track); until then the pill reflects the user's current selection,
   * not a server-attested lane.
   */
  mode?: "plan" | "act" | "auto";
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

/** Keys whose string values are plausibly an image attached to the request. */
const IMAGE_URL_KEY = /(image|picture|photo|thumbnail|download.?url|image.?url)$/i;

/** First https URL in the inputs that is plausibly an image, else null. */
function findAttachedImageUrl(inputs?: Record<string, unknown>): string | null {
  if (!inputs) return null;
  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (!/^https?:\/\//i.test(v)) continue;
    if (IMAGE_URL_KEY.test(key) || /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(v)) {
      return v;
    }
  }
  return null;
}

/** Short scalar params (size, style, …) to show as chips; prompt handled separately. */
function imageRequestParams(inputs?: Record<string, unknown>): Array<{ key: string; value: string }> {
  if (!inputs) return [];
  const out: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(inputs)) {
    if (key.toLowerCase() === "prompt") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const s = String(value).trim();
      if (s.length === 0 || s.length > 48 || /^https?:\/\//i.test(s)) continue;
      out.push({ key, value: s });
    }
  }
  return out.slice(0, 6);
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
  mode,
}: ApprovalCardProps) {
  const toolLabel = approval.toolId.replace(/_/g, " ");
  const affectedCount = countAffectedFiles(approval.inputs);
  const isImageRequest = approval.toolId === "image.generate";
  const imagePrompt =
    isImageRequest && typeof approval.inputs?.prompt === "string"
      ? approval.inputs.prompt.trim()
      : null;
  const imageParams = isImageRequest ? imageRequestParams(approval.inputs) : [];
  const attachedImageUrl = isImageRequest ? findAttachedImageUrl(approval.inputs) : null;
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
        {mode && (
          <span
            data-testid="approval-mode"
            className={
              mode === "act"
                ? "ml-auto rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-accent"
                : "ml-auto rounded-full border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider"
            }
            style={
              mode === "act"
                ? undefined
                : {
                    color: "var(--text-muted)",
                    borderColor: "rgba(255,255,255,0.12)",
                    backgroundColor: "rgba(255,255,255,0.04)",
                  }
            }
          >
            {mode === "act" ? "Act" : mode === "plan" ? "Plan" : "Auto"}
          </span>
        )}
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

      {/* Image request — honest preview. A real attached image renders as
          a thumbnail; otherwise the prompt + params show instead of faked
          pixels. Nothing here claims an image was generated. */}
      {isImageRequest && (
        <div
          data-testid="approval-image-request"
          className="mb-2 rounded-lg border px-2 py-1.5"
          style={{
            borderColor: "rgba(255,255,255,0.08)",
            backgroundColor: "rgba(255,255,255,0.03)",
          }}
        >
          <div
            className="pb-1 text-[9px] font-black uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            Image request
          </div>
          {attachedImageUrl && (
            <>
              {/* Plain <img>: attached URLs are arbitrary user-supplied values
                  (data:/blob:), which next/image cannot optimize. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachedImageUrl}
                alt="Image attached to this approval request"
                data-testid="approval-image-thumbnail"
                className="max-h-40 w-full rounded-md object-cover"
              />
              <div
                className="pt-1 text-[9px]"
                style={{ color: "var(--text-muted)" }}
              >
                Attached image — came with the request, not generated.
              </div>
            </>
          )}
          {imagePrompt && (
            <div
              data-testid="approval-image-prompt"
              className="pt-1 text-[11px] italic leading-snug"
              style={{ color: "var(--text-secondary)" }}
            >
              &ldquo;{imagePrompt}&rdquo;
            </div>
          )}
          {imageParams.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {imageParams.map(({ key, value }) => (
                <span
                  key={key}
                  className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold"
                  style={{
                    borderColor: "rgba(255,255,255,0.1)",
                    backgroundColor: "rgba(255,255,255,0.04)",
                    color: "var(--text-muted)",
                  }}
                >
                  {key}: {value}
                </span>
              ))}
            </div>
          )}
          {!attachedImageUrl && (
            <div
              className="pt-1 text-[9px]"
              style={{ color: "var(--text-muted)" }}
            >
              No image generated yet — approving runs the generation.
            </div>
          )}
        </div>
      )}

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
              className="flex-1 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1.5 text-[10px] font-bold text-accent transition hover:bg-accent/20"
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
              className="flex-1 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1.5 text-[10px] font-bold text-accent transition hover:bg-accent/20 disabled:opacity-40"
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
