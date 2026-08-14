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
} from "./identity.js";
export {
  generateRunId,
  serviceActor,
  systemActor,
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
// compatibility adapters or derived values. Risk, effect, and capability
// permission are separate dimensions and must not be collapsed.
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
// │ ApprovalLevel (types.ts)            │ PolicyEffect (canonical)               │ alias            │
// │   "allow" | "ask" | "deny"           │   "allow" | "require_approval" | "deny"│                  │
// └─────────────────────────────────────┴───────────────────────────────────────┴──────────────────┘
//
// Three separate dimensions (do not collapse):
//   1. Risk:       low / medium / high / critical  (how dangerous)
//   2. Effect:     allow / require_approval / deny  (policy outcome)
//   3. Capability: workspace.read / workspace.write / external.write /
//                  production.deploy / ...          (what kind of operation)
//
// ToolPermissionLevel encodes dimension 3 (capability/kind) and partially
// dimension 1 (risk). It must remain a separate concept from ActionRisk
// and PolicyEffect.
