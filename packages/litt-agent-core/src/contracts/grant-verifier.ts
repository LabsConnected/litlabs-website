/**
 * SEC-3 — GrantVerifier: validates CapabilityGrant signatures and claims.
 *
 * The GrantVerifier is the trust boundary. It takes a CapabilityGrant
 * (possibly from an untrusted source) and produces a GrantVerificationResult.
 *
 * Only a grant with status="verified" can become a VerifiedCapabilityGrant,
 * which is the ONLY type accepted at privileged execution boundaries.
 *
 * Verification checks (in order):
 *   1. Integrity field present and well-formed
 *   2. Issuer/key is known and not revoked
 *   3. Signature algorithm matches expected
 *   4. Signature is cryptographically valid (tamper detection)
 *   5. Grant is not expired (expiresAt)
 *   6. Grant is not issued in the future beyond clock skew (issuedAt)
 *   7. Actor identity matches (actorId, userId, tenantId)
 *   8. Project/workspace scope matches
 *   9. Capability matches the requested action
 *  10. Execution mode matches
 *  11. Grant is not individually revoked
 *
 * CRITICAL: The verifier NEVER trusts caller-supplied `verified: true`.
 * The verification status is ALWAYS computed by the verifier, never
 * read from the grant itself.
 *
 * Security invariants:
 *   - Unknown signers fail closed (deny by default)
 *   - Revoked keys and grants are rejected
 *   - Secrets never appear in verification results or audit logs
 *   - Timing-safe comparison prevents timing attacks
 *   - The verifier is pure — it does not mutate the grant
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CapabilityGrant,
  GrantIntegrity,
  GrantVerificationResult,
  VerifiedCapabilityGrant,
} from "./capability.js";
import type { ExecutionMode } from "./identity.js";
import { canonicalGrantClaims } from "./grant-issuer.js";

// ─── Verification key store ────────────────────────────────────────

/**
 * A verification key entry.
 * The secret key is used to recompute the HMAC for comparison.
 */
export interface VerificationKeyEntry {
  keyId: string;
  secretKey: string;
  algorithm: "HS256";
  /** Whether this key is currently trusted (false = revoked) */
  trusted: boolean;
}

/**
 * A store of verification keys.
 *
 * The verifier consults this store to:
 *   - Look up the key by keyId
 *   - Check if the key is trusted (not revoked)
 *   - Get the secret key for signature recomputation
 *
 * Unknown keys fail closed — they are not in the store, so verification
 * returns `invalid` with failureReason "unknown_signer".
 */
export interface VerificationKeyStore {
  /** Get a key entry by keyId, or null if not found */
  get(keyId: string): VerificationKeyEntry | null;
  /** Check if a specific grant ID has been revoked */
  isGrantRevoked(grantId: string): boolean;
}

// ─── Verification context ──────────────────────────────────────────

/**
 * The context against which a grant is verified.
 *
 * This binds the grant to the CURRENT execution context. Even if the
 * signature is valid, the grant must match the current:
 *   - actor (actorId, userId, tenantId)
 *   - project/workspace
 *   - capability being requested
 *   - execution mode
 *
 * If any field doesn't match, verification fails with a specific reason.
 */
export interface VerificationContext {
  /** Expected actor ID */
  actorId: string;
  /** Expected user ID */
  userId: string;
  /** Expected tenant ID */
  tenantId: string;
  /** Expected run ID (the grant must be bound to this run) */
  runId: string;
  /** Expected project ID (or null if not project-scoped) */
  projectId: string | null;
  /** Expected workspace ID (or null if not workspace-scoped) */
  workspaceId: string | null;
  /** The capability being requested (e.g. "git:push", "terminal:run") */
  requiredCapability: string;
  /** The execution mode for this run */
  executionMode: ExecutionMode;
}

// ─── Clock skew tolerance ──────────────────────────────────────────

/**
 * Maximum clock skew tolerance for issuedAt checks (in milliseconds).
 *
 * A grant issued slightly in the future (due to clock drift) is accepted
 * if within this tolerance. Default: 60 seconds.
 */
