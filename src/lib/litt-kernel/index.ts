/**
 * LiTT Kernel — Public API
 *
 * Import from here, not from individual modules:
 *   import { routeKernel, composeSystemPrompt } from "@/lib/litt-kernel";
 */

export { routeKernel, type KernelRequest, type KernelResult } from "./kernel";
export { composeSystemPrompt, getConstitutionBlock } from "./prompt-composer";
export { classifyIntent } from "./intent-router";
export { getModeDefaults, getModeBudget } from "./mode-router";
export {
  serverCapabilityRegistry,
  CAP,
  adaptLegacyCapability,
} from "./capability-registry";
export {
  kernelEventBus,
  emitDecisionCreated,
  emitCapabilityChanged,
  emitCanvasFocusChanged,
  emitApprovalRequired,
  emitActionBlocked,
} from "./event-bus";
export { resolveContext } from "./context-resolver";
export {
  isCapabilityReady,
  getCapabilityState,
  verifyRequiredCapabilities,
  requiresProjectContext,
  requiresApproval,
  classifyRisk,
  determineReflectionPolicy,
  confidenceToHedge,
  isConfidenceSufficientForTruthClass,
} from "./principles";

// Types
export type {
  LiTTMode,
  TruthClass,
  CapabilityState,
  CapabilityRecord,
  SkillDefinition,
  ExecutionBudget,
  ContextSource,
  SpecialistRole,
  ActionRisk,
  ReflectionPolicy,
  LiTTControlDecision,
  GoalState,
  BlockerState,
  DependencyState,
  AssumptionState,
  UnknownState,
  DecisionState,
  LiTTWorldModel,
  CanvasFocusState,
  KernelContext,
  KernelEvent,
  IntentClassification,
  ProjectInfo,
} from "./types";

// Schemas
export {
  LiTTModeSchema,
  TruthClassSchema,
  CapabilityStateSchema,
  CapabilityRecordSchema,
  ExecutionBudgetSchema,
  SkillDefinitionSchema,
  LiTTWorldModelSchema,
  CanvasFocusStateSchema,
  LiTTControlDecisionSchema,
  IntentClassificationSchema,
  KernelContextSchema,
} from "./schemas";
