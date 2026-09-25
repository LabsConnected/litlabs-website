import { describe, expect, it } from "vitest";
import { executePlan, MemoryExecutionStore } from "./engine";
import { createExecutorRegistry } from "./registry";
import type { ExecutionPlan, RouterStep } from "@/lib/intent-router/types";

const plan: ExecutionPlan = {
  id: "plan-test",
  schemaVersion: "1.0",
  prompt: "test plan",
  primaryIntent: "mixed",
  createdAt: new Date().toISOString(),
  steps: [
    {
      id: "plan-test:inspect_project:inspect",
      key: "inspect",
      type: "inspect_project",
      intent: "code",
      dependsOn: [],
      inputs: {},
      outputs: { project: "data" },
      approval: "none",
      retryable: true,
      condition: { type: "all_dependencies_succeeded" },
      executionPolicy: { timeoutMs: 1000, maxAttempts: 1, heartbeatMs: 10, leaseTimeoutMs: 100, idempotency: "required" },
    },
    {
      id: "plan-test:generate_music:music",
      key: "music",
      type: "generate_music",
      intent: "music",
      dependsOn: [],
      inputs: {},
      outputs: { audio: "audio" },
      approval: "none",
      retryable: true,
      condition: { type: "all_dependencies_succeeded" },
      executionPolicy: { timeoutMs: 1000, maxAttempts: 1, heartbeatMs: 10, leaseTimeoutMs: 100, idempotency: "required" },
    },
  ],
};

function executor(type: RouterStep["type"], delay = 0) {
  return {
    type,
    async execute(step: RouterStep) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return { outputs: [{ id: `${step.key}-artifact`, kind: type === "generate_music" ? ("audio" as const) : ("data" as const) }] };
    },
  };
}

describe("execution engine", () => {
  it("executes independent steps concurrently and persists completion", async () => {
    const registry = createExecutorRegistry([executor("inspect_project", 30), executor("generate_music", 30)]);
    const store = new MemoryExecutionStore();
    const started = Date.now();
    const result = await executePlan({ plan, registry, store });
    expect(Date.now() - started).toBeLessThan(80);
    expect(result.state.status).toBe("complete");
    expect((await store.load(plan.id))?.steps.music.status).toBe("complete");
  });

  it("blocks approval-required work without replaying completed dependencies", async () => {
    const approvalPlan = { ...plan, steps: [{ ...plan.steps[0], approval: "before_external_write" as const }] };
    const registry = createExecutorRegistry([executor("inspect_project")]);
    const result = await executePlan({ plan: approvalPlan, registry, store: new MemoryExecutionStore() });
    expect(result.state.status).toBe("waiting_approval");
    expect(result.state.steps.inspect.status).toBe("waiting_approval");
  });
});
