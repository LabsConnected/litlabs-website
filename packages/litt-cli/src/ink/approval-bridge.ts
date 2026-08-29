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
import { normalizeCommand } from "@litt/agent-core";

export interface PendingApproval {
  runId: string;
  toolCallId: string;
  toolId: string;
  action: string;
  risk: string;
  scope: string;
  /** Epoch ms when this approval was requested — drives the wait timer. */
  createdAt: number;
  /** Total approvals pending (this one + queued behind it). */
  depth: number;
}

/** How far a decision applies: just this call, or the command class for the session. */
export type ApprovalScope = "once" | "session";

interface QueuedApproval {
  pending: PendingApproval;
  resolve: (approved: boolean) => void;
}

type ApprovalSubscriber = (pending: PendingApproval | null) => void;

/**
 * Command-class key for "approve similar" session grants.
 *
 * The class is (toolId, first command token) — e.g. `run_shell` +
 * `where` covers `where bash 2>&1` and `where git` but NOT `npm run x`.
 * Extension suffixes are normalized so `where.exe` and `where` share a
 * class. Destructive/dangerous actions NEVER become session grants.
 */
function grantKey(toolId: string, action: string): string {
  const firstToken = normalizeCommand(action.trim().split(/\s+/)[0] ?? "");
  return `${toolId}::${firstToken}`;
}

export class ApprovalBridge {
  private _queue: QueuedApproval[] = [];
  private _pending: PendingApproval | null = null;
  private _subscribers: Set<ApprovalSubscriber> = new Set();
  /** Session-scope grants from "approve similar" — auto-approved for the rest of the session. */
  private _sessionGrants: Set<string> = new Set();

  /**
   * Called by ExecutionGateway via onApprovalRequired.
   * Returns a promise that resolves when the human decides.
   * The gateway awaits this — the same execution continues after resolution.
   *
   * If the user already granted a session-scope approval for this exact
   * command class, the request resolves immediately (true) with no UI.
   * If another approval is already pending, this one QUEUES behind it —
   * it never silently denies or replaces the earlier request.
   */
  request(request: ExecutionRequest, risk: RiskAssessment | null): Promise<boolean> {
    const action = risk
      ? `${request.inputs.command ?? ""} ${(request.inputs.args as string[] ?? []).join(" ")}`.trim()
      : request.toolId;

    // Session grant — resolve immediately, no human round-trip.
    const key = grantKey(request.toolId, action);
    if (this._sessionGrants.has(key)) {
      return Promise.resolve(true);
    }

    const createdAt = Date.now();
    const pending: PendingApproval = {
      runId: request.runId ?? "",
      toolCallId: request.toolCallId ?? "",
      toolId: request.toolId,
      action: action || request.toolId,
      risk: risk?.level ?? "elevated",
      scope: "project",
      createdAt,
      depth: 0, // filled below
    };

    return new Promise<boolean>((resolve) => {
      this._queue.push({ pending, resolve });
      this._advance();
    });
  }

  /** Shift the next queued approval into the pending slot and notify. */
  private _advance(): void {
    if (this._queue.length > 0) {
      const head = this._queue[0]!;
      head.pending.depth = this._queue.length;
      this._pending = head.pending;
    } else {
      this._pending = null;
    }
    this._notify();
  }

  /**
   * Called by the UI when the human presses Approve/Deny.
   * Resolves the pending gateway promise. `session` scope records a
   * command-class grant so identical safe-class requests stop prompting.
   */
  decide(approved: boolean, scope: ApprovalScope = "once"): void {
    const head = this._queue.shift();
    if (head) {
      if (approved && scope === "session" && head.pending.risk !== "dangerous") {
        this._sessionGrants.add(grantKey(head.pending.toolId, head.pending.action));
      }
      head.resolve(approved);
    }
    this._advance();
  }

  /** The current pending approval, or null. */
  get pending(): PendingApproval | null {
    return this._pending;
  }

  /** Total approvals waiting (current + queued). */
  get depth(): number {
    return this._queue.length;
  }

  /** True when this exact command class is session-approved. */
  hasSessionGrant(toolId: string, action: string): boolean {
    return this._sessionGrants.has(grantKey(toolId, action));
  }

  /** Subscribe to pending-approval changes. Returns unsubscribe. */
  subscribe(fn: ApprovalSubscriber): () => void {
    this._subscribers.add(fn);
    return () => { this._subscribers.delete(fn); };
  }

  /** Cancel ALL pending approvals (e.g. on Esc/Ctrl+C). Resolves each with false (deny). */
  cancel(): void {
    const queue = this._queue.splice(0);
    for (const entry of queue) {
      entry.resolve(false);
    }
    this._advance();
  }

  private _notify(): void {
    for (const fn of this._subscribers) {
      try { fn(this._pending); } catch { /* subscribers must not crash the bridge */ }
    }
  }
}
