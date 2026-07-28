/**
 * LiTT Kernel — Type Definitions
 *
 * These types define the control contract between the Kernel and its
 * subsystems. They are the single source of truth for:
 *   - request intent (mode, domains, requirements)
 *   - epistemics (truth class, confidence, verification)
 *   - context (project, mission, canvas, capabilities)
 *   - execution (skills, capabilities, models, tools, budget)
 *   - planning (specialist roles, parallelism)
 *   - governance (risk, approval, reflection)
 *
 * See docs/litt/00-constitution/ for the immutable principles that govern
 * how these types are used.
 */

// ─── Modes ──────────────────────────────────────────────────────

/**
 * Canonical LiTT modes. Mode describes the OPERATION.
 * Domain (separate) describes the EXPERTISE.
 */
export type LiTTMode =
  | "think"
  | "research"
  | "create"
  | "build"
  | "review"
  | "ship"
  | "status"
  | "learn";

// ─── Truth & Confidence ─────────────────────────────────────────

export type TruthClass =
  | "verified_fact"
  | "reported_fact"
  | "reasoned_inference"
  | "estimate"
  | "opinion"
  | "unknown";

// ─── Capabilities ───────────────────────────────────────────────

export type CapabilityState =
  | "ready"
  | "offline"
  | "connecting"
  | "limited"
  | "requires_approval"
  | "degraded"
  | "unavailable"
  | "unknown";

export type CapabilityRecord = {
  id: string;
  category: string;
  state: CapabilityState;
  verifiedAt: string;
  expiresAt?: string;
  reason?: string;
  provider?: string;
  permissions: string[];
  dependencies: string[];
  costClass?: "free" | "low" | "medium" | "high";
  latencyClass?: "instant" | "fast" | "slow";
};

// ─── Skills ─────────────────────────────────────────────────────

export type SkillDefinition = {
  id: string;
  version: string;
  description: string;
  supportedModes: LiTTMode[];
  inputSchema: unknown;
  outputSchema: unknown;
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  permissions: string[];
  riskLevel: "low" | "medium" | "high";
  handler: string;
};

// ─── Execution Budget ───────────────────────────────────────────

export type ExecutionBudget = {
  maximumCostCents: number;
  maximumLatencyMs: number;
  minimumQuality: number;
  maximumToolCalls: number;
  maximumAgents: number;
  maximumReflectionPasses: number;
};

// ─── Context Sources ────────────────────────────────────────────

export type ContextSource =
  | "conversation"
  | "memory"
  | "project"
  | "mission"
  | "canvas"
  | "capability"
  | "world_model"
  | "workspace_graph"
  | "user_profile"
  | "none";

// ─── Specialist Roles ───────────────────────────────────────────

export type SpecialistRole =
  | "planner"
  | "researcher"
  | "engineer"
  | "designer"
  | "teacher"
  | "security_reviewer"
  | "critic"
  | "historian"
  | "scientist"
  | "financial_analyst"
  | "writer"
  | "qa"
  | "devops"
  | "executor";

// ─── Risk & Reflection ──────────────────────────────────────────

export type ActionRisk = "low" | "medium" | "high" | "critical";

export type ReflectionPolicy =
  | "none"
  | "light"
  | "full";

// ─── Project Info (for prompt composer) ─────────────────────────

export interface ProjectInfo {
  id?: string;
  name?: string;
  repoUrl?: string;
  description?: string;
  stack?: string;
  goals?: string;
  branch?: string;
  framework?: string;
  language?: string;
  repoOwner?: string;
}

// ─── Control Decision ───────────────────────────────────────────

/**
 * The canonical Kernel control decision. Produced for every request.
 * Persisted for serious actions so they can be audited.
 */
export type LiTTControlDecision = {
  requestId: string;
  createdAt: string;

  routing: {
    mode: LiTTMode;
    domains: string[];
    requiresProject: boolean;
    requiresCurrentInformation: boolean;
    requiresPrivateData: boolean;
    requiresExecution: boolean;
  };

  epistemics: {
    expectedTruthClasses: TruthClass[];
    minimumConfidence: number;
    verificationRequired: boolean;
  };

  context: {
    sourceTypes: ContextSource[];
    conversationId: string;
    memoryIds: string[];
    projectId?: string;
    missionId?: string;
    canvasId?: string;
    connectorIds: string[];
  };

  execution: {
    skillIds: string[];
    capabilityIds: string[];
    modelProfileId: string;
    toolIds: string[];
    budget: ExecutionBudget;
  };

  planning: {
    required: boolean;
    specialistRoles: SpecialistRole[];
    parallelAllowed: boolean;
  };

  governance: {
    risk: ActionRisk;
    approvalRequired: boolean;
    reflection: ReflectionPolicy;
  };
};

// ─── World Model ────────────────────────────────────────────────

export type GoalState = {
  id: string;
  text: string;
  status: "active" | "completed" | "abandoned";
  confidence: number;
  provenance: string;
};

export type BlockerState = {
  id: string;
  text: string;
  severity: "low" | "medium" | "high";
  resolvedAt?: string;
};

export type DependencyState = {
  id: string;
  text: string;
  onType: string;
  onId: string;
};

export type AssumptionState = {
  id: string;
  text: string;
  confidence: number;
  provenance: string;
};

export type UnknownState = {
  id: string;
  text: string;
  investigationStatus: "open" | "investigating" | "resolved";
};

export type DecisionState = {
  id: string;
  text: string;
  rationale: string;
  decidedAt: string;
  reversible: boolean;
};

export type LiTTWorldModel = {
  userGoals: GoalState[];
  activeProjectId: string | null;
  activeMissionId: string | null;
  activeCanvasId: string | null;
  blockers: BlockerState[];
  dependencies: DependencyState[];
  assumptions: AssumptionState[];
  unknowns: UnknownState[];
  decisions: DecisionState[];
  confidence: number;
  lastUpdatedAt: string;
};

// ─── Canvas Focus ───────────────────────────────────────────────

export type CanvasFocusState = {
  activeCanvasId: string | null;
  recentCanvasIds: string[];
  pinnedCanvasIds: string[];
  lastModifiedCanvasId: string | null;
  lastReferencedBlockId: string | null;
};

// ─── Kernel Context (read-only composed view) ───────────────────

/**
 * The read-only view the Kernel composes for subsystems.
 * Subsystems consume this instead of maintaining competing state.
 */
export type KernelContext = {
  decision: LiTTControlDecision;
  worldModel: LiTTWorldModel;
  capabilities: CapabilityRecord[];
  canvasFocus: CanvasFocusState;
  userId: string | null;
  conversationId: string | null;
  projectId: string | null;
  missionId: string | null;
  canvasId: string | null;
};

// ─── Kernel Events ──────────────────────────────────────────────

export type KernelEvent =
  | { type: "decision.created"; decision: LiTTControlDecision }
  | { type: "capability.changed"; capabilityId: string; newState: CapabilityState }
  | { type: "canvas.focus.changed"; canvasId: string | null }
  | { type: "project.activated"; projectId: string }
  | { type: "mission.activated"; missionId: string }
  | { type: "approval.required"; decision: LiTTControlDecision; reason: string }
  | { type: "action.blocked"; decision: LiTTControlDecision; reason: string };

// ─── Intent Classification Result ───────────────────────────────

export type IntentClassification = {
  mode: LiTTMode;
  domains: string[];
  requiresProject: boolean;
  requiresCurrentInformation: boolean;
  requiresPrivateData: boolean;
  requiresExecution: boolean;
  confidence: number;
  reasoning: string;
};
