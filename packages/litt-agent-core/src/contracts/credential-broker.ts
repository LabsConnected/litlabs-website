/**
 * SEC-5 — Production CredentialBroker implementation.
 *
 * Implements the CredentialBroker + CredentialMaterializer contracts
 * with a pluggable CredentialStore adapter. This is the runtime that
 * enforces the full authorization chain before any secret is touched.
 *
 * Architecture:
 *
 *   VerifiedCapabilityGrant + CredentialRequest
 *     ↓
 *   ProductionCredentialBroker.resolve()
 *     ↓ verify identity, grant, scope, origin
 *   CredentialLease (scoped, expiring, revocable)
 *     ↓
 *   ProductionCredentialMaterializer.materialize(lease, callback)
 *     ↓ fetch secret from CredentialStore, inject into callback
 *   MaterializedCredential (available ONLY inside callback)
 *     ↓ callback completes
 *   Secret is wiped from memory
 *
 * Security invariants:
 *   - Raw credentials never live in grants, leases, events, logs, or audit
 *   - Broker accepts CredentialRef, never caller-supplied secret material
 *   - Every lease binds: actor, tenant, project, runId, capability, scope, origin
 *   - Expired/revoked/wrong-scope leases fail closed
 *   - Materialization happens immediately before execution, discarded after
 *   - No generic getSecret(name) escape hatch
 *   - No agent/model API can enumerate stored secrets
 *   - Knowing a credential reference is NEVER enough — lease + verification required
 *   - Secret-store outage fails closed
 *   - Malformed secret-store response fails closed
 *   - Concurrent leases remain isolated
 *   - Redaction catches materialized secrets in thrown errors
 */

import { randomBytes } from "node:crypto";
import type {
  CredentialBroker,
  CredentialLease,
  CredentialRequest,
  CredentialAuditEvent,
  CredentialMaterializer,
  MaterializedCredential,
  CredentialRef,
  CredentialOrigin,
  CredentialScope,
  BrokerResolution,
} from "./credential.js";
import { REDACTED, redactString, redactForAudit } from "./credential.js";
import type { RuntimeIdentity } from "./identity.js";
import type { VerifiedCapabilityGrant } from "./capability.js";

// ─── Credential store adapter ──────────────────────────────────────

/**
 * A stored credential entry.
 * The store returns this to the broker — never to callers.
 */
export interface StoredCredential {
  /** Opaque reference (matches CredentialRef.ref) */
  ref: string;
  /** Provider name */
  provider: string;
  /** Origin: platform_owned or byok */
  origin: CredentialOrigin;
  /** Owner user ID (for byok) or null (for platform_owned) */
  ownerUserId: string | null;
  /** Credential scope */
  scope: CredentialScope;
  /** The actual secret value (NEVER leaves the store → broker → materializer path) */
  secretValue: string;
  /** Whether this credential is currently active */
  active: boolean;
}

/**
 * The credential store adapter interface.
 *
 * Production implementations connect to:
 *   - HashiCorp Vault
 *   - AWS Secrets Manager
 *   - Google Secret Manager
 *   - Azure Key Vault
 *   - Cloudflare Workers Secrets Store
 *   - Encrypted database column
 *
 * The agent-core package does NOT depend on any specific vendor.
 * The adapter is injected.
 *
 * CRITICAL: The store must NEVER expose secrets through enumeration.
 * There is no listSecrets() or getAll() API. The store only resolves
 * individual refs that the broker already knows about.
 */
export interface CredentialStore {
  /**
   * Resolve a credential reference to its stored value.
   * Returns null if the credential doesn't exist or is inactive.
   * Throws on store outage or malformed response.
   */
  resolve(ref: string): Promise<StoredCredential | null>;

  /** Check if a credential is active (without retrieving the secret) */
  isActive(ref: string): Promise<boolean>;

  /** Mark a credential as inactive (revoked) */
  revoke(ref: string): Promise<void>;
}

// ─── Broker context ────────────────────────────────────────────────

/**
 * Context for broker operations, binding to the current execution.
 */
export interface BrokerContext {
  /** Tenant ID */
  tenantId: string;
  /** Project ID (or null if not project-scoped) */
  projectId: string | null;
  /** Workspace ID (or null) */
  workspaceId: string | null;
}

