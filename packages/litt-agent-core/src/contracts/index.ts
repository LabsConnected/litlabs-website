/**
 * LiTT Canonical Contracts — Barrel Export
 *
 * This is the ONE canonical source of truth for LiTT execution/security
 * vocabulary. All other systems (litt-kernel, litt-intelligence,
 * terminal-server, CLI) must import from here, not duplicate these types.
 *
 * Architecture:
 *
 *                 LiTT CONTRACTS (this package)
 *                      │
 *          ┌───────────┼───────────┐
 *          ↓           ↓           ↓
 *     Agent Core    Kernel    Intelligence
 *          │           │           │
 *          └───────────┼───────────┘
 *                      ↓
 *                Policy Engine
 *                      ↓
 *              Execution Capsule (per Run)
 *                      ↓
 *           ┌──────────┼──────────┐
 *           ↓          ↓          ↓
 *      ToolExec #1  ToolExec #2  ToolExec #N
 *      (Shell)      (API)        (Browser)
 */

// Identity
export type {
  ActorKind,
  ActorIdentity,
  RunIdentity,
  ExecutionMode,
  InteractionMode,
  AuthenticationStrength,
  PrincipalType,
  IdentityContext,
  RuntimeIdentity,
} from "./identity.js";
export {
  generateRunId,
  serviceActor,
  systemActor,
  buildIdentityContext,
  buildRuntimeIdentity,
  minAuthStrengthForRisk,
  meetsAuthStrength,
} from "./identity.js";

// Policy
export type {
  PolicyEffect,
  ActionRisk,
  Environment,
  PolicyDecision,
  ApprovalScope,
  PolicyContext,
  ReasonCode,
} from "./policy.js";
export {
  REASON_CODES,
  applyHeadlessPolicy,
} from "./policy.js";

// Capability
export type {
  CapabilityGrant,
  GrantBudget,
  GrantIntegrity,
  GrantVerificationStatus,
  GrantVerificationResult,
  VerifiedCapabilityGrant,
  CapabilityHealth,
  CapabilityHealthLabel,
} from "./capability.js";
export {
  deriveHealthLabel,
} from "./capability.js";

// Credential
export type {
  CredentialLease,
  CredentialRequest,
  CredentialBroker,
  CredentialAuthType,
} from "./credential.js";

// Network
export type {
  NetworkMode,
  NetworkPolicy,
} from "./network.js";
export {
  DENY_ALL_NETWORK,
  LOCAL_DEV_NETWORK,
  isHostAllowed,
} from "./network.js";

// Resource
export type {
  ResourceBudget,
} from "./resource.js";
export {
  LOCAL_WORKSPACE_BUDGET,
  SANDBOX_BUDGET,
  CHAT_ONLY_BUDGET,
  AUTOMATION_BUDGET,
} from "./resource.js";

// Sensory
export type {
  EventTrust,
  EventSensitivity,
  SensoryEvent,
} from "./sensory.js";
export {
  shouldFilterEvent,
  canBeSystemInstruction,
  generateEventId,
} from "./sensory.js";

// Approval
export type {
  ApprovalStatus,
  OperationDigestInput,
  ApprovalRecord,
  ApprovalRequestInput,
} from "./approval.js";
export {
  generateApprovalId,
  canonicalJSON,
  computeOperationDigest,
  isApprovalValid,
} from "./approval.js";

// Capsule / Execution
export type {
  CapsuleState,
  CapsuleWorkspace,
  CapsuleSandbox,
  ExecutionCapsule,
  EnvironmentBlueprint,
  ToolExecution,
  ToolExecutionResult,
  CreateCapsuleInput,
} from "./capsule.js";
export {
  generateCapsuleId,
  generateExecutionId,
  isCapsuleActive,
  isCapsuleExpired,
} from "./capsule.js";

