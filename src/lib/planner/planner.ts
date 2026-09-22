import { randomUUID } from "node:crypto";
import type {
  ExecutionPlan,
  ExecutionPolicy,
  IntentRouterResult,
  RouterStep,
  StepType,
} from "@/lib/intent-router/types";

const DEFAULT_POLICY: ExecutionPolicy = {
  timeoutMs: 120_000,
  maxAttempts: 2,
  heartbeatMs: 10_000,
  leaseTimeoutMs: 45_000,
  idempotency: "required",
};

const outputsFor: Partial<Record<StepType, RouterStep["outputs"]>> = {
  inspect_project: { project: "data" },
  generate_brand_direction: { brand: "data" },
  generate_image: { image: "image" },
  generate_music: { audio: "audio" },
  generate_video: { video: "video" },
  edit_code: { code: "code" },
  build_project: { build: "code" },
  run_tests: { report: "data" },
  create_preview: { preview: "deployment" },
  deploy_project: { deployment: "deployment" },
  publish_project: { publication: "deployment" },
};

function step(
  planId: string,
  key: string,
  type: StepType,
  intent: RouterStep["intent"],
  dependsOn: string[] = [],
  options: Partial<Pick<RouterStep, "inputs" | "approval" | "retryable" | "condition" | "executionPolicy">> = {},
): RouterStep {
  return {
    id: `${planId}:${type}:${key}`,
    key,
    type,
    intent,
    dependsOn,
    inputs: options.inputs ?? {},
    outputs: outputsFor[type] ?? {},
    approval: options.approval ?? "none",
    retryable: options.retryable ?? true,
    condition: options.condition ?? { type: "all_dependencies_succeeded" },
    executionPolicy: options.executionPolicy ?? DEFAULT_POLICY,
  };
}

function addCreativeSteps(planId: string, result: IntentRouterResult, steps: RouterStep[]): string {
  const intent = result.primaryIntent === "mixed" ? result.secondaryIntents[0] ?? "design" : result.primaryIntent;
  const key = `generate_${intent}`;
  const type: StepType = intent === "music" ? "generate_music" : intent === "video" ? "generate_video" : "generate_image";
  steps.push(step(planId, key, type, intent));
  return key;
}

export function buildPlan(prompt: string, result: IntentRouterResult): ExecutionPlan {
  const planId = `plan_${randomUUID()}`;
  const steps: RouterStep[] = [];
  const needsProject = result.requirements.needsProject;
  let tail: string[] = [];

  if (needsProject && !result.target?.projectId) {
    steps.push(step(planId, "create_project", "create_project", "project_action", [], { approval: "before_external_write" }));
    tail = ["create_project"];
  }
  if (result.requirements.needsFiles) {
    steps.push(step(planId, "inspect_project", "inspect_project", result.primaryIntent, tail));
    tail = ["inspect_project"];
  }

  const intents = result.primaryIntent === "mixed" ? result.secondaryIntents : [result.primaryIntent];
  const creativeKeys: string[] = [];
  for (const intent of intents) {
    if (["image", "video", "music"].includes(intent)) {
      const creativeResult = { ...result, primaryIntent: intent } as IntentRouterResult;
      const key = addCreativeSteps(planId, creativeResult, steps);
      creativeKeys.push(key);
    }
  }

  if (intents.includes("website") || intents.includes("code") || intents.includes("debug") || intents.includes("project_action")) {
    const type: StepType = intents.includes("debug") || result.action === "edit" || result.action === "fix" ? "edit_code" : "build_project";
    steps.push(step(planId, type, type, intents.includes("debug") ? "debug" : intents.includes("website") ? "website" : "code", tail));
    tail = [type];
  }

  if (intents.includes("design") && creativeKeys.length === 0) {
    steps.push(step(planId, "generate_brand_direction", "generate_brand_direction", "design", tail));
    tail = ["generate_brand_direction"];
  }
  if (creativeKeys.length > 1) {
    steps.push(step(planId, "attach_assets", "attach_assets", "mixed", [...creativeKeys, ...tail]));
    tail = ["attach_assets"];
  }

  if (result.action === "fix" || intents.includes("code") || intents.includes("website") || intents.includes("debug")) {
    steps.push(step(planId, "run_tests", "run_tests", result.primaryIntent, tail));
    tail = ["run_tests"];
  }
  if (intents.includes("website") || intents.includes("code") || result.primaryIntent === "mixed") {
    steps.push(step(planId, "create_preview", "create_preview", "website", tail));
    tail = ["create_preview"];
  }
  if (intents.includes("deploy") || result.action === "deploy" || result.action === "publish") {
    steps.push(step(planId, "deploy_project", "deploy_project", "deploy", tail, { approval: "before_external_write" }));
    steps.push(step(planId, "publish_project", "publish_project", "deploy", ["deploy_project"], {
      approval: "before_publish",
      condition: { type: "all_dependencies_succeeded" },
    }));
  }

  if (steps.length === 0) {
    steps.push(step(planId, "inspect_project", "inspect_project", result.primaryIntent, [], { retryable: false }));
  }
  validatePlan({ id: planId, schemaVersion: "1.0", prompt, primaryIntent: result.primaryIntent, steps, createdAt: new Date().toISOString() });
  return { id: planId, schemaVersion: "1.0", prompt, primaryIntent: result.primaryIntent, steps, createdAt: new Date().toISOString() };
}

export function validatePlan(plan: ExecutionPlan): void {
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const current of plan.steps) {
    if (ids.has(current.id) || keys.has(current.key)) throw new Error(`Duplicate plan step identity: ${current.id}`);
    ids.add(current.id);
    keys.add(current.key);
  }
  for (const current of plan.steps) {
    for (const dependency of current.dependsOn) {
      if (!keys.has(dependency)) throw new Error(`Missing dependency ${dependency} for ${current.key}`);
    }
    for (const binding of Object.values(current.inputs)) {
      if (binding.source === "step_output" && !keys.has(binding.stepKey)) throw new Error(`Invalid binding ${binding.stepKey}`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error(`Cycle detected at ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    const current = plan.steps.find((candidate) => candidate.key === key);
    current?.dependsOn.forEach(visit);
    visiting.delete(key);
    visited.add(key);
  };
  plan.steps.forEach((current) => visit(current.key));
}
