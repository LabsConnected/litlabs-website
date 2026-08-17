/**
 * Mission Domain Types — LiTT Autopilot V1
 *
 * Strict mission domain model for persistent, evidence-driven autonomous missions.
 * These are the canonical type definitions that all mission operations use.
 *
 * Integrates with existing agent-core infrastructure:
 * - RuntimeStore extends with mission field
 * - ToolRegistry adds mission tools
 * - VerificationGate evaluates step completion
 * - ExecutionGateway is the sole execution authority
 */

// ============================================================================
// MISSION STATUS — Terminal states of a mission
// ============================================================================

export type MissionStatus =
  | "planning"   // Baseline captured, ready for agent loop
  | "working"    // Steps are being executed
  | "verifying"  // Waiting for verification gate
  | "blocked"    // Requires human approval or external dependency
  | "failed"     // Exhausted recovery paths or runtime error
  | "complete"   // VERIFIED by VerificationGate (not model claim)
  | "cancelled"; // Human or runtime cancelled

// ============================================================================
// STEP STATUS — Status of individual mission steps
// ============================================================================

export type MissionStepStatus =
  | "pending"    // Waiting for execution
  | "working"    // Currently being worked on
  | "verifying"  // Waiting for verification
  | "passed"     // VerificationGate approved
  | "failed"     // Verification failed, may retry
  | "blocked"    // Requires human intervention
  | "skipped";   // Deliberately skipped

// ============================================================================
// MISSION MODE — Autonomy level
// ============================================================================

export type MissionMode = "plan" | "act" | "auto";

// ============================================================================
// EVIDENCE TYPE — Types of evidence that can be captured
// ============================================================================

export type EvidenceType =
  | "repository_status"   // project.status result
  | "git_baseline"        // Initial git state snapshot
  | "file_read"           // Content of a file read
  | "search_result"       // Result of a search
  | "diff"                // Git diff of changes
  | "test_result"         // Test execution result
  | "typecheck_result"    // Type checking result
  | "build_result"        // Build execution result
  | "command_result"      // Shell command result
  | "verification_result" // Verification gate decision
  | "approval_result"     // Human approval decision
  | "checkpoint"          // Saved checkpoint data
  | "error"               // Error/failure evidence
  | "health_result";      // Health check result

// ============================================================================
// SUPPORTING TYPES (referenced by Mission and MissionStep)
// ============================================================================

export interface RepositoryBaseline {
  projectRoot: string;
  gitHead: string | null;
  branch: string | null;
  gitStatus: {
    dirtyFiles: string[];
    stagedFiles: string[];
    untrackedFiles: string[];
  };
  remoteUrl: string | null;
  capturedAt: string;
}

export interface MissionEvidence {
  id: string;
  missionId: string;
  stepId: string | null;
  type: EvidenceType;
  source: string;
  timestamp: string;
  success?: boolean;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface Checkpoint {
  id: string;
  missionId: string;
  stepId: string | null;
  provenAt: string[];
  changes: string[];
  remaining: string[];
  resumePoint: string;
  retryBudgets: Record<string, number>;
  runtimeVersion: string;
  createdAt: string;
}

export interface ActionRecord {
  description: string;
  tool?: string;
  timestamp: string;
  status: "success" | "failed" | "approved" | "denied";
}

export interface VerificationResult {
  checkId: string;
  passed: boolean;
  evidence: string;
  timestamp: string;
}

export interface RetryBudget {
  modelRetries: number;
  repairAttempts: number;
  toolRetries: number;
  providerFailureThreshold: number;
}

export type ProviderFailure =
  | "EMPTY_RESPONSE"
  | "MALFORMED_RESPONSE"
  | "SCHEMA_VALIDATION_FAILED"
  | "UNKNOWN_TOOL"
  | "INVALID_TOOL_ARGS"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_TIMEOUT"
  | "RATE_LIMIT"
  | "MODEL_REFUSAL"
  | "CONTEXT_LIMIT"
  | "TOOL_FAILURE"
  | "EXECUTION_TIMEOUT"
  | "VERIFICATION_FAILURE"
  | "POLICY_DENIAL"
  | "APPROVAL_REQUIRED";

export interface ProviderState {
  currentProvider: string | null;
  currentModel: string | null;
  providerHealthy: boolean;
  lastError: string | null;
  fallbacks: string[];
}

// ============================================================================
// FACTORY HELPER FUNCTIONS
// ============================================================================

export function generateMissionId(): string {
  return `mission_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

export function generateStepId(): string {
  return `step_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

export function generateEvidenceId(): string {
  return `evidence_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

export function generateCheckpointId(): string {
  return `checkpoint_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

export function createDefaultRetryBudget(): RetryBudget {
  return {
    modelRetries: 2,
    repairAttempts: 3,
    toolRetries: 3,
    providerFailureThreshold: 5,
  };
}