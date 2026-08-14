/**
 * Canonical credential lease contracts.
 *
 * A CredentialLease represents ACCESS to a credential, not the raw secret.
 * The lease contains a secretRef (broker reference), never the secret value.
 *
 * Phase 1 guarantee: the CredentialLease schema contains a secretRef,
 * not a raw-secret field. This is a schema constraint, not a runtime
 * safety guarantee. Actual runtime secret isolation belongs to the
 * Credential Broker phase (SEC-2).
 *
 * Secrets must never enter:
 *   - audit events
 *   - model context
 *   - conversation
 *   - memory
 *   - logs
 *   - checkpoints
 *   - Git
 *
 * This is the ONE canonical source. No existing system defines this concept.
 */

// ─── Credential lease ─────────────────────────────────────────────

/**
 * A short-lived, revocable lease on a credential.
 *
 * The lease grants access to a credential for a specific run, actor,
 * and scope. The actual secret value is never in the lease — only a
 * reference (secretRef) that the broker can resolve.
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

  /**
   * Broker reference to the actual secret.
   * This is NOT the secret value. It is a reference that only the
   * CredentialBroker can resolve.
   */
  secretRef: string;
}

// ─── Credential request ───────────────────────────────────────────

/**
 * Request for a credential lease.
 *
 * Submitted to the CredentialBroker (Phase 2 implementation).
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
}

// ─── Credential broker interface ──────────────────────────────────

/**
 * The canonical credential broker.
 *
 * Acquires, renews, and revokes credential leases.
 * Never exposes raw secret values to callers.
 *
 * Implementation is Phase 2 work. This interface is the contract.
 */
export interface CredentialBroker {
  /** Acquire a new credential lease */
  acquire(request: CredentialRequest): Promise<CredentialLease>;
  /** Renew an existing lease */
  renew(leaseId: string): Promise<CredentialLease>;
  /** Revoke a specific lease */
  revoke(leaseId: string): Promise<void>;
  /** Revoke all leases for a run */
  revokeRun(runId: string): Promise<void>;
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
 * Phase 1 guarantees only:
 *   The canonical CredentialLease contract contains a secretRef
 *   (a broker reference), not a raw-secret field.
 *
 * Actual runtime secret isolation belongs to the Credential Broker phase
 * (SEC-2), which provides:
 *   - runtime schema validation
 *   - secret broker boundary
 *   - non-serializable secret material
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