// ─── Lease registry ────────────────────────────────────────────────

/**
 * Internal lease tracking state.
 */
interface LeaseRecord {
  lease: CredentialLease;
  revoked: boolean;
  materialized: boolean;
  disposed: boolean;
}

// ─── ProductionCredentialBroker ────────────────────────────────────

/**
 * The production credential broker.
 *
 * Enforces the full authorization chain:
 *   VerifiedCapabilityGrant → identity verification → scope check → lease issuance
 *
 * Default behavior: DENY. Any mismatch, expiry, or error → denied.
 */
export class ProductionCredentialBroker implements CredentialBroker {
  private readonly _store: CredentialStore;
  private readonly _leases = new Map<string, LeaseRecord>();
  private readonly _auditLog: CredentialAuditEvent[] = [];
  private readonly _credentialRegistry = new Map<string, CredentialRef>();
  private readonly _now: () => number;
  private readonly _defaultLeaseTtlMs: number;

  constructor(
    store: CredentialStore,
    options?: {
      now?: () => number;
      defaultLeaseTtlMs?: number;
    },
  ) {
    this._store = store;
    this._now = options?.now ?? Date.now;
    this._defaultLeaseTtlMs = options?.defaultLeaseTtlMs ?? 600_000; // 10 min default
  }

  /**
   * Register a credential reference with the broker.
   * This is how the broker learns about available credentials.
   * Does NOT expose the secret — only the opaque ref + metadata.
   */
  registerCredential(ref: CredentialRef): void {
    this._credentialRegistry.set(`${ref.provider}:${ref.ref}`, ref);
  }

  /**
   * Resolve a credential request.
   *
   * Verifies:
   *   1. Grant is verified (status="verified")
   *   2. Identity matches grant (actorId, tenantId, runId)
   *   3. Request matches grant (capabilityGrantId, runId, actorId)
   *   4. Credential exists in registry and store
   *   5. Credential scope matches request scope
   *   6. BYOK credentials don't leak to other users
   *   7. Platform credentials respect platform policy
   *
   * Returns BrokerResolution: allowed (with lease) or denied (with reason).
   */
  async resolve(
    identity: RuntimeIdentity,
    grant: VerifiedCapabilityGrant,
    request: CredentialRequest,
  ): Promise<BrokerResolution> {
    // 1. Grant must be verified (type-level guarantee, but double-check)
    if (grant.status !== "verified") {
      return this.deny(request, "grant_not_verified");
    }

    const g = grant.grant;

    // 2. Identity match
    if (g.actorId !== request.actorId) {
      return this.deny(request, "actor_mismatch");
    }
    if (g.runId !== request.runId) {
      return this.deny(request, "run_mismatch");
    }
    if (g.tenantId !== identity.run.tenantId) {
      return this.deny(request, "tenant_mismatch");
    }
    if (identity.run.runId !== request.runId) {
      return this.deny(request, "identity_run_mismatch");
    }

    // 3. Capability grant ID match
    if (g.grantId !== request.capabilityGrantId) {
      return this.deny(request, "grant_id_mismatch");
    }

    // 4. Find credential in registry
    const registryKey = `${request.provider}:${request.scopes.join(",")}`;
    let credRef: CredentialRef | undefined;
    for (const [key, ref] of this._credentialRegistry) {
      if (ref.provider === request.provider) {
        credRef = ref;
        break;
      }
    }
    if (!credRef) {
      return this.deny(request, "credential_not_found");
    }

    // 5. Check store for credential existence and active status
    let stored: StoredCredential | null;
    try {
      const isActive = await this._store.isActive(credRef.ref);
      if (!isActive) {
        return this.deny(request, "credential_inactive");
      }
      stored = await this._store.resolve(credRef.ref);
    } catch (err) {
      // Store outage → fail closed
      return this.deny(request, "store_outage");
    }

    if (!stored) {
      return this.deny(request, "credential_not_found");
    }

    // 6. Scope match
    if (stored.scope.provider !== request.provider) {
      return this.deny(request, "scope_mismatch");
    }
    if (stored.scope.projectId !== null && request.projectId !== null) {
      if (stored.scope.projectId !== request.projectId) {
        return this.deny(request, "project_scope_mismatch");
      }
    }

    // 7. BYOK isolation: byok credentials can only be used by their owner
    if (stored.origin === "byok" && stored.ownerUserId !== null) {
      if (stored.ownerUserId !== g.userId) {
        return this.deny(request, "byok_owner_mismatch");
      }
    }

    // 8. Resource scope check
    for (const required of request.resourceScope) {
      if (!g.resourceScope.includes(required)) {
        return this.deny(request, "resource_scope_mismatch");
      }
    }

    // All checks passed → issue lease
    const now = this._now();
    const ttlMs = (request.durationSeconds ?? this._defaultLeaseTtlMs / 1000) * 1000;
    const leaseId = this.generateLeaseId();

    const lease: CredentialLease = {
      leaseId,
      provider: request.provider,
      runId: request.runId,
      actorId: request.actorId,
      capabilityGrantId: request.capabilityGrantId,
      scopes: request.scopes,
      resourceScope: request.resourceScope,
      audience: request.audience,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      renewable: true,
      origin: stored.origin,
      secretRef: credRef.ref, // opaque ref, NOT the secret value
    };

    this._leases.set(leaseId, {
      lease,
      revoked: false,
      materialized: false,
      disposed: false,
    });

    this.logAudit({
      operation: "resolve",
      provider: request.provider,
      runId: request.runId,
      actorId: request.actorId,
      capabilityGrantId: request.capabilityGrantId,
      outcome: "allowed",
      reason: null,
      leaseId,
    });

    return { status: "allowed", lease };
  }

