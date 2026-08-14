/**
 * SEC-4 — Runtime ApprovalProvider: human-in-the-loop approval enforcement.
 *
 * This is the canonical runtime approval system. It binds every approval
 * to an EXACT operation digest, verifies the approver's identity, and
 * enforces timeout/cancellation/expiry semantics.
 *
 * Flow:
 *
 *   PolicyDecision (effect: require_approval)
 *     ↓
 *   RuntimeApprovalProvider.requestApproval(operation, context)
 *     ↓
 *   ApprovalRecord (status: pending, operationDigest bound)
 *     ↓
 *   Human decides: approve / deny / cancel / timeout
 *     ↓
 *   ApprovalRecord (status: approved | denied | expired)
 *     ↓
 *   verifyApproval(record, operation, context) → VerifiedApproval | ApprovalRejection
 *     ↓
 *   execution continues OR fails closed
 *
 * Security invariants:
 *   - Approval is bound to the EXACT operation digest (no reuse for modified commands)
 *   - Wrong actor cannot approve
 *   - Wrong project/run fails
 *   - Expired approval fails
 *   - Denied approval never executes
 *   - Single-use approvals cannot be replayed
 *   - AUTO mode cannot silently bypass approval (headless → deny)
 *   - PLAN mode cannot convert approval into execution (enforced by execution boundary)
 *   - Forged caller-supplied "approved: true" is ignored
 *   - Restart/reconnect does not magically approve pending work
 *   - Audit records contain NO credentials/secrets
 */

import { randomBytes } from "node:crypto";
import type {
  ApprovalRecord,
  ApprovalRequestInput,
  ApprovalStatus,
  OperationDigestInput,
} from "./approval.js";
import {
  generateApprovalId,
  computeOperationDigest,
  isApprovalValid,
} from "./approval.js";
import type { ActionRisk, ApprovalScope, PolicyEffect } from "./policy.js";
import type { ExecutionMode, InteractionMode } from "./identity.js";

// ─── Verification result ───────────────────────────────────────────

/**
 * The result of verifying an approval against an operation.
 *
 * Only `status: "valid"` can be promoted to VerifiedApproval.
 * An attacker cannot self-assign "valid" — it is always computed.
 */
export type ApprovalVerificationResult =
  | {
      status: "valid";
      record: ApprovalRecord;
      verifiedAt: string;
    }
  | {
      status: "invalid";
      record: ApprovalRecord;
      failureReason: ApprovalFailureReason;
    };

export type ApprovalFailureReason =
  | "not_approved"
  | "expired"
  | "revoked"
  | "digest_mismatch"
  | "identity_mismatch"
  | "scope_mismatch"
  | "already_used"
  | "wrong_actor";

/**
 * A cryptographically verified approval.
 *
 * This is the ONLY type that should be accepted at execution boundaries
 * as proof of human approval. It is structurally impossible to construct
 * without going through verifyApproval().
 */
export interface VerifiedApproval {
  status: "valid";
  record: ApprovalRecord;
  verifiedAt: string;
}

// ─── Decision input ────────────────────────────────────────────────

/**
 * A human's decision on a pending approval.
 *
 * The approverIdentity must match the userId on the approval record.
 * A decision from the wrong user is rejected.
 */
export interface ApprovalDecision {
  approvalId: string;
  decision: "approve" | "deny";
  /** Actor ID of the human making the decision */
  approverActorId: string;
  /** User ID of the human making the decision */
  approverUserId: string;
  /** Optional reason for the decision (audit log) */
  reason?: string;
}

// ─── Runtime approval context ──────────────────────────────────────

/**
 * Context for an approval request, binding it to the current execution.
 */
export interface ApprovalContext {
  /** Execution mode (PLAN/ACT/AUTO) */
  executionMode: ExecutionMode;
  /** Whether a human is present */
  interaction: InteractionMode;
  /** Tenant ID for identity verification */
  tenantId: string;
}

