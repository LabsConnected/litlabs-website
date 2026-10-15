/**
 * Phase 3B — StudioPrimaryAction
 *
 * One state-dependent primary action for the Studio preview toolbar.
 * Uses existing approval/deployment handlers; introduces no new state machine.
 *
 * States:
 * - Building: progress indicator, no primary action (Cancel is secondary)
 * - Approval Required: focuses the canonical ApprovalCard (no duplicate Approve button)
 * - Approved + deployment-eligible: Go Live (invokes handleDeployRequest)
 * - Publishing: progress indicator, no deployment action
 * - Verified Live: Open Live (opens verified publicUrl)
 * - Failed: recovery action, never unauthorized Go Live
 */
"use client";

export type PrimaryActionState =
  | "building"
  | "approval_required"
  | "ready_to_deploy"
  | "publishing"
  | "live"
  | "failed"
  | "idle";

interface StudioPrimaryActionProps {
  state: PrimaryActionState;
  /** Existing handler: approve the pending approval */
  onApprove?: () => void;
  /** Existing handler: request deployment (goes through project.deploy approval) */
  onDeploy?: () => void;
  /** Focus the canonical ApprovalCard (scrolls to it, does not duplicate) */
  onFocusApproval?: () => void;
  /** Verified public URL for Open Live */
  publicUrl?: string | null;
  /** Retry handler for failed state */
  onRetry?: () => void;
  /** Cancel handler for building state (secondary) */
  onCancel?: () => void;
}

export default function StudioPrimaryAction({
  state,
  onApprove,
  onDeploy,
  onFocusApproval,
  publicUrl,
  onRetry,
  onCancel,
}: StudioPrimaryActionProps) {
  const primaryButtonClass =
    "rounded-xl px-6 py-2.5 text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]";

  const primaryStyle: React.CSSProperties = {
    backgroundColor: "var(--litt-primary)",
    color: "white",
    border: "1px solid var(--litt-primary)",
  };

  const secondaryButtonClass =
    "rounded-xl px-4 py-2.5 text-sm font-medium transition-all hover:bg-white/10";

  const secondaryStyle: React.CSSProperties = {
    border: "1px solid var(--glass-border)",
    color: "var(--text-secondary)",
  };

  switch (state) {
    case "building":
      return (
        <div className="flex items-center gap-3" data-testid="primary-action" data-state="building">
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <div
              className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--litt-primary)", borderTopColor: "transparent" }}
              aria-label="Building"
            />
            <span>Building…</span>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className={secondaryButtonClass}
              style={secondaryStyle}
              data-testid="primary-action-cancel"
            >
              Cancel
            </button>
          )}
        </div>
      );

    case "approval_required":
      // Do NOT render a duplicate Approve button here.
      // The canonical ApprovalCard.tsx is the actionable interface.
      // This button focuses/scrolls to it.
      return (
        <div className="flex items-center gap-3" data-testid="primary-action" data-state="approval_required">
          <button
            type="button"
            onClick={onFocusApproval}
            className={primaryButtonClass}
            style={{
              ...primaryStyle,
              backgroundColor: "#e3b341",
              borderColor: "#e3b341",
            }}
            data-testid="primary-action-focus-approval"
          >
            Review Approval
          </button>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Approval needed in chat
          </span>
        </div>
      );

    case "ready_to_deploy":
      return (
        <div className="flex items-center gap-3" data-testid="primary-action" data-state="ready_to_deploy">
          <button
            type="button"
            onClick={onDeploy}
            className={primaryButtonClass}
            style={primaryStyle}
            data-testid="primary-action-go-live"
          >
            Go Live
          </button>
        </div>
      );

    case "publishing":
      return (
        <div className="flex items-center gap-3" data-testid="primary-action" data-state="publishing">
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <div
              className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--litt-primary)", borderTopColor: "transparent" }}
              aria-label="Publishing"
            />
            <span>Publishing…</span>
          </div>
        </div>
      );

    case "live":
      if (!publicUrl) return null;
      return (
        <div className="flex items-center gap-3" data-testid="primary-action" data-state="live">
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={primaryButtonClass}
            style={{ ...primaryStyle, textDecoration: "none", display: "inline-block" }}
            data-testid="primary-action-open-live"
          >
            Open Live
          </a>
        </div>
      );

    case "failed":
      return (
        <div className="flex items-center gap-3" data-testid="primary-action" data-state="failed">
          <span className="text-sm" style={{ color: "#ef4444" }}>
            Build failed
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className={secondaryButtonClass}
              style={secondaryStyle}
              data-testid="primary-action-retry"
            >
              Retry
            </button>
          )}
        </div>
      );

    case "idle":
    default:
      return null;
  }
}
