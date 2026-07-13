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

export class DirectorGraphPlanner {
  buildPlan(goal: string): PlanGraph {
    const normalized = goal.trim();
    const targetModel =
      process.env.NEXT_PUBLIC_MODEL_NAME || "openrouter/owl-alpha";
    const tasks: SubTask[] = [];

    const rootId = "root";
    tasks.push({
      agentSlug: "littlebit",
      prompt: `Decompose and coordinate the following goal: ${normalized}`,
      provider: "openrouter",
      model: targetModel,
    });

    const researcherId = "task-researcher";
    tasks.push({
      agentSlug: "littlebit",
      prompt: `Research background, constraints, and existing solutions for: ${normalized}`,
      provider: "openrouter",
      model: targetModel,
      dependsOn: [rootId],
    });

    const builderId = "task-builder";
    tasks.push({
      agentSlug: "littcode",
      prompt: `Draft an implementation or content plan for: ${normalized}`,
      provider: "openrouter",
      model: targetModel,
      dependsOn: [researcherId],
    });

    tasks.push({
      agentSlug: "littlebit",
      prompt: `Review and validate the plan for correctness, risks, and missing steps: ${normalized}`,
      provider: "openrouter",
      model: targetModel,
      dependsOn: [builderId],
    });

    return {
      goal: normalized,
      tasks,
    };
  }
}