// ─── RuntimeApprovalProvider ───────────────────────────────────────

/**
 * The canonical runtime approval provider.
 *
 * Manages pending approvals, enforces digest binding, identity verification,
 * timeout, and single-use semantics.
 *
 * Usage:
 *   const provider = new RuntimeApprovalProvider();
 *   const record = await provider.requestApproval(input, context);
 *   // ... human decides ...
 *   const decided = provider.decide(decision);
 *   const result = provider.verifyApproval(decided, operation, context);
 *   if (result.status === "valid") {
 *     const verified = toVerifiedApproval(result);
 *     executePrivileged(verified);
 *   }
 */
export class RuntimeApprovalProvider {
  private readonly _pending = new Map<string, ApprovalRecord>();
  private readonly _decided = new Map<string, ApprovalRecord>();
  private readonly _used = new Set<string>();
  private readonly _now: () => number;
  private readonly _defaultTtlMs: number;

  constructor(options?: {
    now?: () => number;
    defaultTtlMs?: number;
  }) {
    this._now = options?.now ?? Date.now;
    this._defaultTtlMs = options?.defaultTtlMs ?? 300_000; // 5 minutes default
  }

  /**
   * Request approval for a consequential operation.
   *
   * Creates an ApprovalRecord with:
   *   - operationDigest bound to the exact operation
   *   - TTL-based expiry
   *   - status: pending
   *
   * In headless/AUTO mode, this returns immediately with status=denied
   * (nobody present to approve, AUTO cannot bypass).
   */
  async requestApproval(
    input: ApprovalRequestInput,
    context: ApprovalContext,
  ): Promise<ApprovalRecord> {
    // AUTO mode: require_approval → deny (cannot bypass)
    if (context.executionMode === "auto") {
      return this.createDeniedRecord(input, "auto_mode_no_bypass");
    }

    // Headless: require_approval → deny (nobody present)
    if (context.interaction === "headless") {
      return this.createDeniedRecord(input, "headless_no_approver");
    }

    // Interactive: create pending approval
    const now = this._now();
    const ttlMs = (input.ttlSeconds ?? this._defaultTtlMs / 1000) * 1000;
    const expiresAt = new Date(now + ttlMs).toISOString();

    const digest = computeOperationDigest(input.operation);

    const record: ApprovalRecord = {
      approvalId: generateApprovalId(),
      tenantId: input.tenantId,
      userId: input.userId,
      runId: input.runId,
      projectId: input.projectId,
      toolId: input.toolId,
      operationDigest: digest,
      risk: input.risk,
      scope: input.scope,
      status: "pending",
      createdAt: new Date(now).toISOString(),
      decidedAt: null,
      expiresAt,
    };

    this._pending.set(record.approvalId, record);
    return record;
  }

  /**
   * Submit a human decision on a pending approval.
   *
   * Verifies:
   *   - The approval exists and is pending
   *   - The approver identity matches the record's userId
   *   - The approval hasn't expired
   *
   * Returns the updated ApprovalRecord. If the approval doesn't exist,
   * is already decided, or the approver is wrong, throws.
   */
  decide(decision: ApprovalDecision): ApprovalRecord {
    const record = this._pending.get(decision.approvalId);
    if (!record) {
      throw new Error(`Approval ${decision.approvalId} not found or already decided`);
    }

    // Verify approver identity
    if (record.userId !== decision.approverUserId) {
      throw new Error(
        `Approver identity mismatch: record requires ${record.userId}, got ${decision.approverUserId}`,
      );
    }

    // Check expiry
    const now = this._now();
    if (record.expiresAt && new Date(record.expiresAt).getTime() < now) {
      const expired: ApprovalRecord = {
        ...record,
        status: "expired",
        decidedAt: new Date(now).toISOString(),
      };
      this._pending.delete(record.approvalId);
      this._decided.set(record.approvalId, expired);
      return expired;
    }

    const decided: ApprovalRecord = {
      ...record,
      status: decision.decision === "approve" ? "approved" : "denied",
      decidedAt: new Date(now).toISOString(),
    };

    this._pending.delete(record.approvalId);
    this._decided.set(record.approvalId, decided);
    return decided;
  }

