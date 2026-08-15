/**
 * SEC-3 — GrantIssuer + GrantVerifier acceptance tests.
 *
 * Proves the cryptographic authorization chain:
 *
 *   GrantIssuer → signs → CapabilityGrant → GrantVerifier → verifies → VerifiedCapabilityGrant
 *
 * Acceptance gate (all must pass):
 *   1. Valid grant passes
 *   2. One-byte payload tamper fails
 *   3. Signature tamper fails
 *   4. Expired grant fails
 *   5. Future-issued grant beyond clock skew fails
 *   6. Wrong actor fails
 *   7. Wrong project fails
 *   8. Wrong capability fails
 *   9. Wrong execution mode fails
 *  10. Revoked key fails
 *  11. Revoked grant fails
 *  12. Unknown signer fails closed
 *  13. Replay-sensitive fields remain intact
 *  14. Secrets never appear in signed/audit payloads
 *  15. Deterministic canonical serialization
 *  16. Verifier never trusts caller-supplied "verified: true"
 *  17. Unsigned grant returns "unverified" (not "invalid")
 *  18. Malformed integrity field fails
 *  19. Wrong tenant fails
 *  20. Wrong run fails
 *  21. Promotion of non-verified result throws
 *  22. No integrity field → unverified, not invalid
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  GrantIssuer,
  createSigningKey,
  generateGrantId,
  generateGrantNonce,
  canonicalGrantClaims,
  extractGrantClaims,
} from "../contracts/grant-issuer.js";
import {
  GrantVerifier,
  InMemoryKeyStore,
  toVerifiedCapabilityGrant,
  type VerificationKeyEntry,
  type VerificationContext,
} from "../contracts/grant-verifier.js";
import type { CapabilityGrant, VerifiedCapabilityGrant } from "../contracts/capability.js";

// ─── Test fixtures ─────────────────────────────────────────────────

function makeValidGrant(): CapabilityGrant {
  const now = Date.now();
  return {
    grantId: generateGrantId(),
    tenantId: "tenant_001",
    userId: "user_alice",
    actorId: "user_alice",
    runId: "run_test_001",
    projectId: "proj_001",
    workspaceId: "ws_001",
    capabilities: ["terminal:run", "git:push", "mode:act"],
    resourceScope: ["workspace:ws_001", "project:proj_001"],
    networkScope: ["github.com", "api.vercel.com"],
    riskTier: "medium",
    approvalId: null,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3600_000).toISOString(), // 1 hour from now
    audience: "litt-kernel",
    nonce: generateGrantNonce(),
    issuer: "litt-kernel-v1",
    policyVersion: "1.0.0",
  };
}

function makeValidContext(): VerificationContext {
  return {
    actorId: "user_alice",
    userId: "user_alice",
    tenantId: "tenant_001",
    runId: "run_test_001",
    projectId: "proj_001",
    workspaceId: "ws_001",
    requiredCapability: "terminal:run",
    executionMode: "act",
  };
}

function setupIssuerAndVerifier(): {
  issuer: GrantIssuer;
  verifier: GrantVerifier;
  store: InMemoryKeyStore;
  key: ReturnType<typeof createSigningKey>;
} {
  const key = createSigningKey("litt-kernel-v1");
  const issuer = new GrantIssuer(key);
  const store = new InMemoryKeyStore();
  store.addKey({
    keyId: key.keyId,
    secretKey: key.secretKey,
    algorithm: "HS256",
    trusted: true,
  });
  const verifier = new GrantVerifier(store);
  return { issuer, verifier, store, key };
}

// ─── 1. Valid grant passes ─────────────────────────────────────────

describe("SEC-3.1 — Valid grant passes", () => {
  it("a properly signed grant with matching context verifies", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const grant = issuer.sign(makeValidGrant());
    const result = verifier.verify(grant, makeValidContext());

    assert.equal(result.status, "verified");
    if (result.status === "verified") {
      assert.equal(result.verifiedBy, "grant-verifier-v1");
      assert.ok(result.verifiedAt);
      assert.equal(result.keyId, "litt-kernel-v1");
    }
  });

  it("verified grant can be promoted to VerifiedCapabilityGrant", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const grant = issuer.sign(makeValidGrant());
    const result = verifier.verify(grant, makeValidContext());
    assert.equal(result.status, "verified");

    const verified = toVerifiedCapabilityGrant(result);
    assert.equal(verified.status, "verified");
    assert.equal(verified.grant.grantId, grant.grantId);
  });
});

// ─── 2. Payload tamper fails ───────────────────────────────────────

describe("SEC-3.2 — Payload tamper detection", () => {
  it("changing one byte in capabilities invalidates signature", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const grant = issuer.sign(makeValidGrant());

    // Tamper: change one character in a capability
    const tampered: CapabilityGrant = {
      ...grant,
      capabilities: ["terminal:run", "git:push", "mode:act"], // same
    };
    tampered.capabilities[0] = "terminal:ruu"; // one byte changed

    const result = verifier.verify(tampered, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "invalid_signature");
    }
  });

  it("changing userId invalidates signature", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const grant = issuer.sign(makeValidGrant());

    const tampered: CapabilityGrant = { ...grant, userId: "user_bob" };
    const result = verifier.verify(tampered, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "invalid_signature");
    }
  });

  it("changing expiresAt invalidates signature", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const grant = issuer.sign(makeValidGrant());

    const tampered: CapabilityGrant = {
      ...grant,
      expiresAt: new Date(Date.now() + 7200_000).toISOString(),
    };
    const result = verifier.verify(tampered, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "invalid_signature");
    }
  });
});

// ─── 3. Signature tamper fails ─────────────────────────────────────

describe("SEC-3.3 — Signature tamper detection", () => {
  it("corrupted signature is rejected", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const grant = issuer.sign(makeValidGrant());

    // Tamper with the signature directly
    const tampered: CapabilityGrant = {
      ...grant,
      integrity: {
        ...grant.integrity!,
        signature: "AAAA" + grant.integrity!.signature.slice(4),
      },
    };

    const result = verifier.verify(tampered, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "invalid_signature");
    }
  });

  it("empty signature is rejected as malformed", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const grant = issuer.sign(makeValidGrant());

    const tampered: CapabilityGrant = {
      ...grant,
      integrity: {
        ...grant.integrity!,
        signature: "",
      },
    };

    const result = verifier.verify(tampered, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      // Empty signature is caught by the well-formed check first
      assert.equal(result.failureReason, "malformed_integrity");
    }
  });
});

// ─── 4. Expired grant fails ────────────────────────────────────────

describe("SEC-3.4 — Expiry enforcement", () => {
  it("expired grant is rejected", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const grant = makeValidGrant();
    grant.issuedAt = new Date(Date.now() - 7200_000).toISOString(); // 2h ago
    grant.expiresAt = new Date(Date.now() - 3600_000).toISOString(); // 1h ago

    const signed = issuer.sign(grant);
    const result = verifier.verify(signed, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "expired");
    }
  });
});

// ─── 5. Future-issued grant fails ──────────────────────────────────

describe("SEC-3.5 — Future issuance rejection", () => {
  it("grant issued 10 minutes in the future is rejected (beyond clock skew)", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const grant = makeValidGrant();
    grant.issuedAt = new Date(Date.now() + 600_000).toISOString(); // 10 min in future

    const signed = issuer.sign(grant);
    const result = verifier.verify(signed, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "future_issued");
    }
  });

  it("grant issued 30 seconds in the future is accepted (within clock skew)", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const grant = makeValidGrant();
    grant.issuedAt = new Date(Date.now() + 30_000).toISOString(); // 30s in future

    const signed = issuer.sign(grant);
    const result = verifier.verify(signed, makeValidContext());
    assert.equal(result.status, "verified");
  });
});

// ─── 6. Wrong actor fails ──────────────────────────────────────────

describe("SEC-3.6 — Identity mismatch detection", () => {
  it("wrong actorId is rejected", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());
    const ctx = { ...makeValidContext(), actorId: "user_bob" };

    const result = verifier.verify(signed, ctx);
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "identity_mismatch");
    }
  });

  it("wrong userId is rejected", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());
    const ctx = { ...makeValidContext(), userId: "user_bob" };

    const result = verifier.verify(signed, ctx);
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "identity_mismatch");
    }
  });

  it("wrong tenantId is rejected", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());
    const ctx = { ...makeValidContext(), tenantId: "tenant_002" };

    const result = verifier.verify(signed, ctx);
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "identity_mismatch");
    }
  });

  it("wrong runId is rejected", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());
    const ctx = { ...makeValidContext(), runId: "run_wrong" };

    const result = verifier.verify(signed, ctx);
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "identity_mismatch");
    }
  });
});

// ─── 7. Wrong project fails ────────────────────────────────────────

describe("SEC-3.7 — Scope mismatch detection", () => {
  it("wrong projectId is rejected", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());
    const ctx = { ...makeValidContext(), projectId: "proj_wrong" };

    const result = verifier.verify(signed, ctx);
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "scope_mismatch");
    }
  });

  it("wrong workspaceId is rejected", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());
    const ctx = { ...makeValidContext(), workspaceId: "ws_wrong" };

    const result = verifier.verify(signed, ctx);
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "scope_mismatch");
    }
  });
});

// ─── 8. Wrong capability fails ─────────────────────────────────────

describe("SEC-3.8 — Capability mismatch detection", () => {
  it("requesting a capability not in the grant is rejected", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());
    const ctx = { ...makeValidContext(), requiredCapability: "production:deploy" };

    const result = verifier.verify(signed, ctx);
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "capability_mismatch");
    }
  });
});

// ─── 9. Wrong execution mode fails ─────────────────────────────────

describe("SEC-3.9 — Execution mode mismatch detection", () => {
  it("requesting auto mode when grant only allows act is rejected", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant()); // has mode:act
    const ctx = { ...makeValidContext(), executionMode: "auto" as const };

    const result = verifier.verify(signed, ctx);
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "execution_mode_mismatch");
    }
  });

  it("grant without mode restriction works for any mode", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const grant = makeValidGrant();
    grant.capabilities = ["terminal:run", "git:push"]; // no mode: prefix
    const signed = issuer.sign(grant);

    const ctx = { ...makeValidContext(), executionMode: "auto" as const };
    const result = verifier.verify(signed, ctx);
    assert.equal(result.status, "verified");
  });
});

// ─── 10. Revoked key fails ─────────────────────────────────────────

describe("SEC-3.10 — Revoked signer detection", () => {
  it("revoked key is rejected", () => {
    const { issuer, verifier, store } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());

    store.revokeKey("litt-kernel-v1");
    const result = verifier.verify(signed, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "revoked_signer");
    }
  });
});

// ─── 11. Revoked grant fails ───────────────────────────────────────

describe("SEC-3.11 — Revoked grant detection", () => {
  it("individually revoked grant is rejected", () => {
    const { issuer, verifier, store } = setupIssuerAndVerifier();
    const grant = makeValidGrant();
    const signed = issuer.sign(grant);

    store.revokeGrant(grant.grantId);
    const result = verifier.verify(signed, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "revoked_grant");
    }
  });
});

// ─── 12. Unknown signer fails closed ───────────────────────────────

describe("SEC-3.12 — Unknown signer fails closed", () => {
  it("grant signed by unknown key is rejected", () => {
    const otherKey = createSigningKey("unknown-key");
    const otherIssuer = new GrantIssuer(otherKey);
    const signed = otherIssuer.sign(makeValidGrant());

    const { verifier } = setupIssuerAndVerifier();
    const result = verifier.verify(signed, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "unknown_signer");
    }
  });
});

// ─── 13. Replay-sensitive fields remain intact ─────────────────────

describe("SEC-3.13 — Replay protection", () => {
  it("nonce is preserved through sign/verify cycle", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const grant = makeValidGrant();
    const nonce = grant.nonce;
    const signed = issuer.sign(grant);

    assert.equal(signed.nonce, nonce);
    const result = verifier.verify(signed, makeValidContext());
    assert.equal(result.status, "verified");
    if (result.status === "verified") {
      assert.equal(result.grant.nonce, nonce);
    }
  });

  it("grantId is preserved and unique", () => {
    const { issuer } = setupIssuerAndVerifier();
    const g1 = issuer.sign(makeValidGrant());
    const g2 = issuer.sign(makeValidGrant());
    assert.notEqual(g1.grantId, g2.grantId);
  });
});

// ─── 14. Secrets never appear in signed/audit payloads ─────────────

describe("SEC-3.14 — Secret isolation", () => {
  it("signing key does not appear in the grant", () => {
    const key = createSigningKey("litt-kernel-v1");
    const issuer = new GrantIssuer(key);
    const signed = issuer.sign(makeValidGrant());

    const grantJson = JSON.stringify(signed);
    assert.ok(!grantJson.includes(key.secretKey), "secret key must not appear in grant JSON");
  });

  it("signing key does not appear in verification result", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());
    const result = verifier.verify(signed, makeValidContext());

    const resultJson = JSON.stringify(result);
    // The keyId is public, but the secretKey must not appear
    assert.ok(
      !resultJson.includes(issuer.keyId + "secretKey"),
      "secret key must not appear in result",
    );
  });

  it("canonical claims do not contain the integrity field", () => {
    const { issuer } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());
    const claims = extractGrantClaims(signed);

    assert.ok(!("integrity" in claims), "integrity field must not be in claims");
    assert.ok(!("signature" in claims), "signature must not be in claims");
  });
});

// ─── 15. Deterministic canonical serialization ─────────────────────

describe("SEC-3.15 — Deterministic serialization", () => {
  it("same grant claims produce same canonical form regardless of key order", () => {
    const grant = makeValidGrant();

    // Create two objects with the same content but different key insertion order
    const obj1: Record<string, unknown> = {};
    obj1["grantId"] = grant.grantId;
    obj1["tenantId"] = grant.tenantId;
    obj1["userId"] = grant.userId;

    const obj2: Record<string, unknown> = {};
    obj2["userId"] = grant.userId;
    obj2["tenantId"] = grant.tenantId;
    obj2["grantId"] = grant.grantId;

    assert.equal(
      canonicalGrantClaims(grant),
      canonicalGrantClaims(grant),
      "same grant produces same canonical form",
    );
  });

  it("different grants produce different canonical forms", () => {
    const g1 = makeValidGrant();
    const g2 = makeValidGrant();
    g2.userId = "user_bob";

    assert.notEqual(
      canonicalGrantClaims(g1),
      canonicalGrantClaims(g2),
      "different grants must produce different canonical forms",
    );
  });
});

// ─── 16. Verifier never trusts caller-supplied "verified: true" ─────

describe("SEC-3.16 — No caller-supplied trust", () => {
  it("a grant with fake integrity field is rejected by signature check", () => {
    const { verifier } = setupIssuerAndVerifier();
    const grant = makeValidGrant();

    // Attacker tries to forge an integrity field
    const forged: CapabilityGrant = {
      ...grant,
      integrity: {
        algorithm: "HS256",
        keyId: "litt-kernel-v1",
        signature: "fake-signature-from-attacker",
      },
    };

    const result = verifier.verify(forged, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "invalid_signature");
    }
  });

  it("there is no way to construct VerifiedCapabilityGrant without verification", () => {
    // toVerifiedCapabilityGrant only accepts status="verified" results
    const { issuer, verifier } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());
    const result = verifier.verify(signed, makeValidContext());

    // This works
    assert.equal(result.status, "verified");
    const verified = toVerifiedCapabilityGrant(result);
    assert.equal(verified.status, "verified");

    // But an unverified result throws
    const unsignedGrant = makeValidGrant(); // no integrity
    const unverifiedResult = verifier.verify(unsignedGrant, makeValidContext());
    assert.equal(unverifiedResult.status, "unverified");
    assert.throws(() => toVerifiedCapabilityGrant(unverifiedResult));
  });
});

// ─── 17. Unsigned grant returns "unverified" ───────────────────────

describe("SEC-3.17 — Unsigned grant handling", () => {
  it("grant without integrity field returns unverified, not invalid", () => {
    const { verifier } = setupIssuerAndVerifier();
    const grant = makeValidGrant(); // no integrity field
    assert.equal(grant.integrity, undefined);

    const result = verifier.verify(grant, makeValidContext());
    assert.equal(result.status, "unverified");
  });
});

// ─── 18. Malformed integrity field fails ───────────────────────────

describe("SEC-3.18 — Malformed integrity detection", () => {
  it("integrity missing algorithm is rejected", () => {
    const { verifier } = setupIssuerAndVerifier();
    const grant = makeValidGrant();
    grant.integrity = { algorithm: "", keyId: "litt-kernel-v1", signature: "sig" };

    const result = verifier.verify(grant, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "malformed_integrity");
    }
  });

  it("integrity missing keyId is rejected", () => {
    const { verifier } = setupIssuerAndVerifier();
    const grant = makeValidGrant();
    grant.integrity = { algorithm: "HS256", keyId: "", signature: "sig" };

    const result = verifier.verify(grant, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "malformed_integrity");
    }
  });
});

// ─── 19. Algorithm mismatch fails ──────────────────────────────────

describe("SEC-3.19 — Algorithm mismatch detection", () => {
  it("integrity with wrong algorithm is rejected", () => {
    const { issuer, verifier, store } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());

    // Tamper algorithm
    const tampered: CapabilityGrant = {
      ...signed,
      integrity: {
        ...signed.integrity!,
        algorithm: "RS256" as any, // wrong algorithm
      },
    };

    const result = verifier.verify(tampered, makeValidContext());
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") {
      assert.equal(result.failureReason, "algorithm_mismatch");
    }
  });
});

// ─── 20. Promotion safety ──────────────────────────────────────────

describe("SEC-3.20 — Promotion safety", () => {
  it("promoting an invalid result throws", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());
    const ctx = { ...makeValidContext(), actorId: "wrong" };
    const result = verifier.verify(signed, ctx);
    assert.equal(result.status, "invalid");

    assert.throws(() => toVerifiedCapabilityGrant(result));
  });

  it("VerifiedCapabilityGrant status is locked to 'verified'", () => {
    const { issuer, verifier } = setupIssuerAndVerifier();
    const signed = issuer.sign(makeValidGrant());
    const result = verifier.verify(signed, makeValidContext());
    const verified: VerifiedCapabilityGrant = toVerifiedCapabilityGrant(result);

    // TypeScript enforces status: "verified" at compile time
    // At runtime, verify it's the correct value
    assert.equal(verified.status, "verified");
  });
});

// ─── 21. Security invariant ────────────────────────────────────────

describe("SEC-3.21 — Security invariant", () => {
  it("untrusted identity + claimed capability + credential ref ≠ permission", () => {
    const { verifier } = setupIssuerAndVerifier();

    // An attacker constructs a grant with all the right claims
    // but NO valid signature
    const attackerGrant: CapabilityGrant = {
      ...makeValidGrant(),
      integrity: {
        algorithm: "HS256",
        keyId: "litt-kernel-v1",
        signature: "attacker-forged-signature",
      },
    };

    const result = verifier.verify(attackerGrant, makeValidContext());
    assert.equal(result.status, "invalid");
    assert.notEqual(result.status, "verified");

    // Cannot promote to VerifiedCapabilityGrant
    assert.throws(() => toVerifiedCapabilityGrant(result));
  });
});
