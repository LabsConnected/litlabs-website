import { describe, expect, it } from "vitest";
import { buildPlan, validatePlan } from "./planner";
import type { IntentRouterResult } from "@/lib/intent-router/types";

const result = (overrides: Partial<IntentRouterResult>): IntentRouterResult => ({
  schemaVersion: "1.1",
  primaryIntent: "mixed",
  secondaryIntents: ["music", "website"],
  confidence: 0.9,
  ambiguity: "none",
  consequence: "reversible",
  action: "create",
  goals: ["make a song and a website"],
  requirements: { needsProject: true, needsFiles: false, needsApproval: false, needsExternalService: true },
  ...overrides,
});

describe("LiTT planner", () => {
  it("creates unique steps and parallel creative work", () => {
    const plan = buildPlan("make a song and a website", result({}));
    expect(new Set(plan.steps.map((step) => step.id)).size).toBe(plan.steps.length);
    expect(plan.steps.some((step) => step.type === "generate_music")).toBe(true);
    expect(plan.steps.some((step) => step.type === "generate_image")).toBe(false);
    expect(plan.steps.some((step) => step.type === "build_project")).toBe(true);
    expect(() => validatePlan(plan)).not.toThrow();
  });

  it("rejects cycles and missing dependencies", () => {
    const plan = buildPlan("make a song", result({ primaryIntent: "music", secondaryIntents: [] }));
    plan.steps[0].dependsOn = ["missing"];
    expect(() => validatePlan(plan)).toThrow("Missing dependency");
  });

  it("adds approval before deploy and publish", () => {
    const plan = buildPlan("deploy it", result({ primaryIntent: "deploy", secondaryIntents: [], action: "deploy", consequence: "external_write" }));
    expect(plan.steps.find((step) => step.type === "deploy_project")?.approval).toBe("before_external_write");
    expect(plan.steps.find((step) => step.type === "publish_project")?.approval).toBe("before_publish");
  });
});