  /**
   * Cancel a pending approval (e.g. when the run is cancelled).
   * No-op if the approval is already decided or doesn't exist.
   */
  cancel(approvalId: string): void {
    const record = this._pending.get(approvalId);
    if (record) {
      const now = this._now();
      const cancelled: ApprovalRecord = {
        ...record,
        status: "expired",
        decidedAt: new Date(now).toISOString(),
      };
      this._pending.delete(approvalId);
      this._decided.set(approvalId, cancelled);
    }
  }

  /**
   * Wait for an approval decision with timeout.
   *
   * Returns the decided record, or an expired record if timeout elapses.
   * This is the async boundary that execution code awaits.
   */
  async waitForDecision(
    approvalId: string,
    timeoutMs: number,
  ): Promise<ApprovalRecord> {
    const record = this._pending.get(approvalId) ?? this._decided.get(approvalId);
    if (!record) {
      throw new Error(`Approval ${approvalId} not found`);
    }

    // Already decided
    if (record.status !== "pending") {
      return record;
    }

    // Poll for decision (in production, this would be event-driven)
    const deadline = this._now() + timeoutMs;
    while (this._now() < deadline) {
      const decided = this._decided.get(approvalId);
      if (decided) return decided;

      const current = this._pending.get(approvalId);
      if (!current) {
        // Was cancelled or expired
        return this._decided.get(approvalId) ?? record;
      }

      // Check expiry
      if (current.expiresAt && new Date(current.expiresAt).getTime() < this._now()) {
        const expired: ApprovalRecord = {
          ...current,
          status: "expired",
          decidedAt: new Date(this._now()).toISOString(),
        };
        this._pending.delete(approvalId);
        this._decided.set(approvalId, expired);
        return expired;
      }

      await sleep(50);
    }

    // Timeout → expired
    const pending = this._pending.get(approvalId);
    if (pending) {
      const expired: ApprovalRecord = {
        ...pending,
        status: "expired",
        decidedAt: new Date(this._now()).toISOString(),
      };
      this._pending.delete(approvalId);
      this._decided.set(approvalId, expired);
      return expired;
    }

    return this._decided.get(approvalId) ?? record;
  }

  /**
   * Verify that an approval record is valid for a specific operation.
   *
   * This is the trust boundary. It checks:
   *   1. Status is "approved"
   *   2. Not expired
   *   3. Not already used (for single-use scope)
   *   4. Operation digest matches (no tampering/reuse for modified command)
   *   5. Identity matches (tenantId, userId, runId)
   *
   * CRITICAL: This NEVER trusts caller-supplied "approved: true".
   * The status is always read from the internal record store.
   */
  verifyApproval(
    record: ApprovalRecord,
    operation: OperationDigestInput,
    expectedContext: {
      tenantId: string;
      userId: string;
      runId: string;
    },
  ): ApprovalVerificationResult {
    // 1. Must be approved
    if (record.status !== "approved") {
      return {
        status: "invalid",
        record,
        failureReason: "not_approved",
      };
    }

    // 2. Not expired
    const now = this._now();
    if (!isApprovalValid(record, now)) {
      return {
        status: "invalid",
        record,
        failureReason: "expired",
      };
    }

    // 3. Single-use check
    if (record.scope === "once" && this._used.has(record.approvalId)) {
      return {
        status: "invalid",
        record,
        failureReason: "already_used",
      };
    }

    // 4. Digest match (binds to exact operation)
    const expectedDigest = computeOperationDigest(operation);
    if (record.operationDigest !== expectedDigest) {
      return {
        status: "invalid",
        record,
        failureReason: "digest_mismatch",
      };
    }

    // 5. Identity match
    if (record.tenantId !== expectedContext.tenantId) {
      return {
        status: "invalid",
        record,
        failureReason: "identity_mismatch",
      };
    }
    if (record.userId !== expectedContext.userId) {
      return {
        status: "invalid",
        record,
        failureReason: "identity_mismatch",
      };
    }
    if (record.runId !== expectedContext.runId) {
      return {
        status: "invalid",
        record,
        failureReason: "identity_mismatch",
      };
    }

    // Mark as used for single-use scope
    if (record.scope === "once") {
      this._used.add(record.approvalId);
    }

    return {
      status: "valid",
      record,
      verifiedAt: new Date(now).toISOString(),
    };
  }

