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

/** File mutation tools: every call is reviewed — never covered by "approve similar". */
const FILE_MUTATION_TOOLS = new Set(["project.write_file", "project.edit_file"]);

/** May an approval for this tool/risk become a session-wide grant? */
export function allowsSessionGrant(toolId: string, risk: string): boolean {
  return risk !== "dangerous" && !FILE_MUTATION_TOOLS.has(toolId);
}

const PREVIEW_LINES = 8;
const PREVIEW_LINE_CHARS = 160;

function preview(text: string): string {
  const lines = text.split(/\r?\n/);
  const shown = lines.slice(0, PREVIEW_LINES).map((l) =>
    l.length > PREVIEW_LINE_CHARS ? `${l.slice(0, PREVIEW_LINE_CHARS - 1)}…` : l);
  if (lines.length > PREVIEW_LINES) shown.push(`… (${lines.length - PREVIEW_LINES} more lines)`);
  return shown.map((l) => `  │ ${l}`).join("\n");
}

/**
 * What the human is approving, in words. Shell commands show the command
 * line; file mutations show the path, size and a bounded preview — an
 * approval prompt that only names the tool is not informed consent.
 */
export function describeApprovalAction(request: ExecutionRequest, risk: RiskAssessment | null): string {
  const inputs = request.inputs ?? {};
  const path = typeof inputs.path === "string" ? inputs.path : "(no path)";
  if (request.toolId === "project.write_file") {
    const content = typeof inputs.content === "string" ? inputs.content : "";
    const bytes = Buffer.byteLength(content, "utf8");
    return `write ${path} (${bytes} bytes, ${content.split(/\r?\n/).length} lines)\n${preview(content)}`;
  }
  if (request.toolId === "project.edit_file") {
    const oldText = typeof inputs.old_string === "string" ? inputs.old_string : "";
    const newText = typeof inputs.new_string === "string" ? inputs.new_string : "";
    return `edit ${path}\n  replace:\n${preview(oldText)}\n  with:\n${preview(newText)}`;
  }
  if (risk) {
    return `${inputs.command ?? ""} ${(inputs.args as string[] ?? []).join(" ")}`.trim();
  }
  return request.toolId;
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
    const action = describeApprovalAction(request, risk);

    // Session grant — resolve immediately, no human round-trip.
    const key = grantKey(request.toolId, action);
    if (allowsSessionGrant(request.toolId, risk?.level ?? "elevated") && this._sessionGrants.has(key)) {
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
      if (approved && scope === "session" && allowsSessionGrant(head.pending.toolId, head.pending.risk)) {
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
