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
