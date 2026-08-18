/**
 * Mission and MissionStep — Core domain entities
 *
 * Re-exports all types from mission-types.ts for convenient importing.
 */

import type {
  MissionStatus,
  MissionStepStatus,
  MissionMode,
  EvidenceType,
  RepositoryBaseline,
  MissionEvidence,
  Checkpoint,
  ActionRecord,
  VerificationResult,
  RetryBudget,
  ProviderFailure,
  ProviderState,
} from "./mission-types.js";

// Re-export all supporting types
export type {
  MissionStatus,
  MissionStepStatus,
  MissionMode,
  EvidenceType,
  RepositoryBaseline,
  MissionEvidence,
  Checkpoint,
  ActionRecord,
  VerificationResult,
  RetryBudget,
  ProviderFailure,
  ProviderState,
} from "./mission-types.js";

// ============================================================================
// MISSION — The core domain entity
// ============================================================================

export interface Mission {
  id: string;
  version: string;
  goal: string;
  normalizedGoal: string;
  projectRoot: string;
  workspaceId: string | null;
  sessionId: string | null;
  mode: MissionMode;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  currentStepId: string | null;
  steps: MissionStep[];
  baseline: RepositoryBaseline | null;
  evidence: MissionEvidence[];
  checkpoints: Checkpoint[];
  attemptCounters: Record<string, number>;
  retryBudgets: Record<string, RetryBudget>;
  providerState: ProviderState | null;
  blockingReason: string | null;
  failureReason: string | null;
  completionReason: string | null;
  lastHeartbeatAt: number;
  metadata: Record<string, unknown>;
}

// ============================================================================
// MISSION STEP — Individual step in a mission
// ============================================================================

export interface MissionStep {
  id: string;
  sequence: number;
  title: string;
  description: string;
  status: MissionStepStatus;
  requiredEvidence: EvidenceType[];
  dependencies: string[];
  allowedActionScope: string[];
  toolHistory: string[];
  actionHistory: ActionRecord[];
  filesRead: string[];
  filesChanged: string[];
  verificationResults: VerificationResult[];
  attemptCount: number;
  repairAttemptCount: number;
  failureReason: string | null;
  blockingReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}