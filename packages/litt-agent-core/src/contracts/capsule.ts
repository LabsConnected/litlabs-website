/**
 * Canonical execution capsule and tool execution contracts.
 *
 * An ExecutionCapsule is a bounded execution environment belonging to a
 * RunIdentity. It is NOT created per individual tool invocation. One capsule
 * typically lives for an entire run (or a bounded execution segment within
 * a run). Multiple ToolExecution records occur inside it.
 *
 * Relationship:
 *
 *   RunIdentity
 *        │
 *   ExecutionCapsule  (one per run, or one per bounded segment)
 *        │
 *        ├─ ToolExecution #1
 *        ├─ ToolExecution #2
 *        ├─ ToolExecution #3
 *        ├─ PTY session
 *        ├─ Browser session
 *        └─ MCP processes
 *
 * The capsule isolates execution from the persistent Kernel:
 *   - isolated workspace
 *   - PTY / browser / MCP
 *   - temporary credentials
 *   - network policy
 *   - CPU/RAM/process limits
 *   - automatic teardown
 *
 * Creating a fresh capsule per tool call would be wasteful (provisioning
 * and tearing down isolation for every read_file, git.status, etc.) and
 * would complicate credential/session continuity.
 *
 * "One persistent brain. Many disposable execution bodies."
 *
 * This is the ONE canonical source. The existing Docker manager is an
 * implementation of this contract.
 */

import type { ActorIdentity, RunIdentity } from "./identity.js";
import type { CapabilityGrant } from "./capability.js";
import type { CredentialLease } from "./credential.js";
import type { NetworkPolicy } from "./network.js";
import type { ResourceBudget } from "./resource.js";
import type { ApprovalRecord } from "./approval.js";

// ─── Capsule state ────────────────────────────────────────────────

/**
 * The lifecycle state of an execution capsule.
 *
 * provisioning → ready → running → (paused → running)* → destroying → destroyed
 * Any state can transition to failed.
 */
export type CapsuleState =
  | "provisioning"
  | "ready"
  | "running"
  | "paused"
  | "destroying"
  | "destroyed"
  | "failed";

// ─── Capsule workspace ────────────────────────────────────────────

/**
 * The workspace an execution capsule operates on.
 */
export interface CapsuleWorkspace {
  /** Workspace root directory */
  root: string;
  /** Git branch, if applicable */
  branch: string | null;
  /** Git worktree ID, if using worktrees */
  worktreeId: string | null;
}

// ─── Capsule sandbox ──────────────────────────────────────────────

/**
 * Sandbox isolation for an execution capsule.
 */
export interface CapsuleSandbox {
  /** Sandbox provider (e.g. "docker", "gvisor", "none") */
  provider: string;
  /** Whether the sandbox isolation has been verified */
  verified: boolean;
}

// ─── Execution capsule ────────────────────────────────────────────

/**
 * A bounded execution environment belonging to a RunIdentity.
 *
 * One capsule typically lives for an entire run (or a bounded execution
 * segment within a run). Multiple ToolExecution records occur inside it.
 * Do NOT create a fresh capsule per tool call.
 *
 * Every capsule must have:
 *   - runId
 *   - capsuleId
 *   - isolated workspace root
 *   - bounded filesystem scope
 *   - process limits
 *   - command timeout
 *   - runtime timeout
 *   - output limits
 *   - network policy
 *   - temporary credential leases
 *   - cancellation
 *   - teardown
 */
export interface ExecutionCapsule {
  /** Unique capsule ID */
  capsuleId: string;

  /** Tenant/organization ID */
  tenantId: string;
  /** User ID */
  userId: string;

  /** Run ID this capsule belongs to */
  runId: string;
  /** Project ID if scoped to a project */
  projectId: string | null;

  /** Environment blueprint ID (reusable environment definition) */
  environmentBlueprintId: string;

  /** Workspace isolation */
  workspace: CapsuleWorkspace;

  /** Sandbox isolation */
  sandbox: CapsuleSandbox;

  /** Network policy ID */
  networkPolicyId: string;

  /** Resource budget ID */
  resourceBudgetId: string;

  /** Credential lease IDs active in this capsule */
  credentialLeaseIds: string[];

  /** Approval context (approvals that authorized this capsule) */
  approvals: ApprovalRecord[];

  /** Current capsule state */
  state: CapsuleState;

  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of expiration (capsule must be destroyed by this time) */
  expiresAt: string;
}

