export interface SubTask {
  agentSlug: string;
  prompt: string;
  provider?: "openrouter" | "bedrock";
  model?: string;
  dependsOn?: string[];
}

export interface PlanGraph {
  goal: string;
  tasks: SubTask[];
}

/**
 * Pure function — previously a class with a single method. Same output,
 * no instance allocation, and V8 can inline the constant `targetModel`
 * read once per process.
 */
export function buildDirectorPlan(goal: string): PlanGraph {
  const normalized = goal.trim();
  const targetModel =
    process.env.NEXT_PUBLIC_MODEL_NAME || "openrouter/owl-alpha";

  const rootId = "root";
  const researcherId = "task-researcher";
  const builderId = "task-builder";

  return {
    goal: normalized,
    tasks: [
      {
        agentSlug: "littlebit",
        prompt: `Decompose and coordinate the following goal: ${normalized}`,
        provider: "openrouter",
        model: targetModel,
      },
      {
        agentSlug: "littlebit",
        prompt: `Research background, constraints, and existing solutions for: ${normalized}`,
        provider: "openrouter",
        model: targetModel,
        dependsOn: [rootId],
      },
      {
        agentSlug: "littcode",
        prompt: `Draft an implementation or content plan for: ${normalized}`,
        provider: "openrouter",
        model: targetModel,
        dependsOn: [researcherId],
      },
      {
        agentSlug: "littlebit",
        prompt: `Review and validate the plan for correctness, risks, and missing steps: ${normalized}`,
        provider: "openrouter",
        model: targetModel,
        dependsOn: [builderId],
      },
    ],
  };
}

/**
 * Backward-compatible class wrapper. Existing imports of
 * `new DirectorGraphPlanner().buildPlan(goal)` continue to work.
 */
export class DirectorGraphPlanner {
  buildPlan(goal: string): PlanGraph {
    return buildDirectorPlan(goal);
  }
}
