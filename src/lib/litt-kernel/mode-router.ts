/**
 * LiTT Mode Router
 *
 * Maps a LiTTMode to default skills, tools, model profile, and execution
 * budget. This is the "how does LiTT perform this class of work?" layer.
 *
 * The mode router does NOT override user preferences or capability
 * availability — it provides defaults that the Kernel adjusts based on
 * the capability graph and user settings.
 */

import type { LiTTMode, ExecutionBudget, SpecialistRole } from "./types";

interface ModeDefaults {
  defaultSkills: string[];
  defaultTools: string[];
  defaultModelProfile: string;
  defaultBudget: ExecutionBudget;
  defaultSpecialists: SpecialistRole[];
  parallelAllowed: boolean;
}

// ─── Default budgets per mode ───────────────────────────────────

const BUDGETS: Record<LiTTMode, ExecutionBudget> = {
  think: {
    maximumCostCents: 10,
    maximumLatencyMs: 15000,
    minimumQuality: 0.7,
    maximumToolCalls: 0,
    maximumAgents: 1,
    maximumReflectionPasses: 1,
  },
  research: {
    maximumCostCents: 30,
    maximumLatencyMs: 45000,
    minimumQuality: 0.8,
    maximumToolCalls: 3,
    maximumAgents: 1,
    maximumReflectionPasses: 2,
  },
  create: {
    maximumCostCents: 25,
    maximumLatencyMs: 30000,
    minimumQuality: 0.75,
    maximumToolCalls: 2,
    maximumAgents: 1,
    maximumReflectionPasses: 1,
  },
  build: {
    maximumCostCents: 50,
    maximumLatencyMs: 60000,
    minimumQuality: 0.85,
    maximumToolCalls: 5,
    maximumAgents: 2,
    maximumReflectionPasses: 2,
  },
  review: {
    maximumCostCents: 40,
    maximumLatencyMs: 60000,
    minimumQuality: 0.9,
    maximumToolCalls: 4,
    maximumAgents: 2,
    maximumReflectionPasses: 3,
  },
  ship: {
    maximumCostCents: 30,
    maximumLatencyMs: 120000,
    minimumQuality: 0.95,
    maximumToolCalls: 3,
    maximumAgents: 1,
    maximumReflectionPasses: 3,
  },
  status: {
    maximumCostCents: 5,
    maximumLatencyMs: 10000,
    minimumQuality: 0.9,
    maximumToolCalls: 1,
    maximumAgents: 1,
    maximumReflectionPasses: 1,
  },
  learn: {
    maximumCostCents: 10,
    maximumLatencyMs: 20000,
    minimumQuality: 0.8,
    maximumToolCalls: 1,
    maximumAgents: 1,
    maximumReflectionPasses: 1,
  },
};

// ─── Mode defaults ──────────────────────────────────────────────

const MODE_DEFAULTS: Record<LiTTMode, ModeDefaults> = {
  think: {
    defaultSkills: ["reasoning.general"],
    defaultTools: [],
    defaultModelProfile: "default-reasoning",
    defaultBudget: BUDGETS.think,
    defaultSpecialists: [],
    parallelAllowed: false,
  },
  research: {
    defaultSkills: ["research.current-events", "research.web-search"],
    defaultTools: ["web_search", "fetch"],
    defaultModelProfile: "default-research",
    defaultBudget: BUDGETS.research,
    defaultSpecialists: ["researcher"],
    parallelAllowed: true,
  },
  create: {
    defaultSkills: ["canvas.create", "canvas.update", "creative.generate"],
    defaultTools: ["canvas", "image_generation"],
    defaultModelProfile: "default-creative",
    defaultBudget: BUDGETS.create,
    defaultSpecialists: ["designer", "writer"],
    parallelAllowed: false,
  },
  build: {
    defaultSkills: ["project.edit-files", "project.run-tests", "canvas.update"],
    defaultTools: ["filesystem", "terminal", "canvas"],
    defaultModelProfile: "default-coding",
    defaultBudget: BUDGETS.build,
    defaultSpecialists: ["engineer", "qa"],
    parallelAllowed: true,
  },
  review: {
    defaultSkills: ["project.inspect-files", "review.audit"],
    defaultTools: ["filesystem", "lighthouse", "scanner"],
    defaultModelProfile: "default-analysis",
    defaultBudget: BUDGETS.review,
    defaultSpecialists: ["critic", "security_reviewer", "qa"],
    parallelAllowed: true,
  },
  ship: {
    defaultSkills: ["deployment.vercel-preview", "deployment.publish"],
    defaultTools: ["vercel", "github", "terminal"],
    defaultModelProfile: "default-devops",
    defaultBudget: BUDGETS.ship,
    defaultSpecialists: ["devops", "security_reviewer"],
    parallelAllowed: false,
  },
  status: {
    defaultSkills: ["status.check-capabilities"],
    defaultTools: ["capability_probe"],
    defaultModelProfile: "default-fast",
    defaultBudget: BUDGETS.status,
    defaultSpecialists: [],
    parallelAllowed: false,
  },
  learn: {
    defaultSkills: ["education.create-lesson", "education.explain"],
    defaultTools: [],
    defaultModelProfile: "default-teaching",
    defaultBudget: BUDGETS.learn,
    defaultSpecialists: ["teacher"],
    parallelAllowed: false,
  },
};

/**
 * Returns the default configuration for a mode.
 * The Kernel adjusts these based on capability availability and user prefs.
 */
export function getModeDefaults(mode: LiTTMode): ModeDefaults {
  return MODE_DEFAULTS[mode];
}

/**
 * Returns the default budget for a mode.
 * Convenience accessor for the Kernel.
 */
export function getModeBudget(mode: LiTTMode): ExecutionBudget {
  return BUDGETS[mode];
}
