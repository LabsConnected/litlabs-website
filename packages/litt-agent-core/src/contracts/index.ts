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
 *              Execution Capsule
 *                      ↓
 *           ┌──────────┼──────────┐
 *           ↓          ↓          ↓
 *         Shell       API       Browser
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
  ApprovalRecord,
  ApprovalRequestInput,
} from "./approval.js";
export {
  generateApprovalId,
  computeInputHash,
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
