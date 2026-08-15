/**
 * Canonical policy decision contracts.
 *
 * A PolicyDecision is the output of the permission engine. It determines
 * whether an action is allowed, denied, or requires approval.
 *
 * Policy precedence (implemented in later phases):
 *   1. disabled tool
 *   2. tenant/org deny
 *   3. user deny
 *   4. environment restriction
 *   5. sensitive-action deny
 *   6. resource-scope check
 *   7. capability-grant check
 *   8. sandbox requirement
 *   9. network policy
 *  10. credential capability
 *  11. deterministic allow/ask rule
 *  12. classifier recommendation
 *  13. approval
 *
 * This is the ONE canonical source. The existing `ApprovalLevel` in
 * agent-core/types.ts ("allow"|"ask"|"deny") is a verified 1:1 alias
 * for PolicyEffect ("allow"→"allow", "ask"→"require_approval",
 * "deny"→"deny"). This is the policy OUTCOME dimension, not approval
 * STRENGTH — those are separate (see migration map in index.ts).
 */

import type { ExecutionMode, InteractionMode } from "./identity.js";

// ─── Policy effect ────────────────────────────────────────────────

/**
 * The outcome of a policy evaluation.
 *
 * allow: proceed without asking
 * deny: reject — no amount of approval can override
 * require_approval: ask the user; if headless, deny
 */
export type PolicyEffect = "allow" | "deny" | "require_approval";

// ─── Action risk ──────────────────────────────────────────────────

/**
 * Risk tier for an action.
 *
 * low: read-only, safe research, inspect
 * medium: workspace edits, local builds, git commit
 * high: git push, external API calls, deployments
 * critical: production deploy, force push, destructive DB ops, financial actions
 */
export type ActionRisk = "low" | "medium" | "high" | "critical";

// ─── Environment ──────────────────────────────────────────────────

/**
 * The deployment environment an action targets.
 *
 * local: developer machine (PowerShell, CLI)
 * development: dev server/preview
 * preview: non-production cloud environment
 * production: live production environment
 */
export type Environment = "local" | "development" | "preview" | "production";

// ─── Policy decision ──────────────────────────────────────────────

/**
 * The canonical policy decision.
 *
 * Produced by the permission engine for every consequential action.
 * Includes machine-readable reason codes and policy/version metadata.
 */
export interface PolicyDecision {
  /** The effect: allow, deny, or require_approval */
  effect: PolicyEffect;
  /** The action being evaluated (e.g. "git.push", "files.write") */
  action: string;
  /** Actor ID making the request */
  actorId: string;
  /** Resource scope (e.g. ["workspace:abc123", "project:def456"]) */
  resourceScope: string[];
  /** Environment the action targets */
  environment: Environment;
  /** Risk tier */
  risk: ActionRisk;
  /** Whether a verified sandbox is required for this action */
  sandboxRequired: boolean;
  /** Network destinations required (hostnames or IPs) */
  networkDestinations: string[];
  /** Credential capabilities required (e.g. ["github:repo", "vercel:deploy"]) */
  credentialCapabilities: string[];
  /** Estimated cost in USD, if known */
  estimatedCostUsd?: number;
  /** Approval scope if approval is needed */
  approvalScope?: ApprovalScope;
  /** Machine-readable reason codes explaining the decision */
  reasonCodes: string[];
  /** Policy engine version that produced this decision */
  policyVersion: string;
  /** Timestamp (ms since epoch) */
  decidedAt: number;
}

// ─── Approval scope ───────────────────────────────────────────────

/**
 * How long an approval remains valid.
 *
 * once: valid for one execution only
 * run: valid for the duration of one run
 * session: valid for the user's session
 * project: valid for the project (until revoked)
 */
export type ApprovalScope = "once" | "run" | "session" | "project";

// ─── Policy context ───────────────────────────────────────────────

/**
 * Input to the permission engine.
 *
 * Contains everything needed to make a deterministic decision.
 */
export interface PolicyContext {
  /** Actor making the request */
  actorId: string;
  /** Action being evaluated */
  action: string;
  /** Execution mode (PLAN/ACT/AUTO) */
  executionMode: ExecutionMode;
  /** Whether a human is present */
  interaction: InteractionMode;
  /** Environment the action targets */
  environment: Environment;
  /** Resource scope */
  resourceScope: string[];
  /** Network destinations required */
  networkDestinations: string[];
  /** Credential capabilities required */
  credentialCapabilities: string[];
  /** Whether a sandbox is available */
  sandboxAvailable: boolean;
  /** Estimated cost in USD, if known */
  estimatedCostUsd?: number;
}

// ─── Headless policy rule ─────────────────────────────────────────

/**
 * In headless mode:
 *   ALLOW → execute
 *   REQUIRE_APPROVAL → deny (nobody present to approve)
 *   DENY → deny
 *
 * Never convert REQUIRE_APPROVAL to ALLOW because nobody is present.
 */
export function applyHeadlessPolicy(effect: PolicyEffect): PolicyEffect {
  if (effect === "require_approval") {
    return "deny";
  }
  return effect;
}

// ─── Reason codes ─────────────────────────────────────────────────

/**
 * Standard reason codes for policy decisions.
 * These are machine-readable, not human-facing.
 */
export const REASON_CODES = {
  TOOL_DISABLED: "tool_disabled",
  TENANT_DENY: "tenant_deny",
  USER_DENY: "user_deny",
  ENVIRONMENT_RESTRICTION: "environment_restriction",
  SENSITIVE_ACTION_DENY: "sensitive_action_deny",
  RESOURCE_SCOPE_DENIED: "resource_scope_denied",
  CAPABILITY_INSUFFICIENT: "capability_insufficient",
  SANDBOX_REQUIRED: "sandbox_required",
  NETWORK_POLICY_DENIED: "network_policy_denied",
  CREDENTIAL_INSUFFICIENT: "credential_insufficient",
  DETERMINISTIC_ALLOW: "deterministic_allow",
  DETERMINISTIC_ASK: "deterministic_ask",
  CLASSIFIER_RECOMMENDATION: "classifier_recommendation",
  APPROVAL_REQUIRED: "approval_required",
  APPROVAL_GRANTED: "approval_granted",
  APPROVAL_DENIED: "approval_denied",
  HEADLESS_DENY: "headless_deny",
} as const;

export type ReasonCode = (typeof REASON_CODES)[keyof typeof REASON_CODES];
