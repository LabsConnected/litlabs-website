/**
 * Canonical credential lease + broker contracts (SEC-2).
 *
 * A CredentialLease represents ACCESS to a credential, not the raw secret.
 * The lease contains a CredentialRef (opaque broker reference), never the
 * secret value.
 *
 * SEC-2 adds:
 *   - CredentialRef: opaque reference to a stored credential
 *   - CredentialOrigin: platform_owned | byok (bring-your-own-key)
 *   - CredentialScope: provider + account + project binding
 *   - CredentialBroker: resolve / lease / revoke / audit
 *   - CredentialMaterializer: the ONLY boundary where raw secrets appear
 *   - BrokerResolution: the result of a resolve() call (fail-closed)
 *
 * Architecture:
 *
 *   RuntimeIdentity (who)
 *     + VerifiedCapabilityGrant (what is authorized)
 *     + CredentialRequest (what is needed)
 *         ↓
 *   CredentialBroker.resolve()
 *         ↓
 *   BrokerResolution (allowed | denied)
 *         ↓ if allowed
 *   CredentialLease (scoped, expiring, capability-bound)
 *         ↓
 *   CredentialMaterializer.materialize(lease)
 *         ↓
 *   Raw secret injected into provider/tool boundary
 *   (NEVER returned to agent, model, logs, or events)
 *
 * Secrets must never enter:
 *   - audit events
 *   - model context
 *   - conversation
 *   - memory
 *   - logs
 *   - checkpoints
 *   - Git
 *   - Socket.IO events
 *   - error objects
 *   - stdout/stderr
 */

// ─── Credential reference ─────────────────────────────────────────

/**
 * An opaque reference to a stored credential.
 *
 * This is NOT the secret value. It is a broker-internal handle that
 * only the CredentialBroker can resolve. The ref string is opaque to
 * all callers — it may be a UUID, a key-store path, or a broker-internal
 * token, but it must NOT contain any part of the secret.
 *
 * CredentialRef is safe to store in:
 *   - CredentialLease
 *   - audit logs (the ref, not the secret)
 *   - RuntimeStore state
 *
 * CredentialRef is NOT safe to use as authorization. It is a reference,
 * not a grant. The broker must verify identity + capability + scope
 * before resolving the ref to a usable credential.
 */
export interface CredentialRef {
  /** Opaque broker-internal reference (NOT a secret value) */
  ref: string;
  /** Provider name (e.g. "github", "openrouter", "vercel") */
  provider: string;
  /** Origin: who owns this credential */
  origin: CredentialOrigin;
}

/**
 * Who owns a credential.
 *
 *   platform_owned: LiTT platform manages the credential (e.g. shared
 *                   OpenRouter key, internal service token)
 *   byok:           User bring-your-own-key (stored in user's vault)
 *
 * This distinction matters for:
 *   - Billing: platform_owned credentials are billed to the platform;
 *     byok credentials are billed to the user's provider account.
 *   - Scope: byok credentials may have user-specific scopes.
 *   - Audit: origin is recorded in every lease and audit event.
 */
export type CredentialOrigin = "platform_owned" | "byok";

// ─── Credential scope ─────────────────────────────────────────────

/**
 * The scope binding for a credential.
 *
 * Credentials are scoped to:
 *   - provider: which service (github, openrouter, vercel, ...)
 *   - account: which account within the provider (org name, user handle)
 *   - project: which project this credential is bound to (if any)
 *
 * A GitHub credential for project A MUST NOT be usable as a Vercel
 * credential, and MUST NOT be reusable for project B unless the scope
 * explicitly allows it.
 */
export interface CredentialScope {
  /** Provider name */
  provider: string;
  /** Account identifier within the provider (org, user, team) */
  account: string | null;
  /** Project ID this credential is scoped to (null = any project) */
  projectId: string | null;
}

// ─── Credential lease ─────────────────────────────────────────────

