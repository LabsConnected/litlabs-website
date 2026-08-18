/**
 * Mission State Machine — LiTT Autopilot V1
 *
 * Validated state transitions for missions and steps.
 */

import type { MissionStatus, MissionStepStatus } from "./mission-types.js";

export function isValidMissionTransition(
  from: MissionStatus,
  to: MissionStatus
): boolean {
  const validTransitions: Record<MissionStatus, MissionStatus[]> = {
    planning: ["working", "cancelled"],
    working: ["verifying", "blocked", "cancelled"],
    verifying: ["working", "complete", "blocked", "cancelled"],
    blocked: ["working", "cancelled"],
    failed: [],
    complete: [],
    cancelled: [],
  };

  return validTransitions[from]?.includes(to) ?? false;
}

export function isValidStepTransition(
  from: MissionStepStatus,
  to: MissionStepStatus
): boolean {
  const validTransitions: Record<MissionStepStatus, MissionStepStatus[]> = {
    pending: ["working", "skipped", "failed"],
    // "passed" is allowed directly from "working" — a successful tool
    // execution proves the step without needing a separate verifying phase.
    working: ["verifying", "passed", "failed", "blocked"],
    verifying: ["passed", "failed", "blocked", "working"],
    passed: [],
    failed: ["working", "failed", "blocked", "skipped"],
    blocked: ["working", "skipped"],
    skipped: [],
  };

  return validTransitions[from]?.includes(to) ?? false;
}

export interface TransitionResult {
  allowed: boolean;
  reason?: string;
  suggestions?: string[];
}

export function validateMissionTransition(
  from: MissionStatus,
  to: MissionStatus
): TransitionResult {
  if (from === to) {
    return { allowed: true };
  }

  if (isValidMissionTransition(from, to)) {
    return { allowed: true };
  }

  if (from === "complete" || from === "cancelled" || from === "failed") {
    return {
      allowed: false,
      reason: `Cannot transition from terminal state '${from}'`,
    };
  }

  if (from === "blocked") {
    if (to === "working" || to === "cancelled") {
      return { allowed: true };
    }
  }

  const allValid = ["working", "cancelled"];
  if (from === "verifying") {
    allValid.push("complete");
    allValid.push("blocked");
  }
  if (from === "planning") {
    allValid.push("cancelled");
  }

  return {
    allowed: false,
    reason: `Invalid transition: ${from} → ${to}`,
    suggestions: allValid.map(s => `'${s}'`),
  };
}

export function validateStepTransition(
  from: MissionStepStatus,
  to: MissionStepStatus
): TransitionResult {
  if (from === to) {
    return { allowed: true };
  }

  if (isValidStepTransition(from, to)) {
    return { allowed: true };
  }

  if (from === "passed" || from === "skipped") {
    return {
      allowed: false,
      reason: `Cannot transition from terminal step state '${from}'`,
    };
  }

  return {
    allowed: false,
    reason: `Invalid step transition: ${from} → ${to}`,
    suggestions: ["working", "blocked", "skipped", "failed"],
  };
}

export function deriveStepStatus(
  verificationPassed: boolean,
  requiresApproval: boolean = false
): MissionStepStatus {
  if (requiresApproval) {
    return "blocked";
  }
  return verificationPassed ? "passed" : "failed";
}

export function deriveMissionStatus(
  hasActiveSteps: boolean,
  hasBlockedSteps: boolean,
  allStepsComplete: boolean,
  hasFailures: boolean,
  requiresApproval: boolean = false
): MissionStatus {
  if (requiresApproval) {
    return "blocked";
  }
  if (hasFailures) {
    return "failed";
  }
  if (allStepsComplete) {
    return "complete";
  }
  if (hasActiveSteps) {
    return "working";
  }
  return "planning";
}