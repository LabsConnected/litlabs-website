import type { ActionRisk } from "./policy.js";

/**
 * Canonical capability contracts.
 *
 * A CapabilityGrant is a canonical grant claims structure that binds
 * capabilities to a run. It grants ABILITY, not credentials.
 *
 * Phase 1: in-process trusted server object. No cryptographic signing.
 * Phase 2/3: GrantIssuer + GrantVerifier can cryptographically verify
 * grants used by remote execution capsules without redesigning the
 * claims structure (the `integrity` field is reserved for this).
 *
 * A CapabilityHealth is a multi-dimensional health state vector,
 * replacing the single mixed enum (ready/offline/connecting/...) with
 * independent dimensions: lifecycle, auth, health, policy, quota.
 *
 * This is the ONE canonical source. The existing CapabilityRecord in
 * src/lib/litt-kernel/types.ts is a compatibility adapter.
 */

// ─── Capability grant ─────────────────────────────────────────────

/**
 * A canonical grant claims structure.
 *
 * Grants ability, not credentials. Credentials are obtained separately
 * via CredentialLease.
 *
 * Phase 1: in-process trusted server object. Not cryptographically signed.
 * The `integrity` field is reserved for future GrantIssuer/GrantVerifier
 * implementations that support remote execution capsules.
 *
 * Explicit allow semantics:
 *   - Scoped to actor + resource + operation
 *   - Optional expiration (expiresAt)
 *   - Revocable
 *   - Cannot silently escalate
 */
export interface CapabilityGrant {
  /** Unique grant ID */
  grantId: string;

  /** Tenant/organization ID */
  tenantId: string;
  /** User ID the grant is issued to */
  userId: string;
  /** Actor ID the grant is issued to */
  actorId: string;

  /** Run ID this grant is bound to */
  runId: string;
  /** Project ID if scoped to a project */
  projectId: string | null;
  /** Workspace ID if scoped to a workspace */
  workspaceId: string | null;

  /** Capabilities granted (e.g. ["git:push", "files:write", "terminal:run"]) */
  capabilities: string[];

  /** Resource scope (e.g. ["workspace:abc", "project:def"]) */
  resourceScope: string[];
  /** Network scope (e.g. ["github.com", "api.vercel.com"]) */
  networkScope: string[];

  /** Risk tier this grant permits */
  riskTier: ActionRisk;

  /** Budget limits for this grant */
  budget?: GrantBudget;

  /** Approval ID that authorized this grant, if approval was required */
  approvalId: string | null;

  /** ISO timestamp of issuance */
  issuedAt: string;
  /** ISO timestamp of expiration */
  expiresAt: string;

  /** Intended audience (e.g. "litt-kernel", "terminal-server") */
  audience: string;
  /** Cryptographic nonce for replay prevention */
  nonce: string;

  /** Issuer identity (e.g. "litt-kernel", "policy-engine") */
  issuer: string;
  /** Policy engine version that authorized this grant */
  policyVersion: string;

  /**
   * Optional integrity proof for remote/cross-process verification.
   *
   * Phase 1: undefined (in-process trusted object).
   * Phase 2/3: populated by GrantIssuer with a cryptographic signature
   * that GrantVerifier can check before accepting a grant from a remote
   * capsule or untrusted process boundary.
   */
  integrity?: GrantIntegrity;
}

// ─── Grant integrity (reserved for future cryptographic verification) ─

/**
 * Cryptographic integrity proof for a capability grant.
 *
 * Reserved for Phase 2/3 GrantIssuer/GrantVerifier. Not populated in
 * Phase 1 (in-process grants are trusted server objects).
 *
 * When populated, a GrantVerifier can confirm:
 *   - the grant claims were not tampered with
 *   - the grant was issued by the stated issuer
 *   - the grant is within its validity window
 *
 * CRITICAL: The presence of `integrity` on a grant does NOT mean the
 * grant has been verified. An attacker-controlled incoming grant can
 * populate this field with arbitrary values. Verification status is
 * produced by the GrantVerifier, not serialized inside the grant.
 *
 * Never do this:
 *   if (grant.integrity) { /* assume trusted *\/ }
 *
 * Instead, require a VerifiedCapabilityGrant (produced by GrantVerifier)
 * at any trust boundary that requires verified privileges.
 */
export interface GrantIntegrity {
  /** Signature algorithm (e.g. "Ed25519", "HS256") */
  algorithm: string;
  /** Key ID used to verify the signature */
  keyId: string;
  /** Cryptographic signature over the canonical grant claims */
  signature: string;
}

// ─── Grant verification status ────────────────────────────────────

/**
 * The status of a grant verification attempt.
 *
 * Produced by GrantVerifier, NOT serialized inside the grant itself.
 * An attacker-controlled incoming grant cannot self-assign "verified".
 *
 *   unverified: no verification attempted (Phase 1 in-process default)
 *   verified:   signature valid, issuer trusted, within validity window
 *   invalid:    signature mismatch, unknown issuer, expired, or revoked
 */
export type GrantVerificationStatus = "unverified" | "verified" | "invalid";

/**
 * The full result of a grant verification attempt — a discriminated union.
 *
 * This is what GrantVerifier.verify() returns. It covers all three outcomes
 * (unverified, verified, invalid) and is NOT trusted at privileged boundaries.
 *
 * Flow:
 *   CapabilityGrant (claims, possibly from untrusted source)
 *     ↓
 *   GrantVerifier.verify(grant)
 *     ↓
 *   GrantVerificationResult (unverified | verified | invalid)
 *     ↓
 *   if verified → extract VerifiedCapabilityGrant
 *     ↓
 *   VerifiedCapabilityGrant (trusted, safe to use at boundaries)
 */
