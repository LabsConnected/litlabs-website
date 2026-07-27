/**
 * LiTT Kernel — Zod Schemas
 *
 * Runtime validation for all Kernel types. These enforce the control
 * contract at the boundaries (API requests, DB reads, event payloads).
 */
import { z } from "zod";

// ─── Primitives ─────────────────────────────────────────────────

export const LiTTModeSchema = z.enum([
  "think",
  "research",
  "create",
  "build",
  "review",
  "ship",
  "status",
  "learn",
]);

export const TruthClassSchema = z.enum([
  "verified_fact",
  "reported_fact",
  "reasoned_inference",
  "estimate",
  "opinion",
  "unknown",
]);

export const CapabilityStateSchema = z.enum([
  "ready",
  "offline",
  "connecting",
  "limited",
  "requires_approval",
  "degraded",
  "unavailable",
  "unknown",
]);

export const ContextSourceSchema = z.enum([
  "conversation",
  "memory",
  "project",
  "mission",
  "canvas",
  "capability",
  "world_model",
  "workspace_graph",
  "user_profile",
  "none",
]);

export const SpecialistRoleSchema = z.enum([
  "planner",
  "researcher",
  "engineer",
  "designer",
  "teacher",
  "security_reviewer",
  "critic",
  "historian",
  "scientist",
  "financial_analyst",
  "writer",
  "qa",
  "devops",
  "executor",
]);

export const ActionRiskSchema = z.enum(["low", "medium", "high", "critical"]);
export const ReflectionPolicySchema = z.enum(["none", "light", "full"]);

// ─── Capability Record ──────────────────────────────────────────

export const CapabilityRecordSchema = z.object({
  id: z.string(),
  category: z.string(),
  state: CapabilityStateSchema,
  verifiedAt: z.string(),
  expiresAt: z.string().optional(),
  reason: z.string().optional(),
  provider: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  costClass: z.enum(["free", "low", "medium", "high"]).optional(),
  latencyClass: z.enum(["instant", "fast", "slow"]).optional(),
});

// ─── Execution Budget ───────────────────────────────────────────

export const ExecutionBudgetSchema = z.object({
  maximumCostCents: z.number().default(50),
  maximumLatencyMs: z.number().default(30000),
  minimumQuality: z.number().default(0.7),
  maximumToolCalls: z.number().default(5),
  maximumAgents: z.number().default(1),
  maximumReflectionPasses: z.number().default(1),
});

// ─── Skill Definition ───────────────────────────────────────────

export const SkillDefinitionSchema = z.object({
  id: z.string(),
  version: z.string(),
  description: z.string(),
  supportedModes: z.array(LiTTModeSchema),
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  requiredCapabilities: z.array(z.string()).default([]),
  optionalCapabilities: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high"]),
  handler: z.string(),
});

// ─── World Model ────────────────────────────────────────────────

export const GoalStateSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: z.enum(["active", "completed", "abandoned"]),
  confidence: z.number().min(0).max(1),
  provenance: z.string(),
});

export const BlockerStateSchema = z.object({
  id: z.string(),
  text: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  resolvedAt: z.string().optional(),
});

export const DependencyStateSchema = z.object({
  id: z.string(),
  text: z.string(),
  onType: z.string(),
  onId: z.string(),
});

export const AssumptionStateSchema = z.object({
  id: z.string(),
  text: z.string(),
  confidence: z.number().min(0).max(1),
  provenance: z.string(),
});

export const UnknownStateSchema = z.object({
  id: z.string(),
  text: z.string(),
  investigationStatus: z.enum(["open", "investigating", "resolved"]),
});

export const DecisionStateSchema = z.object({
  id: z.string(),
  text: z.string(),
  rationale: z.string(),
  decidedAt: z.string(),
  reversible: z.boolean(),
});

export const LiTTWorldModelSchema = z.object({
  userGoals: z.array(GoalStateSchema).default([]),
  activeProjectId: z.string().nullable(),
  activeMissionId: z.string().nullable(),
  activeCanvasId: z.string().nullable(),
  blockers: z.array(BlockerStateSchema).default([]),
  dependencies: z.array(DependencyStateSchema).default([]),
  assumptions: z.array(AssumptionStateSchema).default([]),
  unknowns: z.array(UnknownStateSchema).default([]),
  decisions: z.array(DecisionStateSchema).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  lastUpdatedAt: z.string(),
});

// ─── Canvas Focus ───────────────────────────────────────────────

export const CanvasFocusStateSchema = z.object({
  activeCanvasId: z.string().nullable(),
  recentCanvasIds: z.array(z.string()).default([]),
  pinnedCanvasIds: z.array(z.string()).default([]),
  lastModifiedCanvasId: z.string().nullable(),
  lastReferencedBlockId: z.string().nullable(),
});

// ─── Control Decision ───────────────────────────────────────────

export const LiTTControlDecisionSchema = z.object({
  requestId: z.string(),
  createdAt: z.string(),
  routing: z.object({
    mode: LiTTModeSchema,
    domains: z.array(z.string()).default([]),
    requiresProject: z.boolean(),
    requiresCurrentInformation: z.boolean(),
    requiresPrivateData: z.boolean(),
    requiresExecution: z.boolean(),
  }),
  epistemics: z.object({
    expectedTruthClasses: z.array(TruthClassSchema).default([]),
    minimumConfidence: z.number().min(0).max(1),
    verificationRequired: z.boolean(),
  }),
  context: z.object({
    sourceTypes: z.array(ContextSourceSchema).default([]),
    conversationId: z.string(),
    memoryIds: z.array(z.string()).default([]),
    projectId: z.string().optional(),
    missionId: z.string().optional(),
    canvasId: z.string().optional(),
    connectorIds: z.array(z.string()).default([]),
  }),
  execution: z.object({
    skillIds: z.array(z.string()).default([]),
    capabilityIds: z.array(z.string()).default([]),
    modelProfileId: z.string(),
    toolIds: z.array(z.string()).default([]),
    budget: ExecutionBudgetSchema,
  }),
  planning: z.object({
    required: z.boolean(),
    specialistRoles: z.array(SpecialistRoleSchema).default([]),
    parallelAllowed: z.boolean(),
  }),
  governance: z.object({
    risk: ActionRiskSchema,
    approvalRequired: z.boolean(),
    reflection: ReflectionPolicySchema,
  }),
});

// ─── Intent Classification ──────────────────────────────────────

export const IntentClassificationSchema = z.object({
  mode: LiTTModeSchema,
  domains: z.array(z.string()).default([]),
  requiresProject: z.boolean(),
  requiresCurrentInformation: z.boolean(),
  requiresPrivateData: z.boolean(),
  requiresExecution: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

// ─── Kernel Context ─────────────────────────────────────────────

export const KernelContextSchema = z.object({
  decision: LiTTControlDecisionSchema,
  worldModel: LiTTWorldModelSchema,
  capabilities: z.array(CapabilityRecordSchema).default([]),
  canvasFocus: CanvasFocusStateSchema,
  userId: z.string().nullable(),
  conversationId: z.string().nullable(),
  projectId: z.string().nullable(),
  missionId: z.string().nullable(),
  canvasId: z.string().nullable(),
});
