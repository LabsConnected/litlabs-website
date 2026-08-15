/**
 * Canonical approval record contracts.
 *
 * An ApprovalRecord binds approval to an EXACT consequential operation.
 *
 * An unrelated message such as "yeah", "sure", or "okay" must NEVER
 * become approval unless explicitly attached to the pending approval ID.
 *
 * The operation digest binds approval to the full operation context:
 *   tenant, user, run, actor, tool, action, resource, environment, inputs.
 * Approving "deploy preview" cannot accidentally authorize "deploy production"
 * even if some inputs overlap.
 *
 * This is the ONE canonical source. The existing ApprovalRequest in
 * types.ts and the ApprovalRequest in litt-intelligence/approval-system.ts
 * are compatibility adapters.
 */

import type { ApprovalScope, ActionRisk, Environment } from "./policy.js";

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

// ─── Operation digest input ───────────────────────────────────────

/**
 * The full operation context that an approval binds to.
 *
 * The digest of this object uniquely identifies a consequential operation.
 * Changing ANY field produces a different digest, invalidating prior approval.
 *
 * This prevents:
 *   - approving "deploy preview" and having it authorize "deploy production"
 *   - approving for one actor and having it apply to another
 *   - approving for one resource and having it apply to another
 *   - key-reorder attacks producing different hashes for the same operation
 */
export interface OperationDigestInput {
  /** Tenant/organization ID */
  tenantId: string;
  /** User ID */
  userId: string;
  /** Actor ID making the request */
  actorId: string;
  /** Run ID */
  runId: string;
  /** Tool ID being approved */
  toolId: string;
  /** Action being performed (e.g. "git.push", "deploy") */
  action: string;
  /** Resource scope (e.g. ["workspace:abc", "project:def"]) */
  resourceScope: string[];
  /** Environment the action targets */
  environment: Environment;
  /** Normalized tool inputs */
  normalizedInput: Record<string, unknown>;
}

// ─── Approval record ──────────────────────────────────────────────

/**
 * A binding approval for an exact consequential operation.
 *
 * The operationDigest binds approval to the full operation context:
 * tenant, user, run, actor, tool, action, resource, environment, inputs.
 * Changing any of these produces a different digest, invalidating the approval.
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
  /** Digest of the full operation context (binds approval to exact operation) */
  operationDigest: string;

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
  /** Full operation context to digest */
  operation: OperationDigestInput;
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
 * Deterministic canonical JSON serialization.
 *
 * Produces a stable JSON string regardless of object key insertion order:
 *   - Object keys are sorted recursively (alphabetically)
 *   - Arrays preserve order (order is semantically significant)
 *   - Numbers, booleans, strings, null are preserved
 *   - undefined values are omitted (matching JSON.stringify behavior)
 *
 * This ensures that two structurally identical objects with different
 * key insertion orders produce the same serialized form, and therefore
 * the same digest.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]";
  }
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value).sort();
    const pairs = keys
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonicalJSON((value as Record<string, unknown>)[k]));
    return "{" + pairs.join(",") + "}";
  }
  return "null";
}

/**
 * Compute a deterministic operation digest.
 *
 * Binds approval to the EXACT consequential operation:
 *   tenant, user, run, actor, tool, action, resource, environment, inputs.
 *
 * Uses canonical JSON serialization so that key reordering does not
 * produce a different digest for the same logical operation.
 *
 * Changing any field produces a different digest, invalidating prior approval.
 */
export function computeOperationDigest(input: OperationDigestInput): string {
  const canonical = canonicalJSON(input);
  // FNV-1a hash for deterministic, portable digest.
  // Phase 2/3 may replace with SHA-256 when a crypto context is available.
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `op_${(hash >>> 0).toString(16)}`;
}

/**
 * Check if an approval is still valid (not expired, not revoked).
 */
export function isApprovalValid(approval: ApprovalRecord, now: number): boolean {
  if (approval.status !== "approved") return false;
  if (approval.expiresAt && new Date(approval.expiresAt).getTime() < now) return false;
  return true;
}