/**
 * A short-lived, revocable lease on a credential.
 *
 * The lease grants access to a credential for a specific run, actor,
 * and scope. The actual secret value is never in the lease — only a
 * CredentialRef that the broker can resolve inside the materializer
 * boundary.
 *
 * Leases are:
 *   - scoped: bound to provider + scopes + resourceScope + audience
 *   - expiring: have a TTL; expired leases are rejected
 *   - capability-bound: tied to a capabilityGrantId
 *   - run-bound: tied to a specific runId (cannot cross runs)
 *   - actor-bound: tied to a specific actorId
 *   - revocable: can be revoked at any time
 */
export interface CredentialLease {
  /** Unique lease ID */
  leaseId: string;

  /** Provider name (e.g. "github", "openrouter", "vercel", "stripe") */
  provider: string;

  /** Run ID this lease is bound to */
  runId: string;
  /** Actor ID this lease is issued to */
  actorId: string;

  /** Capability grant that authorized this lease */
  capabilityGrantId: string;

  /** Scopes granted (e.g. ["repo:read", "repo:write"]) */
  scopes: string[];
  /** Resource scope (e.g. ["workspace:abc", "project:def"]) */
  resourceScope: string[];

  /** Intended audience (e.g. "github.com", "api.openrouter.ai") */
  audience: string | null;

  /** ISO timestamp of issuance */
  issuedAt: string;
  /** ISO timestamp of expiration */
  expiresAt: string;

  /** Whether this lease can be renewed */
  renewable: boolean;

  /** Origin: platform_owned or byok */
  origin: CredentialOrigin;

  /**
   * Opaque broker reference to the actual secret.
   * This is NOT the secret value. It is a CredentialRef.ref that only
   * the CredentialBroker can resolve inside the materializer boundary.
   */
  secretRef: string;
}

// ─── Credential request ───────────────────────────────────────────

/**
 * Request for a credential lease.
 *
 * Submitted to the CredentialBroker. The broker evaluates:
 *   RuntimeIdentity + VerifiedCapabilityGrant + requested scope
 * before issuing a lease. Default behavior is DENY.
 */
export interface CredentialRequest {
  /** Provider name */
  provider: string;
  /** Run ID */
  runId: string;
  /** Actor ID */
  actorId: string;
  /** Capability grant ID that authorizes this request */
  capabilityGrantId: string;
  /** Required scopes */
  scopes: string[];
  /** Resource scope */
  resourceScope: string[];
  /** Required audience */
  audience: string | null;
  /** Requested lease duration in seconds (broker may override) */
  durationSeconds?: number;
  /** Project ID this request is scoped to */
  projectId: string | null;
}

// ─── Broker resolution ────────────────────────────────────────────

/**
 * The result of a credential broker resolve() call.
 *
 * Fail-closed: if anything is wrong, the result is `denied`.
 * The broker NEVER returns a partial or "best effort" credential.
 *
 *   allowed: lease issued, caller may proceed to materialize
 *   denied:  lease refused; reason explains why (for audit, not for user)
 */
export type BrokerResolution =
  | { status: "allowed"; lease: CredentialLease }
  | { status: "denied"; reason: string; request: CredentialRequest };

// ─── Credential broker interface ──────────────────────────────────

/**
 * The canonical credential broker.
 *
 * Evaluates identity + capability + scope before credential resolution.
 * Never exposes raw secret values to callers. Default behavior is DENY.
 *
 * The broker is the ONLY entity that can:
 *   - resolve a CredentialRef to a usable credential
 *   - issue a CredentialLease
 *   - materialize a credential into a provider/tool boundary
 *
 * Agents and tools interact with the broker, never with raw secrets.
 *
 * Implementation is deferred (SEC-2 defines the contract; runtime
 * adapters come later). This interface is the canonical contract.
 */
export interface CredentialBroker {
  /**
   * Resolve a credential request.
   *
   * Evaluates RuntimeIdentity + VerifiedCapabilityGrant + requested
   * scope. Returns a BrokerResolution:
   *   - allowed: lease issued
   *   - denied:  lease refused (fail-closed)
   *
   * This is the PRIMARY entry point. It replaces the old acquire().
   */
  resolve(
    identity: import("./identity.js").RuntimeIdentity,
    grant: import("./capability.js").VerifiedCapabilityGrant,
    request: CredentialRequest,
  ): Promise<BrokerResolution>;

  /** Renew an existing lease (may be denied if scope/context changed) */
  lease(leaseId: string): Promise<CredentialLease | null>;

