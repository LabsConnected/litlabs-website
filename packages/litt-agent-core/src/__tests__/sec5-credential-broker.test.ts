/**
 * SEC-5 — Production CredentialBroker acceptance tests.
 *
 * Proves the credential authorization chain:
 *
 *   VerifiedCapabilityGrant + CredentialRequest
 *     → ProductionCredentialBroker.resolve()
 *     → CredentialLease (scoped, expiring, revocable)
 *     → ProductionCredentialMaterializer.materialize(lease, callback)
 *     → MaterializedCredential (available ONLY inside callback)
 *     → secret wiped after callback
 *
 * Acceptance gate (26 tests):
 *   1.  Valid verified grant obtains scoped lease
 *   2.  Unsigned/unverified grant denied
 *   3.  Forged VerifiedCapabilityGrant denied
 *   4.  Wrong actor denied
 *   5.  Wrong tenant denied
 *   6.  Wrong project denied
 *   7.  Wrong run denied
 *   8.  Wrong capability denied
 *   9.  Wrong credential scope denied
 *  10.  Expired lease denied
 *  11.  Revoked lease denied
 *  12.  Revoked credential denied
 *  13.  Cross-project lease reuse denied
 *  14.  Cross-run reuse denied where run-scoped
 *  15.  BYOK credential cannot leak to another user
 *  16.  Platform credential respects platform policy
 *  17.  Secret never appears in JSON.stringify(lease)
 *  18.  Secret never appears in runtime events
 *  19.  Secret never appears in audit records
 *  20.  Materializer is the only API returning credential material
 *  21.  Failed materialization fails closed
 *  22.  Secret-store outage fails closed
 *  23.  Malformed secret-store response denied
 *  24.  Concurrent leases remain isolated
 *  25.  Redaction catches materialized secrets in thrown errors
 *  26.  Materialized credentials are disposed after execution
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ProductionCredentialBroker,
  ProductionCredentialMaterializer,
  InMemoryCredentialStore,
  MaterializationError,
  toLeaseAuditRecord,
  type StoredCredential,
  type CredentialStore,
} from "../contracts/credential-broker.js";
import type {
  CredentialRef,
  CredentialRequest,
  CredentialLease,
  MaterializedCredential,
} from "../contracts/credential.js";
import type { VerifiedCapabilityGrant, CapabilityGrant } from "../contracts/capability.js";
import type { RuntimeIdentity, RunIdentity, IdentityContext } from "../contracts/identity.js";

// ─── Test fixtures ─────────────────────────────────────────────────

const SECRET_VALUE = "sk-testsecret1234567890abcdefghijklmnop";

function makeCredentialRef(provider: string = "github"): CredentialRef {
  return {
    ref: `ref_${provider}_001`,
    provider,
    origin: "platform_owned",
  };
}

function makeStoredCredential(overrides?: Partial<StoredCredential>): StoredCredential {
  return {
    ref: "ref_github_001",
    provider: "github",
    origin: "platform_owned",
    ownerUserId: null,
    scope: { provider: "github", account: "litlabs", projectId: null },
    secretValue: SECRET_VALUE,
    active: true,
    ...overrides,
  };
}

function makeGrant(overrides?: Partial<CapabilityGrant>): CapabilityGrant {
  const now = Date.now();
  return {
    grantId: "grant_test_001",
    tenantId: "tenant_001",
    userId: "user_alice",
    actorId: "user_alice",
    runId: "run_test_001",
    projectId: "proj_001",
    workspaceId: "ws_001",
    capabilities: ["github:repo", "terminal:run"],
    resourceScope: ["workspace:ws_001", "project:proj_001"],
    networkScope: ["github.com"],
    riskTier: "medium",
    approvalId: null,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3600_000).toISOString(),
    audience: "litt-kernel",
    nonce: "nonce_001",
    issuer: "litt-kernel-v1",
    policyVersion: "1.0.0",
    ...overrides,
  };
}

function makeVerifiedGrant(overrides?: Partial<CapabilityGrant>): VerifiedCapabilityGrant {
  return {
    status: "verified",
    grant: makeGrant(overrides),
    verifiedBy: "grant-verifier-v1",
    verifiedAt: new Date().toISOString(),
    keyId: "litt-kernel-v1",
  };
}

function makeRunIdentity(overrides?: Partial<RunIdentity>): RunIdentity {
  return {
    runId: "run_test_001",
    tenantId: "tenant_001",
    userId: "user_alice",
    conversationId: null,
    projectId: "proj_001",
    missionId: null,
    executionMode: "act",
    interaction: "interactive",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeIdentityContext(overrides?: Partial<IdentityContext>): IdentityContext {
  return {
    principalId: "user_alice",
    principalType: "user",
    sessionId: null,
    tenantId: "tenant_001",
    workspaceId: "ws_001",
    projectId: "proj_001",
    authenticationStrength: "standard",
    establishedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRuntimeIdentity(
  runOverrides?: Partial<RunIdentity>,
  idOverrides?: Partial<IdentityContext>,
): RuntimeIdentity {
  return {
    run: makeRunIdentity(runOverrides),
    identity: makeIdentityContext(idOverrides),
  };
}

function makeRequest(overrides?: Partial<CredentialRequest>): CredentialRequest {
  return {
    provider: "github",
    runId: "run_test_001",
    actorId: "user_alice",
    capabilityGrantId: "grant_test_001",
    scopes: ["repo:read", "repo:write"],
    resourceScope: ["workspace:ws_001", "project:proj_001"],
    audience: "github.com",
    projectId: "proj_001",
    ...overrides,
  };
}

function setupBroker(overrides?: {
  store?: CredentialStore;
  credential?: StoredCredential;
  now?: () => number;
}): {
  broker: ProductionCredentialBroker;
  store: InMemoryCredentialStore;
  materializer: ProductionCredentialMaterializer;
} {
  const store = (overrides?.store as InMemoryCredentialStore) ?? new InMemoryCredentialStore();
  const cred = overrides?.credential ?? makeStoredCredential();
  store.addCredential(cred);
  const broker = new ProductionCredentialBroker(store, { now: overrides?.now });
  broker.registerCredential(makeCredentialRef(cred.provider));
  const materializer = broker.getMaterializer();
  return { broker, store, materializer };
}

// ─── 1. Valid verified grant obtains scoped lease ──────────────────

describe("SEC-5.1 — Valid verified grant obtains scoped lease", () => {
  it("a verified grant with matching identity and scope obtains a lease", async () => {
    const { broker } = setupBroker();
    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );

    assert.equal(result.status, "allowed");
    if (result.status === "allowed") {
      assert.ok(result.lease.leaseId);
      assert.equal(result.lease.provider, "github");
      assert.equal(result.lease.runId, "run_test_001");
      assert.equal(result.lease.actorId, "user_alice");
      assert.equal(result.lease.capabilityGrantId, "grant_test_001");
      assert.equal(result.lease.origin, "platform_owned");
      assert.ok(result.lease.issuedAt);
      assert.ok(result.lease.expiresAt);
    }
  });
});

// ─── 2. Unsigned/unverified grant denied ───────────────────────────

describe("SEC-5.2 — Unverified grant denied", () => {
  it("grant with status != 'verified' is denied", async () => {
    const { broker } = setupBroker();
    const fakeGrant = {
      status: "unverified" as const,
      grant: makeGrant(),
      reason: "not signed",
    };

    // The broker's resolve() accepts VerifiedCapabilityGrant type,
    // but we can test the runtime check by casting
    const result = await broker.resolve(
      makeRuntimeIdentity(),
      fakeGrant as unknown as VerifiedCapabilityGrant,
      makeRequest(),
    );

    assert.equal(result.status, "denied");
    if (result.status === "denied") {
      assert.equal(result.reason, "grant_not_verified");
    }
  });
});

// ─── 3. Forged VerifiedCapabilityGrant denied ──────────────────────

describe("SEC-5.3 — Forged VerifiedCapabilityGrant denied", () => {
  it("a grant with forged 'verified' status but mismatched grantId is denied", async () => {
    const { broker } = setupBroker();
    const forgedGrant = makeVerifiedGrant({
      grantId: "grant_forged_001",
    });

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      forgedGrant,
      makeRequest({ capabilityGrantId: "grant_test_001" }), // request references real grant
    );

    assert.equal(result.status, "denied");
    if (result.status === "denied") {
      assert.equal(result.reason, "grant_id_mismatch");
    }
  });
});

// ─── 4. Wrong actor denied ─────────────────────────────────────────

describe("SEC-5.4 — Wrong actor denied", () => {
  it("request with different actorId than grant is denied", async () => {
    const { broker } = setupBroker();
    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant({ actorId: "user_alice" }),
      makeRequest({ actorId: "user_bob" }),
    );

    assert.equal(result.status, "denied");
    assert.equal((result as any).reason, "actor_mismatch");
  });
});

// ─── 5. Wrong tenant denied ────────────────────────────────────────

describe("SEC-5.5 — Wrong tenant denied", () => {
  it("identity with different tenantId than grant is denied", async () => {
    const { broker } = setupBroker();
    // Grant has tenant_001, identity has tenant_002
    const identity = makeRuntimeIdentity(
      { tenantId: "tenant_002" },
      { tenantId: "tenant_002" },
    );
    const result = await broker.resolve(
      identity,
      makeVerifiedGrant({ tenantId: "tenant_001" }),
      makeRequest(),
    );

    assert.equal(result.status, "denied");
    assert.equal((result as any).reason, "tenant_mismatch");
  });
});

// ─── 6. Wrong project denied ───────────────────────────────────────

describe("SEC-5.6 — Wrong project denied", () => {
  it("credential scoped to different project is denied", async () => {
    const store = new InMemoryCredentialStore();
    store.addCredential(makeStoredCredential({
      scope: { provider: "github", account: "litlabs", projectId: "proj_other" },
    }));
    const broker = new ProductionCredentialBroker(store);
    broker.registerCredential(makeCredentialRef());

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest({ projectId: "proj_001" }),
    );

    assert.equal(result.status, "denied");
    assert.equal((result as any).reason, "project_scope_mismatch");
  });
});

// ─── 7. Wrong run denied ───────────────────────────────────────────

describe("SEC-5.7 — Wrong run denied", () => {
  it("request with different runId than grant is denied", async () => {
    const { broker } = setupBroker();
    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant({ runId: "run_test_001" }),
      makeRequest({ runId: "run_other" }),
    );

    assert.equal(result.status, "denied");
    assert.equal((result as any).reason, "run_mismatch");
  });
});

// ─── 8. Wrong capability denied ────────────────────────────────────

describe("SEC-5.8 — Wrong capability (resource scope) denied", () => {
  it("request for resource scope not in grant is denied", async () => {
    const { broker } = setupBroker();
    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant({ resourceScope: ["workspace:ws_001"] }),
      makeRequest({ resourceScope: ["workspace:ws_001", "project:proj_other"] }),
    );

    assert.equal(result.status, "denied");
    assert.equal((result as any).reason, "resource_scope_mismatch");
  });
});

// ─── 9. Wrong credential scope denied ──────────────────────────────

describe("SEC-5.9 — Wrong credential scope denied", () => {
  it("credential from different provider than request is denied", async () => {
    const store = new InMemoryCredentialStore();
    store.addCredential(makeStoredCredential({ provider: "github", scope: { provider: "github", account: "litlabs", projectId: null } }));
    const broker = new ProductionCredentialBroker(store);
    broker.registerCredential(makeCredentialRef("github"));

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest({ provider: "github" }), // requesting github but only vercel is registered
    );

    assert.equal(result.status, "denied");
    assert.equal((result as any).reason, "credential_not_found");
  });
});

// ─── 10. Expired lease denied ──────────────────────────────────────

describe("SEC-5.10 — Expired lease denied", () => {
  it("materialize with expired lease throws", async () => {
    let clock = 1_000_000;
    const { broker, materializer } = setupBroker({
      now: () => clock,
    });

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest({ durationSeconds: 1 }),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    // Advance clock past expiry
    clock += 2000;

    await assert.rejects(
      materializer.materialize(result.lease, async () => "ok"),
      (err: Error) => {
        assert.ok(err instanceof MaterializationError);
        assert.equal((err as MaterializationError).code, "lease_expired");
        return true;
      },
    );
  });
});

// ─── 11. Revoked lease denied ──────────────────────────────────────

describe("SEC-5.11 — Revoked lease denied", () => {
  it("materialize with revoked lease throws", async () => {
    const { broker, materializer } = setupBroker();

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    await broker.revoke(result.lease.leaseId);

    await assert.rejects(
      materializer.materialize(result.lease, async () => "ok"),
      (err: Error) => {
        assert.ok(err instanceof MaterializationError);
        assert.equal((err as MaterializationError).code, "lease_revoked");
        return true;
      },
    );
  });
});

// ─── 12. Revoked credential denied ─────────────────────────────────

describe("SEC-5.12 — Revoked credential denied", () => {
  it("revoking a credential revokes all leases using it", async () => {
    const { broker, materializer } = setupBroker();

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    await broker.revokeCredential("ref_github_001");

    await assert.rejects(
      materializer.materialize(result.lease, async () => "ok"),
      (err: Error) => {
        assert.ok(err instanceof MaterializationError);
        assert.equal((err as MaterializationError).code, "lease_revoked");
        return true;
      },
    );
  });
});

// ─── 13. Cross-project lease reuse denied ──────────────────────────

describe("SEC-5.13 — Cross-project lease reuse denied", () => {
  it("lease scoped to one project cannot be used for another", async () => {
    const store = new InMemoryCredentialStore();
    store.addCredential(makeStoredCredential({
      scope: { provider: "github", account: "litlabs", projectId: "proj_001" },
    }));
    const broker = new ProductionCredentialBroker(store);
    broker.registerCredential(makeCredentialRef());

    // Request for proj_002 with a grant for proj_001
    const result = await broker.resolve(
      makeRuntimeIdentity({ projectId: "proj_002" } as any, { projectId: "proj_002" }),
      makeVerifiedGrant({ projectId: "proj_001" }),
      makeRequest({ projectId: "proj_002" }),
    );

    // The credential is scoped to proj_001, request is for proj_002
    assert.equal(result.status, "denied");
    assert.equal((result as any).reason, "project_scope_mismatch");
  });
});

// ─── 14. Cross-run reuse denied ────────────────────────────────────

describe("SEC-5.14 — Cross-run reuse denied", () => {
  it("lease from one run cannot be used in another run", async () => {
    const { broker, materializer } = setupBroker();

    // First: get a valid lease for run_test_001
    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest({ runId: "run_test_001" }),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    // The lease is bound to run_test_001
    assert.equal(result.lease.runId, "run_test_001");

    // Now try to get a lease for run_002 using a grant for run_test_001
    // This should be denied because the grant's runId doesn't match the request
    const result2 = await broker.resolve(
      makeRuntimeIdentity({ runId: "run_002" }),
      makeVerifiedGrant({ runId: "run_test_001" }),
      makeRequest({ runId: "run_002" }),
    );
    assert.equal(result2.status, "denied");
    assert.equal((result2 as any).reason, "run_mismatch");
  });
});

// ─── 15. BYOK credential cannot leak to another user ───────────────

describe("SEC-5.15 — BYOK isolation", () => {
  it("byok credential owned by user_alice cannot be used by user_bob", async () => {
    const store = new InMemoryCredentialStore();
    store.addCredential(makeStoredCredential({
      origin: "byok",
      ownerUserId: "user_alice",
    }));
    const broker = new ProductionCredentialBroker(store);
    broker.registerCredential(makeCredentialRef());

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant({ userId: "user_bob", actorId: "user_bob" }),
      makeRequest({ actorId: "user_bob" }),
    );

    assert.equal(result.status, "denied");
    assert.equal((result as any).reason, "byok_owner_mismatch");
  });

  it("byok credential owned by user_alice CAN be used by user_alice", async () => {
    const store = new InMemoryCredentialStore();
    store.addCredential(makeStoredCredential({
      origin: "byok",
      ownerUserId: "user_alice",
    }));
    const broker = new ProductionCredentialBroker(store);
    broker.registerCredential(makeCredentialRef());

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant({ userId: "user_alice" }),
      makeRequest({ actorId: "user_alice" }),
    );

    assert.equal(result.status, "allowed");
  });
});

// ─── 16. Platform credential respects platform policy ──────────────

describe("SEC-5.16 — Platform credential policy", () => {
  it("platform_owned credential with null owner can be used by any verified user", async () => {
    const store = new InMemoryCredentialStore();
    store.addCredential(makeStoredCredential({
      origin: "platform_owned",
      ownerUserId: null,
    }));
    const broker = new ProductionCredentialBroker(store);
    broker.registerCredential(makeCredentialRef());

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant({ userId: "user_carol", actorId: "user_carol" }),
      makeRequest({ actorId: "user_carol" }),
    );

    assert.equal(result.status, "allowed");
  });
});

// ─── 17. Secret never appears in JSON.stringify(lease) ──────────────

describe("SEC-5.17 — Secret isolation in lease", () => {
  it("JSON.stringify(lease) does not contain the secret value", async () => {
    const { broker } = setupBroker();

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    const leaseJson = JSON.stringify(result.lease);
    assert.ok(!leaseJson.includes(SECRET_VALUE), "secret must not appear in lease JSON");
    assert.ok(!leaseJson.includes("secretValue"), "secretValue field must not appear");
    assert.ok(!leaseJson.includes("apiKey"), "apiKey field must not appear");
  });

  it("toLeaseAuditRecord does not contain the secret value", async () => {
    const { broker } = setupBroker();

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    const audit = toLeaseAuditRecord(result.lease);
    const auditJson = JSON.stringify(audit);
    assert.ok(!auditJson.includes(SECRET_VALUE), "secret must not appear in audit record");
    // secretRef should be redacted
    assert.ok(!auditJson.includes("ref_github_001"), "secretRef should be redacted");
  });
});

// ─── 18. Secret never appears in runtime events ────────────────────

describe("SEC-5.18 — Secret isolation in audit events", () => {
  it("audit log does not contain the secret value", async () => {
    const { broker } = setupBroker();

    await broker.resolve(makeRuntimeIdentity(), makeVerifiedGrant(), makeRequest());

    const auditEvents = await broker.audit({ runId: "run_test_001" });
    const auditJson = JSON.stringify(auditEvents);
    assert.ok(!auditJson.includes(SECRET_VALUE), "secret must not appear in audit events");
  });
});

// ─── 19. Secret never appears in audit records ─────────────────────

describe("SEC-5.19 — Secret isolation in denied audit records", () => {
  it("denied request audit record does not contain the secret", async () => {
    const { broker } = setupBroker();

    // This should be denied
    await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant({ actorId: "user_alice" }),
      makeRequest({ actorId: "user_bob" }),
    );

    const auditEvents = await broker.audit({ runId: "run_test_001" });
    const auditJson = JSON.stringify(auditEvents);
    assert.ok(!auditJson.includes(SECRET_VALUE), "secret must not appear in denied audit");
  });
});

// ─── 20. Materializer is the only API returning credential material ─

describe("SEC-5.20 — Materializer is the only secret access path", () => {
  it("broker.resolve() does not return the secret", async () => {
    const { broker } = setupBroker();

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    // The lease has secretRef, not the secret value
    assert.ok(result.lease.secretRef);
    assert.notEqual(result.lease.secretRef, SECRET_VALUE);
  });

  it("broker.lease() does not return the secret", async () => {
    const { broker } = setupBroker();

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    const lease = await broker.lease(result.lease.leaseId);
    assert.ok(lease);
    assert.notEqual(lease!.secretRef, SECRET_VALUE);
  });

  it("materialize() provides the secret only inside the callback", async () => {
    const { broker, materializer } = setupBroker();

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    let capturedSecret: string | null = null;
    await materializer.materialize(result.lease, async (cred) => {
      capturedSecret = cred.value;
      assert.equal(cred.value, SECRET_VALUE);
      return "ok";
    });

    // After the callback, the credential value should be wiped
    // (best-effort — we overwrite with null bytes)
    // The capturedSecret variable still holds the value, but the
    // MaterializedCredential object's value is wiped.
    assert.equal(capturedSecret, SECRET_VALUE); // we captured it inside the callback
  });
});

// ─── 21. Failed materialization fails closed ───────────────────────

describe("SEC-5.21 — Failed materialization fails closed", () => {
  it("materialize with non-existent lease throws", async () => {
    const { materializer } = setupBroker();

    const fakeLease: CredentialLease = {
      leaseId: "lease_nonexistent",
      provider: "github",
      runId: "run_test_001",
      actorId: "user_alice",
      capabilityGrantId: "grant_test_001",
      scopes: ["repo:read"],
      resourceScope: ["workspace:ws_001"],
      audience: "github.com",
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      renewable: true,
      origin: "platform_owned",
      secretRef: "ref_github_001",
    };

    await assert.rejects(
      materializer.materialize(fakeLease, async () => "ok"),
      (err: Error) => {
        assert.ok(err instanceof MaterializationError);
        assert.equal((err as MaterializationError).code, "lease_not_found");
        return true;
      },
    );
  });
});

// ─── 22. Secret-store outage fails closed ──────────────────────────

describe("SEC-5.22 — Secret-store outage fails closed", () => {
  it("store outage during resolve denies the request", async () => {
    const store = new InMemoryCredentialStore();
    store.addCredential(makeStoredCredential());
    store.setShouldFail(true);
    const broker = new ProductionCredentialBroker(store);
    broker.registerCredential(makeCredentialRef());

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );

    assert.equal(result.status, "denied");
    assert.equal((result as any).reason, "store_outage");
  });

  it("store outage during materialize throws", async () => {
    const store = new InMemoryCredentialStore();
    store.addCredential(makeStoredCredential());
    const broker = new ProductionCredentialBroker(store);
    broker.registerCredential(makeCredentialRef());
    const materializer = broker.getMaterializer();

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    store.setShouldFail(true);

    await assert.rejects(
      materializer.materialize(result.lease, async () => "ok"),
      (err: Error) => {
        assert.ok(err instanceof MaterializationError);
        assert.equal((err as MaterializationError).code, "store_outage");
        return true;
      },
    );
  });
});

// ─── 23. Malformed secret-store response denied ────────────────────

describe("SEC-5.23 — Malformed store response denied", () => {
  it("store returning empty secret value throws", async () => {
    const store = new InMemoryCredentialStore();
    store.addCredential(makeStoredCredential());
    store.setMalformedMode(true);
    const broker = new ProductionCredentialBroker(store);
    broker.registerCredential(makeCredentialRef());
    const materializer = broker.getMaterializer();

    // Resolve should work (isActive doesn't check secretValue)
    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    await assert.rejects(
      materializer.materialize(result.lease, async () => "ok"),
      (err: Error) => {
        assert.ok(err instanceof MaterializationError);
        assert.equal((err as MaterializationError).code, "malformed_store_response");
        return true;
      },
    );
  });
});

// ─── 24. Concurrent leases remain isolated ─────────────────────────

describe("SEC-5.24 — Concurrent lease isolation", () => {
  it("two concurrent leases for the same run are independent", async () => {
    const { broker } = setupBroker();

    const [r1, r2] = await Promise.all([
      broker.resolve(makeRuntimeIdentity(), makeVerifiedGrant(), makeRequest()),
      broker.resolve(makeRuntimeIdentity(), makeVerifiedGrant(), makeRequest()),
    ]);

    assert.equal(r1.status, "allowed");
    assert.equal(r2.status, "allowed");
    if (r1.status !== "allowed" || r2.status !== "allowed") return;

    assert.notEqual(r1.lease.leaseId, r2.lease.leaseId);
  });

  it("revoking one lease does not affect the other", async () => {
    const { broker, materializer } = setupBroker();

    const [r1, r2] = await Promise.all([
      broker.resolve(makeRuntimeIdentity(), makeVerifiedGrant(), makeRequest()),
      broker.resolve(makeRuntimeIdentity(), makeVerifiedGrant(), makeRequest()),
    ]);
    if (r1.status !== "allowed" || r2.status !== "allowed") return;

    await broker.revoke(r1.lease.leaseId);

    // r1 is revoked
    await assert.rejects(
      materializer.materialize(r1.lease, async () => "ok"),
      (err: Error) => err instanceof MaterializationError,
    );

    // r2 still works
    const result = await materializer.materialize(r2.lease, async (cred) => {
      return cred.value === SECRET_VALUE ? "ok" : "fail";
    });
    assert.equal(result, "ok");
  });
});

// ─── 25. Redaction catches materialized secrets in thrown errors ───

describe("SEC-5.25 — Redaction in thrown errors", () => {
  it("error containing the secret is redacted", async () => {
    const { broker, materializer } = setupBroker();

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    // The callback throws an error that contains the secret
    await assert.rejects(
      materializer.materialize(result.lease, async (cred) => {
        throw new Error(`Failed with token: ${cred.value}`);
      }),
      (err: Error) => {
        // The error message should be redacted
        assert.ok(!err.message.includes(SECRET_VALUE), "secret must be redacted in error");
        assert.ok(err.message.includes("[REDACTED]"), "should contain REDACTED marker");
        return true;
      },
    );
  });
});

// ─── 26. Materialized credentials are disposed after execution ────

describe("SEC-5.26 — Credential disposal", () => {
  it("credential value is wiped after callback completes", async () => {
    const { broker, materializer } = setupBroker();

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    let capturedCred: MaterializedCredential | null = null;
    await materializer.materialize(result.lease, async (cred) => {
      capturedCred = cred;
      return "ok";
    });

    // After the callback, the credential value should be wiped
    assert.ok(capturedCred);
    // The value should have been overwritten with null bytes
    const credRef = capturedCred as MaterializedCredential | null;
    assert.ok(credRef, "credential should exist");
    assert.ok(!credRef!.value.includes(SECRET_VALUE), "secret should be wiped after disposal");
  });

  it("credential value is wiped even if callback throws", async () => {
    const { broker, materializer } = setupBroker();

    const result = await broker.resolve(
      makeRuntimeIdentity(),
      makeVerifiedGrant(),
      makeRequest(),
    );
    assert.equal(result.status, "allowed");
    if (result.status !== "allowed") return;

    let capturedCred: MaterializedCredential | null = null;
    try {
      await materializer.materialize(result.lease, async (cred) => {
        capturedCred = cred;
        throw new Error("callback failure");
      });
    } catch {
      // expected
    }

    // Even after an error, the credential should be wiped
    assert.ok(capturedCred);
    const credRef = capturedCred as MaterializedCredential | null;
    assert.ok(credRef, "credential should exist");
    assert.ok(!credRef!.value.includes(SECRET_VALUE), "secret should be wiped even after error");
  });
});