// ─── Environment blueprint ────────────────────────────────────────

/**
 * A reusable environment definition.
 *
 * Allows creating fresh capsules with the same configuration without
 * inheriting any runtime state (PTY, credentials, shell environment).
 */
export interface EnvironmentBlueprint {
  /** Unique blueprint ID */
  blueprintId: string;

  /** Tenant/organization ID */
  tenantId: string;

  /** Human-readable name */
  name: string;

  /** Base image or template (e.g. "node:22", "litt-sandbox:latest") */
  baseImage: string | null;

  /** Tools available in this environment */
  tools: string[];

  /** Default network policy ID */
  defaultNetworkPolicyId: string;

  /** Default resource budget ID */
  defaultResourceBudgetId: string;

  /** Environment variables (references, not values) */
  envVarRefs: string[];

  /** ISO timestamp of creation */
  createdAt: string;
}

// ─── Tool execution ───────────────────────────────────────────────

/**
 * A record of a single tool execution within a capsule.
 *
 * A capsule contains many ToolExecution records. This is the audit trail
 * entry for every consequential operation. It references:
 *   - runId: the run this execution belongs to
 *   - capsuleId: the capsule this execution runs inside (when applicable)
 *   - actorId (via actor): who initiated the execution
 *   - toolId: which tool was invoked
 */
export interface ToolExecution {
  /** Unique execution ID */
  executionId: string;

  /** Run ID this execution belongs to */
  runId: string;
  /** Capsule ID this execution runs inside (null for non-capsule executions) */
  capsuleId: string | null;

  /** Actor identity that initiated this execution */
  actor: ActorIdentity;

  /** Tool ID */
  toolId: string;
  /** Tool inputs (normalized, secrets redacted) */
  inputs: Record<string, unknown>;

  /** Capability grant that authorized this execution */
  capabilityGrantId: string;

  /** Credential lease IDs used */
  credentialLeaseIds: string[];

  /** Approval ID, if approval was required */
  approvalId: string | null;

  /** Policy decision that authorized this execution */
  policyDecision: string;  // PolicyDecision serialized as JSON

  /** Execution result */
  result: ToolExecutionResult;

  /** ISO timestamp of start */
  startedAt: string;
  /** ISO timestamp of completion */
  completedAt: string | null;
  /** Duration in milliseconds */
  durationMs: number | null;
}

// ─── Tool execution result ────────────────────────────────────────

/**
 * The result of a tool execution.
 */
export interface ToolExecutionResult {
  /** Whether the execution succeeded */
  success: boolean;
  /** Human-readable result message (secrets redacted) */
  message: string;
  /** Result data (secrets redacted, safe for audit) */
  data: Record<string, unknown>;
  /** Error code, if failed */
  errorCode: string | null;
  /** Error message, if failed */
  errorMessage: string | null;
}

// ─── Capsule creation input ───────────────────────────────────────

/**
 * Input for creating an execution capsule.
 */
export interface CreateCapsuleInput {
  /** Run identity */
  run: RunIdentity;
  /** Actor identity */
  actor: ActorIdentity;
  /** Capability grant */
  grant: CapabilityGrant;
  /** Environment blueprint ID */
  environmentBlueprintId: string;
  /** Workspace root */
  workspaceRoot: string;
  /** Git branch */
  branch: string | null;
  /** Network policy */
  networkPolicy: NetworkPolicy;
  /** Resource budget */
  resourceBudget: ResourceBudget;
  /** Credential leases */
  credentialLeases: CredentialLease[];
  /** Approvals */
  approvals: ApprovalRecord[];
  /** Capsule TTL in seconds */
  ttlSeconds?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Generate a capsule ID.
 */
export function generateCapsuleId(): string {
  return `cap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generate an execution ID.
 */
export function generateExecutionId(): string {
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Check if a capsule is still active (not destroyed/failed).
 */
export function isCapsuleActive(capsule: ExecutionCapsule): boolean {
  return (
    capsule.state === "provisioning" ||
    capsule.state === "ready" ||
    capsule.state === "running" ||
    capsule.state === "paused"
  );
}

/**
 * Check if a capsule is expired.
 */
export function isCapsuleExpired(capsule: ExecutionCapsule, now: number): boolean {
  return new Date(capsule.expiresAt).getTime() < now;
}