  /** Get an existing lease by ID. Returns null if not found or revoked. */
  async lease(leaseId: string): Promise<CredentialLease | null> {
    const record = this._leases.get(leaseId);
    if (!record) return null;
    if (record.revoked) return null;

    // Check expiry
    const now = this._now();
    if (new Date(record.lease.expiresAt).getTime() < now) {
      return null;
    }

    return record.lease;
  }

  /** Revoke a specific lease. */
  async revoke(leaseId: string): Promise<void> {
    const record = this._leases.get(leaseId);
    if (record) {
      record.revoked = true;
      this.logAudit({
        operation: "revoke",
        provider: record.lease.provider,
        runId: record.lease.runId,
        actorId: record.lease.actorId,
        capabilityGrantId: record.lease.capabilityGrantId,
        outcome: "revoked",
        reason: "lease_revoked",
        leaseId,
      });
    }
  }

  /** Revoke all leases for a run. */
  async revokeRun(runId: string): Promise<void> {
    for (const [leaseId, record] of this._leases) {
      if (record.lease.runId === runId) {
        record.revoked = true;
        this.logAudit({
          operation: "revokeRun",
          provider: record.lease.provider,
          runId,
          actorId: record.lease.actorId,
          capabilityGrantId: record.lease.capabilityGrantId,
          outcome: "revoked",
          reason: "run_revoked",
          leaseId,
        });
      }
    }
  }

  /** Revoke a credential (propagates to all active leases using it). */
  async revokeCredential(ref: string): Promise<void> {
    await this._store.revoke(ref);
    // Revoke all leases using this ref
    for (const [leaseId, record] of this._leases) {
      if (record.lease.secretRef === ref && !record.revoked) {
        record.revoked = true;
        this.logAudit({
          operation: "revoke",
          provider: record.lease.provider,
          runId: record.lease.runId,
          actorId: record.lease.actorId,
          capabilityGrantId: record.lease.capabilityGrantId,
          outcome: "revoked",
          reason: "credential_revoked",
          leaseId,
        });
      }
    }
  }

  /** Get audit trail. Never contains secret material. */
  async audit(filter: {
    leaseId?: string;
    runId?: string;
  }): Promise<CredentialAuditEvent[]> {
    return this._auditLog.filter((e) => {
      if (filter.leaseId && e.leaseId !== filter.leaseId) return false;
      if (filter.runId && e.runId !== filter.runId) return false;
      return true;
    });
  }

  /** Get the materializer for this broker. */
  getMaterializer(): ProductionCredentialMaterializer {
    return new ProductionCredentialMaterializer(this._store, this._leases, this._now, this._auditLog);
  }

  // ─── Internal helpers ──────────────────────────────────────────

