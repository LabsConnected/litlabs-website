import { describe, expect, it } from "vitest";
import { routeIntent } from "@/lib/intent-router";
import { buildPlan } from "@/lib/planner";
import { resolveBuildRoute } from "./build-routing";

/**
 * Behavioral routing tests — every case drives a REAL prompt through
 * routeIntent, then the same resolveBuildRoute decision BuildConsole
 * runs, then buildPlan for the plan-level guarantees. No hand-written
 * routing metadata: a classification regression fails here.
 */

async function decide(prompt: string, context: { activeProjectId?: string } = {}) {
  const output = await routeIntent({ prompt, context });
  if (output.type !== "intent") return { decision: { kind: "chat" as const }, result: null };
  return { decision: resolveBuildRoute(output.result), result: output.result };
}

describe("build routing — fail closed to chat", () => {
  it.each([
    // Chat, questions, comparisons
    "how does the api component work",
    "what is the difference between a website and an app",
    "tell me how to build a new app",
    "explain how to create a project",
    "should i build a website?",
    "is it possible to create a website",
    "do you know how to make an app",
    "i wonder if you could build me a site",
    "build me a website?",
    // File-scope work and existing-project edits
    "write a function to parse dates",
    "new component for my app",
    "new logo for my website",
    "make my website better",
    "update the existing website",
    // F1: media keywords inside non-media work are project work —
    // mixed results containing non-media intents never surface-route.
    "fix the image upload bug",
    "fix the music player",
    "deploy the video app",
    "make a photo gallery component",
    "write tests for the audio player",
    "fix the layout responsiveness",
    // A media request targeting an existing project is still project
    // work — the asset belongs inside it, not on a bare creator surface.
    "make an image for my website",
  ])("routes %j to chat without creating a project", async (prompt) => {
    const { decision, result } = await decide(prompt);
    expect(decision.kind).toBe("chat");
    if (result) {
      const plan = buildPlan(prompt, result);
      expect(plan.steps.some((step) => step.type === "create_project")).toBe(false);
    }
  });
});

describe("build routing — explicit creation requests", () => {
  it.each([
    "create a new website project",
    "build me a new app",
    "can you build me a website?",
    "could you create a new app?",
    "start a new project",
    "spin up a new site",
  ])("creates a project for %j", async (prompt) => {
    const { decision, result } = await decide(prompt);
    expect(decision.kind).toBe("create");
    expect(result).not.toBeNull();
    if (result) {
      const plan = buildPlan(prompt, result);
      expect(plan.steps.some((step) => step.type === "create_project")).toBe(true);
    }
  });
});

describe("build routing — media/design surfaces", () => {
  it.each([
    ["make an image of a cat", "creator", "image"],
    ["make a video of a cat", "creator", "video"],
    ["make me a song", "creator", "music"],
    ["design a logo", "creator", "image"],
    ["make a song and a video", "creator", "video"],
    ["generate a thumbnail for the video", "creator", "video"],
  ])(
    "routes %j to the %s=%s surface",
    async (prompt, param, value) => {
      const { decision, result } = await decide(prompt);
      expect(decision.kind).toBe("surface");
      if (decision.kind === "surface") {
        expect(decision.surface[param as "creator" | "tool"]).toBe(value);
      }
      if (result) {
        const plan = buildPlan(prompt, result);
        expect(plan.steps.some((step) => step.type === "create_project")).toBe(false);
      }
    },
  );
});

describe("build routing — no double creation through the Studio second hop", () => {
  it("refuses create_project in the plan once a project id is pinned", async () => {
    // Hop 1 (dashboard): an explicit ask with no project pinned — the
    // decision mints exactly one project and the plan carries the step.
    const first = await decide("build me a new app");
    expect(first.decision.kind).toBe("create");
    expect(first.result?.target?.projectId).toBeUndefined();
    const firstPlan = buildPlan("build me a new app", first.result!);
    expect(firstPlan.steps.filter((step) => step.type === "create_project")).toHaveLength(1);

    // Hop 2 (studio): the same prompt re-routed with the freshly pinned
    // ?project=<id> as activeProjectId — the way runLiTT feeds it. The
    // target is now pinned, and the plan can never mint a second
    // project no matter how explicit the original ask was.
    const second = await decide("build me a new app", { activeProjectId: "proj-9f3" });
    expect(second.result?.target?.projectId).toBe("proj-9f3");
    const secondPlan = buildPlan("build me a new app", second.result!);
    expect(secondPlan.steps.some((step) => step.type === "create_project")).toBe(false);
  });
});