const DEFAULT_CLOCK_SKEW_MS = 60_000;

// ─── GrantVerifier ─────────────────────────────────────────────────

/**
 * The canonical grant verifier.
 *
 * Takes a CapabilityGrant and a VerificationContext, produces a
 * GrantVerificationResult. Only `status: "verified"` results can be
 * promoted to VerifiedCapabilityGrant.
 *
 * Usage:
 *   const verifier = new GrantVerifier(keyStore);
 *   const result = verifier.verify(grant, context);
 *   if (result.status === "verified") {
 *     const verified = toVerifiedCapabilityGrant(result);
 *     executePrivileged(verified);
 *   }
 */
export class GrantVerifier {
  private readonly _store: VerificationKeyStore;
  private readonly _clockSkewMs: number;
  private readonly _now: () => number;

  constructor(
    store: VerificationKeyStore,
    options?: {
      clockSkewMs?: number;
      now?: () => number;
    },
  ) {
    this._store = store;
    this._clockSkewMs = options?.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
    this._now = options?.now ?? Date.now;
  }

  /**
   * Verify a CapabilityGrant against the given context.
   *
   * Returns a GrantVerificationResult:
   *   - status: "verified" → grant is valid and matches context
   *   - status: "invalid" → signature, scope, identity, or expiry check failed
   *   - status: "unverified" → no integrity field (Phase 1 in-process default)
   */
  verify(grant: CapabilityGrant, context: VerificationContext): GrantVerificationResult {
    // 0. No integrity field → unverified (Phase 1 default)
    if (!grant.integrity) {
      return {
        status: "unverified",
        grant,
        reason: "No integrity field — grant is not cryptographically signed",
      };
    }

    const integrity = grant.integrity;

    // 1. Integrity field well-formed
    if (!integrity.algorithm || !integrity.keyId || !integrity.signature) {
      return {
        status: "invalid",
        grant,
        failureReason: "malformed_integrity",
      };
    }

    // 2. Known and trusted signer
    const keyEntry = this._store.get(integrity.keyId);
    if (!keyEntry) {
      return {
        status: "invalid",
        grant,
        failureReason: "unknown_signer",
      };
    }
    if (!keyEntry.trusted) {
      return {
        status: "invalid",
        grant,
        failureReason: "revoked_signer",
      };
    }

    // 3. Algorithm match
    if (integrity.algorithm !== keyEntry.algorithm) {
      return {
        status: "invalid",
        grant,
        failureReason: "algorithm_mismatch",
      };
    }

    // 4. Signature valid (tamper detection)
    const canonical = canonicalGrantClaims(grant);
    const expectedSig = this.computeSignature(keyEntry.secretKey, canonical);
    if (!safeEqual(expectedSig, integrity.signature)) {
      return {
        status: "invalid",
        grant,
        failureReason: "invalid_signature",
      };
    }

    // 5. Not expired
    const now = this._now();
    const expiresAt = Date.parse(grant.expiresAt);
    if (isNaN(expiresAt)) {
      return {
        status: "invalid",
        grant,
        failureReason: "malformed_expiry",
      };
    }
    if (now > expiresAt) {
      return {
        status: "invalid",
        grant,
        failureReason: "expired",
      };
    }

    // 6. Not issued in the future (beyond clock skew)
    const issuedAt = Date.parse(grant.issuedAt);
    if (isNaN(issuedAt)) {
      return {
        status: "invalid",
        grant,
        failureReason: "malformed_issued_at",
      };
    }
    if (issuedAt > now + this._clockSkewMs) {
      return {
        status: "invalid",
        grant,
        failureReason: "future_issued",
      };
    }

    // 7. Identity match
    if (grant.actorId !== context.actorId) {
      return {
        status: "invalid",
        grant,
        failureReason: "identity_mismatch",
      };
    }
    if (grant.userId !== context.userId) {
      return {
        status: "invalid",
        grant,
        failureReason: "identity_mismatch",
      };
    }
    if (grant.tenantId !== context.tenantId) {
      return {
        status: "invalid",
        grant,
        failureReason: "identity_mismatch",
      };
    }
    if (grant.runId !== context.runId) {
      return {
        status: "invalid",
        grant,
        failureReason: "identity_mismatch",
      };
    }

    // 8. Scope match
    if (context.projectId !== null && grant.projectId !== context.projectId) {
      return {
        status: "invalid",
        grant,
        failureReason: "scope_mismatch",
      };
    }
    if (context.workspaceId !== null && grant.workspaceId !== context.workspaceId) {
      return {
        status: "invalid",
        grant,
        failureReason: "scope_mismatch",
      };
    }

    // 9. Capability match
    if (!grant.capabilities.includes(context.requiredCapability)) {
      return {
        status: "invalid",
        grant,
        failureReason: "capability_mismatch",
      };
    }

    // 10. Execution mode match
    // The grant's capabilities should include the execution mode as a
    // capability prefix (e.g. "mode:auto", "mode:act", "mode:plan").
    // Alternatively, if the grant has no mode capability, it's valid
    // for any mode (backward compatibility).
    const modeCapability = `mode:${context.executionMode}`;
    const hasModeRestriction = grant.capabilities.some((c) => c.startsWith("mode:"));
    if (hasModeRestriction && !grant.capabilities.includes(modeCapability)) {
      return {
        status: "invalid",
        grant,
        failureReason: "execution_mode_mismatch",
      };
    }

    // 11. Grant not individually revoked
    if (this._store.isGrantRevoked(grant.grantId)) {
      return {
        status: "invalid",
        grant,
        failureReason: "revoked_grant",
      };
    }

    // All checks passed → verified
    return {
      status: "verified",
      grant,
      verifiedBy: "grant-verifier-v1",
      verifiedAt: new Date(now).toISOString(),
      keyId: integrity.keyId,
    };
  }