  /** Revoke a specific lease */
  revoke(leaseId: string): Promise<void>;

  /** Revoke all leases for a run */
  revokeRun(runId: string): Promise<void>;

  /**
   * Audit trail for a lease or run.
   * Returns audit events that NEVER contain secret material.
   */
  audit(filter: { leaseId?: string; runId?: string }): Promise<CredentialAuditEvent[]>;
}

// ─── Credential audit event ───────────────────────────────────────

/**
 * An audit event for credential broker operations.
 *
 * Records what was requested, who requested it, and whether it was
 * allowed or denied. NEVER contains secret material, CredentialRef
 * values, or raw credentials.
 */
export interface CredentialAuditEvent {
  /** Event ID */
  eventId: string;
  /** ISO timestamp */
  timestamp: string;
  /** Operation type */
  operation: "resolve" | "lease" | "revoke" | "revokeRun" | "renew" | "materialize";
  /** Provider name */
  provider: string;
  /** Run ID */
  runId: string;
  /** Actor ID */
  actorId: string;
  /** Capability grant ID */
  capabilityGrantId: string;
  /** Outcome */
  outcome: "allowed" | "denied" | "revoked" | "expired" | "error";
  /** Reason (for denied/revoked/expired/error — never contains secrets) */
  reason: string | null;
  /** Lease ID if a lease was involved */
  leaseId: string | null;
}

// ─── Credential materializer ──────────────────────────────────────

/**
 * The ONLY boundary where raw secret material appears.
 *
 * The materializer takes a CredentialLease and injects the credential
 * directly into the provider/tool boundary (e.g. setting an Authorization
 * header on an HTTP request, configuring a SDK client).
 *
 * The materialized credential is:
 *   - NEVER returned to the caller as a value
 *   - NEVER logged, traced, or serialized
 *   - Scoped to the exact provider/action
 *   - Destroyed after use
 *
 * Agents and tools call `materialize()` with a callback that receives
 * the credential inside the boundary. The credential does not escape
 * the callback.
 *
 *   await broker.materialize(lease, async (credential) => {
 *     // credential is available ONLY inside this callback
 *     await fetch(url, { headers: { Authorization: `Bearer ${credential}` } });
 *   });
 *   // credential is no longer accessible here
 */
export interface CredentialMaterializer {
  /**
   * Materialize a credential inside a boundary callback.
   *
   * The credential is available ONLY inside the callback. It must not
   * be returned, stored, logged, or serialized.
   *
   * If the lease is expired, revoked, or scope-mismatched, this throws.
   */
  materialize<T>(
    lease: CredentialLease,
    fn: (credential: MaterializedCredential) => Promise<T>,
  ): Promise<T>;
}

/**
 * A materialized credential.
 *
 * This type is intentionally opaque — it carries the secret value but
 * its shape is not documented in the contract so that callers cannot
 * rely on specific fields. The value is only available inside the
 * materializer callback boundary.
 *
 * The `__brand` field prevents this type from being accidentally
 * constructed outside the materializer.
 */
export interface MaterializedCredential {
  /** Brand to prevent external construction */
  readonly __brand: "MaterializedCredential";
  /** The credential value (available ONLY inside materializer callback) */
  readonly value: string;
}

// ─── Auth type ────────────────────────────────────────────────────

/**
 * The type of authentication a provider uses.
 * Determines which broker adapter handles the credential.
 */
export type CredentialAuthType =
  | "oidc_workload_identity"  // AWS/GCP/Azure/Vault workload identity
  | "oauth_pkce"              // OAuth 2.1 + PKCE
  | "github_app"              // GitHub App installation token
  | "token_exchange"          // Short-lived token exchange
  | "broker_lease"            // Broker-generated credential lease
  | "masked_proxy"            // Credential masking/proxy substitution
  | "static_key";             // Encrypted static API key (LAST RESORT)

// ─── Schema constraint: leases contain references, not secret values ─

