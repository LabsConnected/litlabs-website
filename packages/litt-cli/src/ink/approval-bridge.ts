/**
 * ApprovalBridge — connects ExecutionGateway's onApprovalRequired
 * callback to the Ink UI's approval prompt.
 *
 * Flow:
 *   ExecutionGateway.execute()
 *     → require_approval
 *     → onApprovalRequired(request, risk)
 *     → ApprovalBridge.request()
 *     → Promise<boolean> pending
 *     → UI shows ApprovalUX
 *     → user presses A/D
 *     → ApprovalBridge.decide(approved)
 *     → Promise resolves
 *     → gateway verifyApproval() → VerifiedApproval → continues SAME execution
 *
 * CRITICAL: The bridge only carries the human's boolean decision.
 * It NEVER creates a VerifiedApproval. The gateway remains sole
 * authority for approval verification and capsule creation.
 */

import type { ExecutionRequest, RiskAssessment } from "@litt/agent-core";

/**
 * Human-readable description of a non-shell tool's pending action, shown
 * in the approval prompt. Shell commands (project.run) already get a
 * readable "<command> <args>" string from the risk assessment branch —
 * this covers tools where the risky part is in the structured inputs,
 * not a raw argv (e.g. project.ship's files/message/branch/push/PR).
 */
function describeToolAction(toolId: string, inputs: Record<string, unknown>): string {
  if (toolId === "project.ship") {
    const files = Array.isArray(inputs.files)
      ? inputs.files.filter((f): f is string => typeof f === "string")
      : [];
    const message = typeof inputs.message === "string" ? inputs.message : "";
    const branch = typeof inputs.branch === "string" && inputs.branch.trim().length > 0
      ? inputs.branch
      : "(auto-generated branch)";
    const push = inputs.push !== false;
    const createPR = inputs.createPR !== false;
    const fileList = files.length <= 4
      ? files.join(", ")
      : `${files.slice(0, 4).join(", ")}, +${files.length - 4} more`;
    const steps = ["stage", "commit"];
    if (push) steps.push("push");
    if (createPR) steps.push("draft PR");
    return `ship [${fileList}] → "${message}" on ${branch} → ${steps.join(" → ")}`;
  }
  return toolId;
}

export interface PendingApproval {
  runId: string;
  toolCallId: string;
  toolId: string;
  action: string;
  risk: string;
  scope: string;
}

type ApprovalSubscriber = (pending: PendingApproval | null) => void;

export class ApprovalBridge {
  private _resolver: ((approved: boolean) => void) | null = null;
  private _pending: PendingApproval | null = null;
  private _subscribers: Set<ApprovalSubscriber> = new Set();

  /**
   * Called by ExecutionGateway via onApprovalRequired.
   * Returns a promise that resolves when the human decides.
   * The gateway awaits this — the same execution continues after resolution.
   */
  request(request: ExecutionRequest, risk: RiskAssessment | null): Promise<boolean> {
    // If there's already a pending approval, deny it (shouldn't happen, but fail safe)
    if (this._resolver) {
      this._resolver(false);
      this._resolver = null;
    }

    const action = risk
      ? `${request.inputs.command ?? ""} ${(request.inputs.args as string[] ?? []).join(" ")}`.trim()
      : describeToolAction(request.toolId, request.inputs);

    this._pending = {
      runId: request.runId ?? "",
      toolCallId: request.toolCallId ?? "",
      toolId: request.toolId,
      action: action || request.toolId,
      risk: risk?.level ?? "elevated",
      scope: "project",
    };

    // Set the resolver BEFORE notifying subscribers.
    // If a subscriber synchronously calls decide(), the resolver must
    // already be installed or the promise will never resolve.
    return new Promise<boolean>((resolve) => {
      this._resolver = resolve;
      this._notify();
    });
  }

  /**
   * Called by the UI when the human presses Approve/Deny.
   * Resolves the pending gateway promise.
   */
  decide(approved: boolean): void {
    if (this._resolver) {
      this._resolver(approved);
      this._resolver = null;
    }
    this._pending = null;
    this._notify();
  }

  /** The current pending approval, or null. */
  get pending(): PendingApproval | null {
    return this._pending;
  }

  /** Subscribe to pending-approval changes. Returns unsubscribe. */
  subscribe(fn: ApprovalSubscriber): () => void {
    this._subscribers.add(fn);
    return () => { this._subscribers.delete(fn); };
  }

  /** Cancel any pending approval (e.g. on Ctrl+C). Resolves with false (deny). */
  cancel(): void {
    this.decide(false);
  }

  private _notify(): void {
    for (const fn of this._subscribers) {
      try { fn(this._pending); } catch { /* subscribers must not crash the bridge */ }
    }
  }
}