  /**
   * Recompute the HMAC-SHA256 signature.
   */
  private computeSignature(secretKey: string, canonicalClaims: string): string {
    const hmac = createHmac("sha256", secretKey);
    hmac.update(canonicalClaims);
    return hmac.digest("base64");
  }
}

// ─── Promotion to VerifiedCapabilityGrant ──────────────────────────

/**
 * Promote a verified GrantVerificationResult to a VerifiedCapabilityGrant.
 *
 * This is the ONLY way to obtain a VerifiedCapabilityGrant. The function
 * only accepts results with status="verified". Any other status throws.
 *
 * This ensures that untrusted or invalid grants can NEVER structurally
 * enter privileged execution boundaries.
 */
export function toVerifiedCapabilityGrant(
  result: GrantVerificationResult,
): VerifiedCapabilityGrant {
  if (result.status !== "verified") {
    throw new Error(
      `Cannot promote grant with status "${result.status}" to VerifiedCapabilityGrant`,
    );
  }
  return {
    status: "verified",
    grant: result.grant,
    verifiedBy: result.verifiedBy,
    verifiedAt: result.verifiedAt,
    keyId: result.keyId,
  };
}

// ─── In-memory key store (for testing and simple deployments) ──────

/**
 * A simple in-memory verification key store.
 *
 * Suitable for testing and single-process deployments. Production
 * deployments should implement VerificationKeyStore with a persistent
 * backing store (database, KV, etc.).
 */
export class InMemoryKeyStore implements VerificationKeyStore {
  private readonly _keys = new Map<string, VerificationKeyEntry>();
  private readonly _revokedGrants = new Set<string>();

  addKey(entry: VerificationKeyEntry): void {
    this._keys.set(entry.keyId, entry);
  }

  revokeKey(keyId: string): void {
    const entry = this._keys.get(keyId);
    if (entry) {
      this._keys.set(keyId, { ...entry, trusted: false });
    }
  }

  revokeGrant(grantId: string): void {
    this._revokedGrants.add(grantId);
  }

  get(keyId: string): VerificationKeyEntry | null {
    return this._keys.get(keyId) ?? null;
  }

  isGrantRevoked(grantId: string): boolean {
    return this._revokedGrants.has(grantId);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Timing-safe string comparison.
 * Prevents timing attacks on signature verification.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "base64");
  const bufB = Buffer.from(b, "base64");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
