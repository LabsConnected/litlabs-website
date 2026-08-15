/**
 * Canonical identity contracts.
 *
 * Every LiTT execution has:
 *   - An ActorIdentity (who/what is making the request)
 *   - A RunIdentity (one execution context with a globally unique runId)
 *
 * Identity is never trusted from the caller without verification.
 * Privilege level is never caller-supplied — it is always derived from
 * the capability grant + policy decision.
 *
 * This is the ONE canonical source. Other systems (litt-kernel,
 * litt-intelligence, terminal-server) must import from here, not
 * duplicate these types.
 */

// ─── Actor kinds ──────────────────────────────────────────────────

/**
 * The kind of actor making a request.
 * - user: A human user (identified by Clerk userId or equivalent)
 * - agent: An AI agent acting on behalf of a user
 * - service: A backend service (terminal-server, cron, webhook)
 * - system: LiTT internal system (kernel, scheduler)
 */
export type ActorKind = "user" | "agent" | "service" | "system";

// ─── Actor identity ───────────────────────────────────────────────

/**
 * Who is making the request.
 *
 * Separates human identity, agent identity, service identity, and
 * system identity. Never trust caller-supplied privilege — always
 * derive from CapabilityGrant + PolicyDecision.
 */
export interface ActorIdentity {
  /** Unique actor ID within the tenant (e.g. Clerk userId, service name) */
  actorId: string;
  /** What kind of actor this is */
  kind: ActorKind;
  /** Tenant/organization ID */
  tenantId: string;
  /** User ID if the actor is a user or agent acting for a user */
  userId: string | null;
  /** Agent ID if this is an agent actor (subagent, voice agent, etc.) */
  agentId: string | null;
  /** Human-readable label for audit logs */
  label: string;
}

// ─── Run identity ─────────────────────────────────────────────────

/**
 * One execution context.
 *
 * Every meaningful LiTT task becomes a canonical run with a globally
 * unique runId. This ID correlates:
 *   actor → run → policy decision → approval → tool execution → sensory event
 */
export interface RunIdentity {
  /** Globally unique run ID */
  runId: string;
  /** Tenant/organization ID */
  tenantId: string;
  /** User ID (may be null for headless automations) */
  userId: string | null;
  /** Conversation ID this run belongs to */
  conversationId: string | null;
  /** Project ID if this run operates on a project */
  projectId: string | null;
  /** Mission ID if this run is part of a mission */
  missionId: string | null;
  /** Execution mode (PLAN/ACT/AUTO) */
  executionMode: ExecutionMode;
  /** Whether a human is present to approve */
  interaction: InteractionMode;
  /** ISO timestamp of run creation */
  createdAt: string;
}

// ─── Execution mode ───────────────────────────────────────────────

/**
 * Canonical execution modes.
 *
 * PLAN: read-only. No mutations, no commands that write.
 * ACT:  normal workspace development. Mutations require approval.
 * AUTO: auto-execute only actions permitted by capability grant,
 *       sandbox, resource scope, network policy, budget, and
 *       credential scope. AUTO never auto-authorizes production
 *       deployment, force push, destructive DB ops, financial actions,
 *       public posting, credential administration, or privilege escalation.
 *
 * This is the canonical type. The existing `MissionMode` in execution.ts
 * is a compatibility alias.
 */
export type ExecutionMode = "plan" | "act" | "auto";

// ─── Interaction mode ─────────────────────────────────────────────

/**
 * Whether a human is present to approve actions.
 *
 * Interactive: a human is present and can approve/deny.
 * Headless: no human present. ASK → DENY. Never convert ASK to ALLOW.
 */
export type InteractionMode = "interactive" | "headless";

// ─── Authentication strength ──────────────────────────────────────

/**
 * How strongly a principal was authenticated.
 *
 * This is a SEPARATE dimension from ActorKind and CapabilityGrant.
 * A service principal may have `standard` strength (mTLS), while a
 * user principal may have `mfa` strength (password + TOTP).
 *
 * Privileged operations may require a minimum authentication strength.
 * The credential broker and policy engine consult this before
 * granting access.
 *
 *   none:     unauthenticated (anonymous / pre-auth)
 *   weak:     single-factor, short-lived (e.g. magic link without verification)
 *   standard: single-factor authenticated (password, service token, API key)
 *   strong:   multi-factor or hardware-backed (passkey, WebAuthn, mTLS + token)
 *   mfa:      explicit multi-factor authentication completed
 */
export type AuthenticationStrength =
  | "none"
  | "weak"
  | "standard"
  | "strong"
  | "mfa";

// ─── Principal ─────────────────────────────────────────────────────

/**
 * The type of principal making a request.
 *
 * This mirrors ActorKind but is named for the principal-concept used
 * in identity contexts and credential broker requests. A Principal is
 * a verified or unverified identity; trust is determined by
 * AuthenticationStrength + CapabilityGrant verification, not by the
 * principal type alone.
 */
export type PrincipalType = ActorKind;

// ─── Identity context ──────────────────────────────────────────────