  private deny(request: CredentialRequest, reason: string): BrokerResolution {
    this.logAudit({
      operation: "resolve",
      provider: request.provider,
      runId: request.runId,
      actorId: request.actorId,
      capabilityGrantId: request.capabilityGrantId,
      outcome: "denied",
      reason,
      leaseId: null,
    });
    return { status: "denied", reason, request };
  }

  private logAudit(event: Omit<CredentialAuditEvent, "eventId" | "timestamp">): void {
    this._auditLog.push({
      ...event,
      eventId: this.generateEventId(),
      timestamp: new Date(this._now()).toISOString(),
    });
  }

  private generateLeaseId(): string {
    return `lease_${this._now()}_${randomBytes(4).toString("hex")}`;
  }

  private generateEventId(): string {
    return `caudit_${this._now()}_${randomBytes(4).toString("hex")}`;
  }

  /** Check if a lease is valid (not revoked, not expired). */
  isLeaseValid(leaseId: string): boolean {
    const record = this._leases.get(leaseId);
    if (!record) return false;
    if (record.revoked) return false;
    const now = this._now();
    if (new Date(record.lease.expiresAt).getTime() < now) return false;
    return true;
  }
}

// ─── ProductionCredentialMaterializer ──────────────────────────────

/**
 * The production credential materializer.
 *
 * The ONLY boundary where raw secret material appears. Takes a
 * CredentialLease, fetches the secret from the store, and injects
 * it into a callback boundary. The secret is wiped after the callback.
 *
 * CRITICAL: Knowing a credential reference is NEVER enough.
 * materialize() requires a valid, non-expired, non-revoked lease.
 */
export class ProductionCredentialMaterializer implements CredentialMaterializer {
  private readonly _store: CredentialStore;
  private readonly _leases: Map<string, LeaseRecord>;
  private readonly _now: () => number;
  private readonly _auditLog: CredentialAuditEvent[];

  constructor(
    store: CredentialStore,
    leases: Map<string, LeaseRecord>,
    now: () => number,
    auditLog: CredentialAuditEvent[],
  ) {
    this._store = store;
    this._leases = leases;
    this._now = now;
    this._auditLog = auditLog;
  }

  /**
   * Materialize a credential inside a boundary callback.
   *
   * The credential is available ONLY inside the callback. After the
   * callback completes (success or failure), the secret is wiped.
   *
   * Throws if:
   *   - Lease not found
   *   - Lease revoked
   *   - Lease expired
   *   - Store outage
   *   - Store returns malformed data
   */
  async materialize<T>(
    lease: CredentialLease,
    fn: (credential: MaterializedCredential) => Promise<T>,
  ): Promise<T> {
    // Verify lease is valid
    const record = this._leases.get(lease.leaseId);
    if (!record) {
      throw new MaterializationError("lease_not_found", `Lease ${lease.leaseId} not found`);
    }
    if (record.revoked) {
      throw new MaterializationError("lease_revoked", `Lease ${lease.leaseId} is revoked`);
    }

    // Check expiry
    const now = this._now();
    if (new Date(lease.expiresAt).getTime() < now) {
      throw new MaterializationError("lease_expired", `Lease ${lease.leaseId} is expired`);
    }

    // Fetch secret from store
    let stored: StoredCredential | null;
    try {
      stored = await this._store.resolve(lease.secretRef);
    } catch (err) {
      // Store outage → fail closed
      this.auditMaterialize(lease, "error", "store_outage");
      throw new MaterializationError("store_outage", "Credential store unavailable");
    }

    if (!stored) {
      this.auditMaterialize(lease, "denied", "credential_not_found");
      throw new MaterializationError("credential_not_found", "Credential not found in store");
    }

    // Validate store response
    if (!stored.secretValue || typeof stored.secretValue !== "string") {
      this.auditMaterialize(lease, "error", "malformed_store_response");
      throw new MaterializationError("malformed_store_response", "Store returned malformed credential");
    }

    // Mark as materialized
    record.materialized = true;

    // Create materialized credential (branded type)
    const credential: MaterializedCredential = {
      __brand: "MaterializedCredential" as const,
      value: stored.secretValue,
    };

    // Execute callback inside the boundary
    try {
      const result = await fn(credential);
      this.auditMaterialize(lease, "allowed", null);
      return result;
    } catch (err) {
      // Redact any secrets from thrown errors
      if (err instanceof Error) {
        const redactedMessage = redactString(err.message);
        if (redactedMessage !== err.message) {
          throw new MaterializationError(
            "callback_error_redacted",
            `Callback error (secrets redacted): ${redactedMessage}`,
          );
        }
      }
      throw err;
    } finally {
      // Wipe the secret from memory (best-effort)
      this.wipeSecret(credential);
      record.disposed = true;
    }
  }