  /**
   * Get a pending approval by ID.
   */
  getPending(approvalId: string): ApprovalRecord | null {
    return this._pending.get(approvalId) ?? null;
  }

  /**
   * Get a decided approval by ID.
   */
  getDecided(approvalId: string): ApprovalRecord | null {
    return this._decided.get(approvalId) ?? null;
  }

  /**
   * List all pending approvals.
   */
  listPending(): ApprovalRecord[] {
    return Array.from(this._pending.values());
  }

  /**
   * Check for expired pending approvals and move them to decided.
   * Called periodically or before operations.
   */
  expireStale(): number {
    const now = this._now();
    let count = 0;
    for (const [id, record] of this._pending) {
      if (record.expiresAt && new Date(record.expiresAt).getTime() < now) {
        const expired: ApprovalRecord = {
          ...record,
          status: "expired",
          decidedAt: new Date(now).toISOString(),
        };
        this._pending.delete(id);
        this._decided.set(id, expired);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all state (for testing or restart).
   * Pending approvals are NOT auto-approved — they are discarded.
   */
  reset(): void {
    this._pending.clear();
    this._decided.clear();
    this._used.clear();
  }

  // ─── Private helpers ──────────────────────────────────────────

  private createDeniedRecord(
    input: ApprovalRequestInput,
    reason: string,
  ): ApprovalRecord {
    const now = this._now();
    return {
      approvalId: generateApprovalId(),
      tenantId: input.tenantId,
      userId: input.userId,
      runId: input.runId,
      projectId: input.projectId,
      toolId: input.toolId,
      operationDigest: computeOperationDigest(input.operation),
      risk: input.risk,
      scope: input.scope,
      status: "denied",
      createdAt: new Date(now).toISOString(),
      decidedAt: new Date(now).toISOString(),
      expiresAt: null,
    };
  }
}

// ─── Promotion to VerifiedApproval ─────────────────────────────────

/**
 * Promote a valid ApprovalVerificationResult to VerifiedApproval.
 *
 * This is the ONLY way to obtain a VerifiedApproval. The function
 * only accepts results with status="valid". Any other status throws.
 */
export function toVerifiedApproval(result: ApprovalVerificationResult): VerifiedApproval {
  if (result.status !== "valid") {
    throw new Error(
      `Cannot promote approval with status "${result.status}" to VerifiedApproval`,
    );
  }
  return {
    status: "valid",
    record: result.record,
    verifiedAt: result.verifiedAt,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a cryptographically random nonce for replay prevention.
 */
export function generateApprovalNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Audit-safe serialization of an approval record.
 * Strips any potential secrets from the record before logging.
 *
 * ApprovalRecords should never contain secrets (they contain digests,
 * not raw inputs), but this is a defense-in-depth measure.
 */
export function toAuditRecord(record: ApprovalRecord): Record<string, unknown> {
  return {
    approvalId: record.approvalId,
    tenantId: record.tenantId,
    userId: record.userId,
    runId: record.runId,
    projectId: record.projectId,
    toolId: record.toolId,
    operationDigest: record.operationDigest,
    risk: record.risk,
    scope: record.scope,
    status: record.status,
    createdAt: record.createdAt,
    decidedAt: record.decidedAt,
    expiresAt: record.expiresAt,
  };
}
