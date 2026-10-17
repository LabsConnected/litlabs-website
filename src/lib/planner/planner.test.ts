import { describe, expect, it } from "vitest";
import { buildPlan, validatePlan } from "./planner";
import type { IntentRouterResult } from "@/lib/intent-router/types";

const result = (overrides: Partial<IntentRouterResult>): IntentRouterResult => ({
  schemaVersion: "1.1",
  primaryIntent: "mixed",
  secondaryIntents: ["music", "website"],
  intents: ["music", "website"],
  confidence: 0.9,
  ambiguity: "none",
  consequence: "reversible",
  action: "create",
  actionMatched: false,
  requestsNewProject: false,
  requestsMediaGeneration: false,
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

  it("omits create_project unless the prompt is an explicit, matched new-project request", () => {
    // needsProject alone is not a creation signal: file-scope work inside a
    // project must not plan a silent create_project step.
    const fileScope = buildPlan(
      "write a function to parse dates",
      result({
        primaryIntent: "code",
        secondaryIntents: [],
        action: "generate",
        actionMatched: true,
        requestsNewProject: false,
      }),
    );
    expect(fileScope.steps.some((step) => step.type === "create_project")).toBe(false);

    // A defaulted "create" action (unmatched) must not count either.
    const defaulted = buildPlan(
      "what is the difference between a website and an app",
      result({
        primaryIntent: "mixed",
        secondaryIntents: ["website", "code"],
        requestsNewProject: true,
        actionMatched: false,
      }),
    );
    expect(defaulted.steps.some((step) => step.type === "create_project")).toBe(false);

    const explicit = buildPlan(
      "create a new website",
      result({
        primaryIntent: "website",
        secondaryIntents: [],
        action: "create",
        actionMatched: true,
        requestsNewProject: true,
      }),
    );
    expect(explicit.steps.some((step) => step.type === "create_project")).toBe(true);
    expect(() => validatePlan(explicit)).not.toThrow();
  });

  it("never plans create_project when a project is already pinned — no double-creation", () => {
    // The dashboard composer mints the project up front and pins its id
    // in ?project=<id>. Studio's second hop runs the same prompt through
    // routeIntent with activeProjectId set, so result.target.projectId
    // is present — and the plan must not mint a second project no matter
    // how explicit the original ask was.
    const pinned = buildPlan(
      "build me a new app",
      result({
        primaryIntent: "code",
        secondaryIntents: [],
        action: "generate",
        actionMatched: true,
        requestsNewProject: true,
        target: { projectId: "proj-pinned" },
      }),
    );
    expect(pinned.steps.some((step) => step.type === "create_project")).toBe(false);
    expect(() => validatePlan(pinned)).not.toThrow();
  });
});