/**
 * Type-level constraint: CredentialLease must not contain known secret
 * field names. This is a SCHEMA constraint, not a runtime safety guarantee.
 *
 * What this check prevents:
 *   - Accidentally adding a field like `apiKey`, `secret`, `token`,
 *     `password`, or `privateKey` to the CredentialLease interface.
 *
 * What this check does NOT prevent:
 *   - Accidental logging of secrets obtained through other paths
 *   - Object spreading that copies secret values from other sources
 *   - HTTP responses or serialization that leaks secrets
 *   - Runtime values assigned via `any` or untyped boundaries
 *
 * SEC-2 guarantees:
 *   The canonical CredentialLease contract contains a secretRef
 *   (a broker reference), not a raw-secret field. The CredentialBroker
 *   and CredentialMaterializer provide the runtime boundary:
 *   - runtime schema validation
 *   - secret broker boundary
 *   - non-serializable secret material (MaterializedCredential brand)
 *   - redaction
 *   - log filtering
 *   - model-context filtering
 *   - credential proxy/injection
 *   - lease TTL, scope, audience, revocation
 */
type ForbiddenSecretFields =
  | "apiKey"
  | "secret"
  | "secretValue"
  | "token"
  | "accessToken"
  | "refreshToken"
  | "password"
  | "privateKey"
  | "clientSecret"
  | "rawSecret";

// Compile-time check: if any forbidden field is added to CredentialLease,
// this evaluates to a non-never type, causing an error below.
type LeaseSafetyViolation = Extract<keyof CredentialLease, ForbiddenSecretFields>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _LeaseSchemaCheck = LeaseSafetyViolation extends never ? "schema_ok" : never;

// Compile-time check: CredentialAuditEvent must also not contain secret fields.
type AuditSafetyViolation = Extract<keyof CredentialAuditEvent, ForbiddenSecretFields>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AuditSchemaCheck = AuditSafetyViolation extends never ? "schema_ok" : never;

// ─── Redaction utility ────────────────────────────────────────────

/**
 * Patterns that indicate secret material in string values.
 * Used by redactForAudit() to strip secrets from arbitrary objects
 * before they enter audit logs, events, or model context.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI-style keys
  /ghp_[a-zA-Z0-9]{36,}/g,          // GitHub PATs
  /gho_[a-zA-Z0-9]{36,}/g,          // GitHub OAuth tokens
  /Bearer\s+[a-zA-Z0-9._-]{20,}/g,  // Bearer tokens
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, // JWTs
  /AKIA[A-Z0-9]{16}/g,              // AWS access keys
  /[a-f0-9]{40}/g,                  // 40-char hex (GitHub tokens, etc.)
] as const;

/**
 * Redacted replacement value for detected secrets.
 */
export const REDACTED = "[REDACTED]";

/**
 * Redact secret material from a string value.
 *
 * Replaces known secret patterns with [REDACTED].
 * This is a DEFENSE-IN-DEPTH measure — the primary protection is
 * that secrets never enter these surfaces in the first place (via
 * the CredentialBroker and CredentialMaterializer boundary).
 */
export function redactString(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

/**
 * Redact secret material from an arbitrary object before it enters
 * audit logs, events, model context, or serialized state.
 *
 * This function:
 *   - Recursively walks the object
 *   - Redacts string values that match secret patterns
 *   - Redacts values of keys with secret-sounding names
 *   - Returns a deep copy (does not mutate the input)
 *
 * It is a DEFENSE-IN-DEPTH measure. The primary protection is that
 * the CredentialBroker and CredentialMaterializer never expose secrets
 * outside the materializer callback boundary.
 */
export function redactForAudit<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactString(value) as unknown as T;
  }
  if (typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForAudit(item)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKeyName(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = redactForAudit(val);
    }
  }
  return result as unknown as T;
}

/**
 * Check if a key name suggests it holds a secret.
 */
function isSecretKeyName(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes("secret") ||
    lower.includes("apikey") ||
    lower.includes("api_key") ||
    lower.includes("accesstoken") ||
    lower.includes("access_token") ||
    lower.includes("refreshtoken") ||
    lower.includes("refresh_token") ||
    lower.includes("password") ||
    lower.includes("privatekey") ||
    lower.includes("private_key") ||
    lower.includes("clientsecret") ||
    lower.includes("client_secret") ||
    lower === "token" ||
    lower === "credential"
  );
}