export type GrantVerificationResult =
  | {
      status: "verified";
      grant: CapabilityGrant;
      verifiedBy: string;
      verifiedAt: string;
      keyId?: string;
    }
  | {
      status: "unverified";
      grant: CapabilityGrant;
      reason?: string;
    }
  | {
      status: "invalid";
      grant: CapabilityGrant;
      failureReason: string;
    };

/**
 * A capability grant that has been CRYPTOGRAPHICALLY VERIFIED.
 *
 * This type is structurally impossible to construct without a successful
 * verification — `status` is locked to `"verified"`. An unverified or
 * invalid grant CANNOT be assigned to this type.
 *
 * This is the ONLY type that should be accepted at trust boundaries
 * requiring verified privileges:
 *
 *   function executePrivilegedAction(grant: VerifiedCapabilityGrant) {}
 *
 * An invalid/unverified grant cannot structurally enter that API.
 *
 * Phase 1: in-process grants produce GrantVerificationResult with
 * status="unverified". They do NOT magically become VerifiedCapabilityGrant.
 * Phase 2/3: GrantVerifier performs cryptographic signature validation
 * and returns status="verified" only when the signature is valid.
 */
export interface VerifiedCapabilityGrant {
  /** Locked to "verified" — this is the type-level guarantee */
  status: "verified";
  /** The original grant claims */
  grant: CapabilityGrant;
  /** Who verified the grant (e.g. "litt-kernel", "grant-verifier-v1") */
  verifiedBy: string;
  /** ISO timestamp of verification */
  verifiedAt: string;
  /** Key ID used for verification, if cryptographic */
  keyId?: string;
}

// ─── Grant budget ─────────────────────────────────────────────────

/**
 * Budget limits attached to a capability grant.
 */
export interface GrantBudget {
  /** Maximum USD spend */
  usd?: number;
  /** Maximum token usage */
  tokens?: number;
  /** Maximum runtime in seconds */
  durationSeconds?: number;
}

// ─── Capability health ────────────────────────────────────────────

/**
 * Multi-dimensional capability health state vector.
 *
 * Replaces the single mixed CapabilityState enum with independent
 * dimensions. The UI derives a single label from these dimensions.
 *
 * Dimensions:
 *   lifecycle: is the capability configured and running?
 *   auth:      is authentication valid?
 *   health:    is the provider reachable and responsive?
 *   policy:    is the capability enabled by policy?
 *   quota:     is there remaining quota/budget?
 */
export interface CapabilityHealth {
  /** Capability ID (e.g. "github", "terminal", "vercel") */
  id: string;

  /** Lifecycle state */
  lifecycle:
    | "unconfigured"
    | "initializing"
    | "ready"
    | "stopped";

  /** Authentication state */
  auth:
    | "none_required"
    | "authorized"
    | "reauth_required"
    | "scope_insufficient"
    | "revoked";

  /** Health state */
  health:
    | "healthy"
    | "degraded"
    | "down"
    | "unknown";

  /** Policy state */
  policy:
    | "enabled"
    | "approval_required"
    | "blocked";

  /** Quota state */
  quota:
    | "ok"
    | "rate_limited"
    | "budget_exhausted";

  /** ISO timestamp of last verification */
  verifiedAt: string | null;
  /** ISO timestamp when this health record became stale */
  staleAt: string | null;
  /** ISO timestamp when the underlying credential expires */
  expiresAt: string | null;

  /** Other capability IDs this capability depends on */
  dependencies: string[];
}

// ─── Health label derivation ──────────────────────────────────────

/**
 * User-facing health label derived from the multi-dimensional vector.
 *
 * Maps the internal state vector to the existing UI states:
 *   READY, CONNECTING, LIMITED, REQUIRES_APPROVAL, DEGRADED, OFFLINE, UNAVAILABLE, UNKNOWN
 */
export type CapabilityHealthLabel =
  | "ready"
  | "connecting"
  | "limited"
  | "requires_approval"
  | "degraded"
  | "offline"
  | "unavailable"
  | "unknown";

/**
 * Derive a user-facing health label from the multi-dimensional vector.
 *
 * Priority:
 *   1. unconfigured → unavailable
 *   2. blocked → unavailable
 *   3. down → offline
 *   4. revoked → offline
 *   5. approval_required → requires_approval
 *   6. initializing → connecting
 *   7. budget_exhausted → limited
 *   8. rate_limited → limited
 *   9. scope_insufficient → limited
 *   10. reauth_required → degraded
 *   11. degraded → degraded
 *   12. unknown → unknown
 *   13. ready + healthy + authorized + enabled + ok → ready
 */
export function deriveHealthLabel(h: CapabilityHealth): CapabilityHealthLabel {
  if (h.lifecycle === "unconfigured") return "unavailable";
  if (h.policy === "blocked") return "unavailable";
  if (h.health === "down") return "offline";
  if (h.auth === "revoked") return "offline";
  if (h.policy === "approval_required") return "requires_approval";
  if (h.lifecycle === "initializing") return "connecting";
  if (h.quota === "budget_exhausted") return "limited";
  if (h.quota === "rate_limited") return "limited";
  if (h.auth === "scope_insufficient") return "limited";
  if (h.auth === "reauth_required") return "degraded";
  if (h.health === "degraded") return "degraded";
  if (h.health === "unknown") return "unknown";
  if (
    h.lifecycle === "ready" &&
    h.auth === "authorized" &&
    h.health === "healthy" &&
    h.policy === "enabled" &&
    h.quota === "ok"
  ) {
    return "ready";
  }
  return "unknown";
}

// ─── Re-export types needed by CapabilityGrant ────────────────────
