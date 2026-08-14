/**
 * SEC-3 — GrantIssuer: cryptographically signs CapabilityGrant claims.
 *
 * The GrantIssuer is the ONLY entity that can produce a valid signature
 * over a grant. It holds a signing key and binds:
 *
 *   grantId, actor/user, project, capability, execution mode, scope,
 *   issued-at, expiry, issuer/key ID
 *
 * The signature is computed over the canonical JSON serialization of
 * the grant claims (excluding the integrity field itself), using
 * HMAC-SHA256. This provides:
 *
 *   - Tamper detection: any change to claims invalidates the signature
 *   - Issuer authenticity: only the key holder can sign
 *   - Deterministic serialization: canonicalJSON prevents key-reorder attacks
 *
 * CRITICAL: The GrantIssuer does NOT verify grants. It only signs them.
 * Verification is the job of GrantVerifier. The issuer and verifier
 * may use the same key (symmetric HMAC) or different keys (asymmetric,
 * future Ed25519 support).
 *
 * Security invariants:
 *   - Secrets (signing keys) never appear in grants, signatures, or audit logs
 *   - The signature covers ALL grant fields except `integrity`
 *   - The canonical serialization is deterministic (sorted keys)
 *   - The issuer never self-approves — signing is not authorization
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CapabilityGrant, GrantIntegrity } from "./capability.js";
import { canonicalJSON } from "./approval.js";

// ─── Signing key ───────────────────────────────────────────────────

/**
 * A signing key for GrantIssuer.
 *
 * The key material is held in memory and never serialized. The keyId
 * is the public identifier that GrantVerifier uses to look up the
 * correct verification key.
 */
export interface SigningKey {
  /** Public key identifier (e.g. "litt-kernel-v1") */
  keyId: string;
  /** Secret signing key (HMAC-SHA256 key, min 32 bytes) */
  secretKey: string;
  /** Signature algorithm */
  algorithm: "HS256";
}

/**
 * Create a signing key with a generated secret.
 * The secret is 32 bytes of cryptographically random data, base64-encoded.
 */
export function createSigningKey(keyId: string): SigningKey {
  return {
    keyId,
    secretKey: randomBytes(32).toString("base64"),
    algorithm: "HS256",
  };
}

// ─── Grant claims canonicalization ─────────────────────────────────

/**
 * Extract the claims from a grant that are covered by the signature.
 *
 * The `integrity` field is EXCLUDED — it contains the signature itself
 * and cannot be self-referential.
 *
 * All other fields are included: grantId, tenantId, userId, actorId,
 * runId, projectId, workspaceId, capabilities, resourceScope,
 * networkScope, riskTier, budget, approvalId, issuedAt, expiresAt,
 * audience, nonce, issuer, policyVersion.
 */
export function extractGrantClaims(grant: CapabilityGrant): Record<string, unknown> {
  const { integrity: _integrity, ...claims } = grant;
  return claims as Record<string, unknown>;
}

/**
 * Compute the canonical serialization of grant claims.
 *
 * Uses canonicalJSON (sorted keys, deterministic) to prevent key-reorder
 * attacks. The same claims always produce the same serialization.
 */
export function canonicalGrantClaims(grant: CapabilityGrant): string {
  return canonicalJSON(extractGrantClaims(grant));
}

// ─── GrantIssuer ───────────────────────────────────────────────────

/**
 * The canonical grant issuer.
 *
 * Signs CapabilityGrant claims with HMAC-SHA256. The signature is
 * stored in grant.integrity.
 *
 * Usage:
 *   const issuer = new GrantIssuer(signingKey);
 *   const signedGrant = issuer.sign(grant);
 *   // grant.integrity is now populated
 *
 * The issuer does NOT:
 *   - Verify grants (that's GrantVerifier's job)
 *   - Authorize execution (that's the policy engine's job)
 *   - Self-approve (signing ≠ permission)
 */
export class GrantIssuer {
  private readonly _key: SigningKey;

  constructor(key: SigningKey) {
    if (key.secretKey.length < 32) {
      throw new Error("Signing key must be at least 32 characters");
    }
    this._key = key;
  }

  /** The public key ID associated with this issuer. */
  get keyId(): string {
    return this._key.keyId;
  }

  /** The signature algorithm used by this issuer. */
  get algorithm(): string {
    return this._key.algorithm;
  }

  /**
   * Sign a CapabilityGrant, populating the `integrity` field.
   *
   * If the grant already has an integrity field, it is replaced.
   * The grant's `issuer` field is set to the key ID if not already set.
   *
   * Returns a NEW grant object with the integrity field populated.
   * The original grant is not mutated.
   */
  sign(grant: CapabilityGrant): CapabilityGrant {
    // Set issuer to keyId if not already set
    const grantWithIssuer: CapabilityGrant = grant.issuer
      ? grant
      : { ...grant, issuer: this._key.keyId };

    // Compute canonical claims (excluding integrity)
    const canonical = canonicalGrantClaims(grantWithIssuer);

    // Compute HMAC-SHA256 signature
    const signature = this.computeSignature(canonical);

    const integrity: GrantIntegrity = {
      algorithm: this._key.algorithm,
      keyId: this._key.keyId,
      signature,
    };

    return { ...grantWithIssuer, integrity };
  }

  /**
   * Compute the HMAC-SHA256 signature over canonical claims.
   * Used internally and exposed for testing.
   */
  computeSignature(canonicalClaims: string): string {
    const hmac = createHmac("sha256", this._key.secretKey);
    hmac.update(canonicalClaims);
    return hmac.digest("base64");
  }

  /**
   * Verify that a signature matches the canonical claims.
   * This is a low-level check — use GrantVerifier for full verification.
   */
  verifySignature(canonicalClaims: string, signature: string): boolean {
    const expected = this.computeSignature(canonicalClaims);
    return safeEqual(expected, signature);
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

/**
 * Generate a cryptographically random nonce for replay prevention.
 */
export function generateGrantNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Generate a unique grant ID.
 */
export function generateGrantId(): string {
  return `grant_${Date.now()}_${randomBytes(4).toString("hex")}`;
}