// ─── Legacy type migration map ────────────────────────────────────
//
// The following legacy types are NOT deleted. They are preserved as
// compatibility adapters or derived values. Risk, effect, capability
// permission, approval strength, and execution mode are separate
// dimensions and must not be collapsed.
//
// ┌─────────────────────────────────────┬───────────────────────────────────────┬──────────────────┐
// │ Legacy type                         │ Canonical contract                    │ Migration status │
// ├─────────────────────────────────────┼───────────────────────────────────────┼──────────────────┤
// │ CapabilityState (8-state enum)      │ CapabilityHealthLabel (derived from   │ derived          │
// │   ready/offline/connecting/limited/  │   CapabilityHealth 5-dim vector)      │                  │
// │   requires_approval/degraded/        │                                       │                  │
// │   unavailable/unknown                │                                       │                  │
// ├─────────────────────────────────────┼───────────────────────────────────────┼──────────────────┤
// │ CapabilityRecord                    │ CapabilityHealth (health vector) +    │ compatibility    │
// │   id/category/state/verifiedAt/      │   CapabilityGrant (authorization)     │ adapter          │
// │   expiresAt/permissions/dependencies │                                       │                  │
// ├─────────────────────────────────────┼───────────────────────────────────────┼──────────────────┤
// │ ToolPermissionLevel (7 levels)      │ SEPARATE DIMENSION — not collapsed    │ preserved        │
// │   read/draft/workspace-write/        │   into ActionRisk or PolicyEffect.    │                  │
// │   external-write/production/         │   Encodes WHAT KIND of operation,     │                  │
// │   financial/destructive              │   not how risky or whether allowed.   │                  │
// │                                     │   Future: derive from PolicyContext    │                  │
// │                                     │   + capability + risk.                │                  │
// ├─────────────────────────────────────┼───────────────────────────────────────┼──────────────────┤
// │ ApprovalRequest (litt-intelligence) │ ApprovalRequestInput +                │ compatibility    │
// │                                     │   OperationDigestInput                │ adapter          │
// ├─────────────────────────────────────┼───────────────────────────────────────┼──────────────────┤
// │ MissionMode (execution.ts)          │ ExecutionMode (canonical)              │ alias            │
// │   "plan" | "act" | "auto"            │   "plan" | "act" | "auto"              │                  │
// ├─────────────────────────────────────┼───────────────────────────────────────┼──────────────────┤
// │ ActionRisk (litt-kernel)            │ ActionRisk (canonical)                 │ alias            │
// │   low/medium/high/critical           │   low/medium/high/critical             │                  │
// ├─────────────────────────────────────┼───────────────────────────────────────┼──────────────────┤
// │ ApprovalLevel (agent-core/types.ts) │ PolicyEffect (canonical)               │ alias            │
// │   "allow" | "ask" | "deny"           │   "allow" | "require_approval" | "deny"│ (verified 1:1)  │
// │                                     │                                       │                  │
// │ VERIFIED: The legacy union is       │                                       │                  │
// │   genuinely 1:1 with PolicyEffect.  │                                       │                  │
// │   "allow"→"allow", "ask"→"require_  │                                       │                  │
// │   approval", "deny"→"deny".         │                                       │                  │
// │   This is NOT approval strength —   │                                       │                  │
// │   it is the policy outcome.         │                                       │                  │
// ├─────────────────────────────────────┼───────────────────────────────────────┼──────────────────┤
// │ ApprovalPolicy (business-ops)       │ SEPARATE DIMENSION — approval         │ preserved        │
// │   "none"|"explicit"|"strong_confirm"│   STRENGTH, not effect.               │                  │
// │                                     │   NOT aliased to PolicyEffect.        │                  │
// │                                     │   Encodes HOW STRONG an approval is.  │                  │
// │                                     │   Future: ApprovalStrength contract.  │                  │
// ├─────────────────────────────────────┼───────────────────────────────────────┼──────────────────┤
// │ ApprovalPolicy (litt-intelligence)  │ SEPARATE DIMENSION — structured       │ preserved        │
// │   { required, autoApproveReadOnly,  │   approval policy that PRODUCES a     │                  │
// │     requireExplicitForMutations,    │   PolicyEffect, but is not itself     │                  │
// │     neverAllow }                    │   the effect. NOT aliased.            │                  │
// │                                     │   Future: PolicyRule contract.        │                  │
// ├─────────────────────────────────────┼───────────────────────────────────────┼──────────────────┤
// │ ApprovalMode (agent-work-queue)     │ SEPARATE DIMENSION — execution        │ preserved        │
// │   "supervised"|"autonomous"|        │   MODE, not approval level.           │                  │
// │   "ask-first"                       │   Related to ExecutionMode but        │                  │
// │                                     │   coarser. NOT aliased.               │                  │
// └─────────────────────────────────────┴───────────────────────────────────────┴──────────────────┘
//
// FIVE separate dimensions (do not collapse):
//   1. Risk:       low / medium / high / critical  (how dangerous)
//   2. Effect:     allow / require_approval / deny  (policy outcome)
//   3. Capability: workspace.read / workspace.write / external.write /
//                  production.deploy / ...          (what kind of operation)
//   4. ApprovalStrength: none / explicit / strong_confirmation
//                  (how strong an approval must be — SEPARATE from effect)
//   5. ExecutionMode: plan / act / auto             (autonomy level)
//
// ToolPermissionLevel encodes dimension 3 (capability/kind) and partially
// dimension 1 (risk). It must remain a separate concept from ActionRisk
// and PolicyEffect.
//
// ApprovalPolicy (business-ops) encodes dimension 4 (approval strength).
// It is NOT the same as PolicyEffect (dimension 2). A require_approval
// effect can be combined with any approval strength:
//   effect=require_approval + strength=explicit
//   effect=require_approval + strength=strong_confirmation
//
// ApprovalLevel ("allow"|"ask"|"deny") IS the same as PolicyEffect —
// it encodes dimension 2 only, not dimension 4. The alias is verified.