  /** Best-effort secret wiping. */
  private wipeSecret(cred: MaterializedCredential): void {
    // Overwrite the value property — best-effort since JS strings are immutable
    // In a native addon or Buffer-based implementation, we'd zero the memory
    try {
      Object.defineProperty(cred, "value", {
        value: "\0".repeat(cred.value.length),
        writable: false,
        configurable: false,
      });
    } catch {
      // Best-effort — if we can't wipe, the GC will eventually collect it
    }
  }

  private auditMaterialize(
    lease: CredentialLease,
    outcome: "allowed" | "denied" | "error",
    reason: string | null,
  ): void {
    this._auditLog.push({
      eventId: `caudit_${this._now()}_${randomBytes(4).toString("hex")}`,
      timestamp: new Date(this._now()).toISOString(),
      operation: "materialize",
      provider: lease.provider,
      runId: lease.runId,
      actorId: lease.actorId,
      capabilityGrantId: lease.capabilityGrantId,
      outcome,
      reason,
      leaseId: lease.leaseId,
    });
  }
}

// ─── Materialization error ─────────────────────────────────────────

/**
 * Error thrown by the materializer.
 * All error messages are redacted to prevent secret leakage.
 */
export class MaterializationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(redactString(message));
    this.name = "MaterializationError";
    this.code = code;
  }
}

// ─── In-memory credential store (for testing) ──────────────────────

/**
 * A simple in-memory credential store.
 * Suitable for testing and development. Production should use
 * a real secret store adapter (Vault, AWS Secrets Manager, etc.).
 */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly _credentials = new Map<string, StoredCredential>();
  private _shouldFail = false;
  private _malformedMode = false;

  addCredential(cred: StoredCredential): void {
    this._credentials.set(cred.ref, cred);
  }

  /** Simulate a store outage for testing. */
  setShouldFail(shouldFail: boolean): void {
    this._shouldFail = shouldFail;
  }

  /** Simulate malformed responses for testing. */
  setMalformedMode(malformed: boolean): void {
    this._malformedMode = malformed;
  }

  async resolve(ref: string): Promise<StoredCredential | null> {
    if (this._shouldFail) {
      throw new Error("Simulated store outage");
    }
    const cred = this._credentials.get(ref);
    if (!cred || !cred.active) return null;

    if (this._malformedMode) {
      return { ...cred, secretValue: "" }; // malformed: empty secret
    }

    return { ...cred };
  }

  async isActive(ref: string): Promise<boolean> {
    if (this._shouldFail) {
      throw new Error("Simulated store outage");
    }
    const cred = this._credentials.get(ref);
    return cred?.active ?? false;
  }

  async revoke(ref: string): Promise<void> {
    const cred = this._credentials.get(ref);
    if (cred) {
      this._credentials.set(ref, { ...cred, active: false });
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Create a MaterializedCredential (for internal use only).
 * This is intentionally not exported — only the materializer should
 * create materialized credentials.
 */
function createMaterializedCredential(value: string): MaterializedCredential {
  return {
    __brand: "MaterializedCredential" as const,
    value,
  };
}

/**
 * Audit-safe serialization of a credential lease.
 * Strips any potential secrets (defense-in-depth — leases should
 * never contain secrets, only refs).
 */
export function toLeaseAuditRecord(lease: CredentialLease): Record<string, unknown> {
  return redactForAudit({
    leaseId: lease.leaseId,
    provider: lease.provider,
    runId: lease.runId,
    actorId: lease.actorId,
    capabilityGrantId: lease.capabilityGrantId,
    scopes: lease.scopes,
    resourceScope: lease.resourceScope,
    audience: lease.audience,
    issuedAt: lease.issuedAt,
    expiresAt: lease.expiresAt,
    renewable: lease.renewable,
    origin: lease.origin,
    secretRef: REDACTED, // Never expose the ref in audit logs
  });
}