/**
 * The full identity context for a request.
 *
 * This is what the credential broker and policy engine evaluate before
 * granting access. It binds:
 *   - WHO is making the request (principalId + principalType)
 *   - WHAT session they are in (sessionId)
 *   - WHICH tenant/workspace they belong to
 *   - HOW strongly they were authenticated
 *
 * IdentityContext alone is NOT authorization. It must be combined with
 * a verified CapabilityGrant and a PolicyDecision before credentials
 * are resolved.
 *
 * Callers CANNOT self-assign authentication strength. The strength is
 * set by the authentication boundary (Clerk, service mesh, etc.) and
 * verified by the identity resolver before it enters this context.
 */
export interface IdentityContext {
  /** Unique principal ID (e.g. Clerk userId, service ID, agent ID) */
  principalId: string;
  /** What kind of principal: user | agent | service | system */
  principalType: PrincipalType;
  /** Session ID this identity belongs to (may be null for one-shot calls) */
  sessionId: string | null;
  /** Tenant / organization ID */
  tenantId: string;
  /** Workspace ID if scoped to a workspace */
  workspaceId: string | null;
  /** Project ID if scoped to a project */
  projectId: string | null;
  /** How strongly this principal was authenticated */
  authenticationStrength: AuthenticationStrength;
  /** ISO timestamp when the identity context was established */
  establishedAt: string;
}

// ─── Runtime identity ──────────────────────────────────────────────

/**
 * The complete identity for a single runtime execution.
 *
 * Combines:
 *   - RunIdentity (the execution context: runId, mode, project, etc.)
 *   - IdentityContext (the verified principal context)
 *
 * This is what flows through the credential broker, policy engine,
 * and execution capsule. It is the canonical "who is running this"
 * object.
 *
 * RuntimeIdentity is constructed by the identity resolver, NOT by
 * callers. Callers provide claims; the resolver verifies them and
 * produces a RuntimeIdentity. This prevents self-escalation.
 */
export interface RuntimeIdentity {
  /** The run context */
  run: RunIdentity;
  /** The verified principal context */
  identity: IdentityContext;
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Generate a run ID with a prefix and random suffix.
 * Format: run_<timestamp>_<random>
 */
export function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generate an actor ID for a service actor.
 */
export function serviceActor(
  serviceId: string,
  tenantId: string,
  label?: string,
): ActorIdentity {
  return {
    actorId: `svc:${serviceId}`,
    kind: "service",
    tenantId,
    userId: null,
    agentId: null,
    label: label ?? serviceId,
  };
}

/**
 * Generate an actor ID for a system actor.
 */
export function systemActor(
  systemId: string,
  tenantId: string,
  label?: string,
): ActorIdentity {
  return {
    actorId: `sys:${systemId}`,
    kind: "system",
    tenantId,
    userId: null,
    agentId: null,
    label: label ?? systemId,
  };
}

// ─── Identity context helpers ─────────────────────────────────────

/**
 * Build an IdentityContext from an ActorIdentity.
 *
 * The caller MUST supply the authentication strength — it is NOT
 * derived from the actor. This prevents a caller from constructing
 * a high-trust identity context without going through the auth boundary.
 *
 * The authentication boundary (Clerk, service mesh, etc.) sets the
 * strength. This helper just packages it.
 */
export function buildIdentityContext(
  actor: ActorIdentity,
  authenticationStrength: AuthenticationStrength,
  options?: {
    sessionId?: string | null;
    workspaceId?: string | null;
    projectId?: string | null;
  },
): IdentityContext {
  return {
    principalId: actor.actorId,
    principalType: actor.kind,
    sessionId: options?.sessionId ?? null,
    tenantId: actor.tenantId,
    workspaceId: options?.workspaceId ?? null,
    projectId: options?.projectId ?? null,
    authenticationStrength,
    establishedAt: new Date().toISOString(),
  };
}

/**
 * Build a RuntimeIdentity from a RunIdentity and IdentityContext.
 *
 * This is the canonical "who is running this" object. It should be
 * constructed by the identity resolver after verification, not by
 * untrusted callers.
 */
export function buildRuntimeIdentity(
  run: RunIdentity,
  identity: IdentityContext,
): RuntimeIdentity {
  return { run, identity };
}

/**
 * Minimum authentication strength required for a given risk tier.
 *
 * This is a DEFAULT policy, not the final word. The policy engine
 * may impose stricter requirements.
 *
 *   low:      standard (any authenticated principal)
 *   medium:   standard
 *   high:     strong (MFA or hardware-backed)
 *   critical: mfa (explicit multi-factor)
 */
export function minAuthStrengthForRisk(
  risk: "low" | "medium" | "high" | "critical",
): AuthenticationStrength {
  switch (risk) {
    case "low":
      return "standard";
    case "medium":
      return "standard";
    case "high":
      return "strong";
    case "critical":
      return "mfa";
  }
}

/**
 * Check whether an authentication strength meets or exceeds a minimum.
 *
 * Strength ordering: none < weak < standard < strong < mfa
 */
export function meetsAuthStrength(
  actual: AuthenticationStrength,
  required: AuthenticationStrength,
): boolean {
  const order: AuthenticationStrength[] = [
    "none",
    "weak",
    "standard",
    "strong",
    "mfa",
  ];
  return order.indexOf(actual) >= order.indexOf(required);
}
