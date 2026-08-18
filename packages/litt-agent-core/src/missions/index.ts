/**
 * LiTT Autopilot V1 — Missions Module
 *
 * Canonical mission domain types, state machine, and persistence.
 *
 * This module provides:
 * - Mission domain model (Mission, MissionStep, etc.)
 * - Validated state transitions (mission-state-machine.ts)
 * - Persistent mission store (mission-store.ts)
 *
 * All mission operations must route through ExecutionGateway.
 */

export type {
  MissionStatus,
  MissionStepStatus,
  EvidenceType,
} from "./mission-types.js";

// Mission and MissionStep are defined in mission-entities.ts
export type {
  Mission,
  MissionStep,
  RepositoryBaseline,
  MissionEvidence,
  Checkpoint,
  ActionRecord,
  VerificationResult,
  RetryBudget,
  ProviderFailure,
  ProviderState,
} from "./mission-entities.js";

// Aliases for clarity
export type {
  Mission as MissionModel,
  MissionStep as MissionStepModel,
} from "./mission-entities.js";

export {
  generateMissionId,
  generateStepId,
  generateEvidenceId,
  generateCheckpointId,
  createDefaultRetryBudget,
} from "./mission-types.js";

export {
  isValidMissionTransition,
  isValidStepTransition,
  validateMissionTransition,
  validateStepTransition,
  deriveStepStatus,
  deriveMissionStatus,
} from "./mission-state-machine.js";
export type { TransitionResult } from "./mission-state-machine.js";

export {
  MissionStore,
  createMissionStore,
} from "./mission-store.js";

// Re-export MissionMode from existing location (execution.ts in parent)
export type { MissionMode } from "../execution.js";