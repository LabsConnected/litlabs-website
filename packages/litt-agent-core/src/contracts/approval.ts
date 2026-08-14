/**
 * Canonical approval record contracts.
 *
 * An ApprovalRecord binds approval to an EXACT operation.
 *
 * An unrelated message such as "yeah", "sure", or "okay" must NEVER
 * become approval unless explicitly attached to the pending approval ID.
 *
 * This is the ONE canonical source. The existing ApprovalRequest in
 * types.ts and the ApprovalRequest in litt-intelligence/approval-system.ts
 * are compatibility adapters.
 */

import type { ApprovalScope } from "./policy.js";
import type { ActionRisk } from "./policy.js";

// ─── Approval status ──────────────────────────────────────────────

/**
 * The status of an approval request.
 *
 * pending: waiting for a decision
 * approved: user approved the exact operation
 * denied: user denied the operation
 * expired: approval window elapsed without a decision
 * revoked: approval was granted but later revoked
 */
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "revoked";

// ─── Approval record ──────────────────────────────────────────────

/**
 * A binding approval for an exact operation.
 *
 * The normalizedInputHash ensures that approval is tied to the specific
 * inputs, not just the tool name. Changing the inputs invalidates the approval.
 */
export interface ApprovalRecord {
  /** Unique approval ID */
  approvalId: string;

  /** Tenant/organization ID */
  tenantId: string;
  /** User ID who can approve/deny */
  userId: string;

  /** Run ID this approval belongs to */
  runId: string;
  /** Project ID if scoped to a project */
  projectId: string | null;

  /** Tool ID being approved */
  toolId: string;
  /** Hash of the normalized inputs (binds approval to exact operation) */
  normalizedInputHash: string;

  /** Risk tier of the operation */
  risk: ActionRisk;

  /** How long the approval remains valid */
  scope: ApprovalScope;

  /** Current status */
  status: ApprovalStatus;

  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of decision (approved/denied), if decided */
  decidedAt: string | null;
  /** ISO timestamp of expiration, if applicable */
  expiresAt: string | null;
}

// ─── Approval request (input to the approval system) ──────────────

/**
 * Request for approval of a specific operation.
 *
 * The approval system creates an ApprovalRecord from this request
 * and waits for a decision.
 */
export interface ApprovalRequestInput {
  /** Tenant/organization ID */
  tenantId: string;
  /** User ID who can approve/deny */
  userId: string;
  /** Run ID */
  runId: string;
  /** Project ID */
  projectId: string | null;
  /** Tool ID */
  toolId: string;
  /** Normalized inputs to hash */
  inputs: Record<string, unknown>;
  /** Risk tier */
  risk: ActionRisk;
  /** Approval scope */
  scope: ApprovalScope;
  /** TTL in seconds (after which the request expires) */
  ttlSeconds?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Generate an approval ID.
 */
export function generateApprovalId(): string {
  return `appr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Compute a normalized input hash.
 *
 * This binds approval to the exact operation inputs.
 * Changing any input produces a different hash, invalidating prior approval.
 */
export function computeInputHash(inputs: Record<string, unknown>): string {
  // Simple hash for now — Phase 2 will use SHA-256
  const json = JSON.stringify(inputs, Object.keys(inputs).sort());
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `h_${Math.abs(hash).toString(16)}`;
}

/**
 * Check if an approval is still valid (not expired, not revoked).
 */
export function isApprovalValid(approval: ApprovalRecord, now: number): boolean {
  if (approval.status !== "approved") return false;
  if (approval.expiresAt && new Date(approval.expiresAt).getTime() < now) return false;
  return true;
}
