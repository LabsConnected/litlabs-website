import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { routeIntent } from "@/lib/intent-router";
import { buildPlan } from "@/lib/planner";
import { resolveBuildRoute } from "./build-routing";
import { resolveStudioProjectId } from "@/app/(app)/studio/lib/first-run-handoff";

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
    // F2: information-seeking prompts — asking about creating is not a
    // creation command.
    "could you explain how to create a site",
    "can I build a website with this",
    "any idea how to build a website",
    "give me steps to build a website",
    "I'm wondering if I should make an app",
    "I think I should build an app, what do you think",
    "I want to know how to build an app",
    "recommend a stack to build a new app",
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
    // F1: media noun + software-artifact head noun names a SOFTWARE
    // deliverable — "music player", "image gallery", "design system" are
    // software development involving media, not media generation.
    "make a music player",
    "build an image gallery",
    "write a song parser",
    "write a clip scheduler",
    "write a beat tracker in python",
    "create a design system",
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
    // Direct commands phrased as requests stay commands — "help me
    // create" and "please create" request the work itself.
    "please create a website",
    "build me a website",
    "help me create a website",
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
    // F1: the requested deliverable + governing verb decide the surface —
    // the noun supplies the intent even when no keyword does.
    ["write a song", "creator", "music"],
    ["generate an image", "creator", "image"],
    ["compose a jingle", "creator", "music"],
    ["draw a dragon", "creator", "image"],
    ["create a banner", "creator", "image"],
    ["record a voiceover", "creator", "music"],
    // F1: standalone media bound to a project by a destination qualifier
    // is media work with context — it reaches the creator and NEVER mints
    // another project for the destination.
    ["make a thumbnail for my video", "creator", "video"],
    ["create a video for my new app", "creator", "video"],
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

/**
 * The actual production chain: BuildConsole makes ONE routing call
 * (/api/litt/intent), resolveBuildRoute gates creation on the explicit
 * new-project signal, createManagedStudioProject mints exactly one
 * project, and its id is pinned as ?project=<id> in the Studio URL.
 * Studio resolves that param via resolveStudioProjectId — there is no
 * second routing call on navigation and no second create. The
 * component-level chain (POST /api/studio-projects, idempotency key,
 * single create call, pinned URL) is covered by BuildConsole.test.tsx;
 * these tests pin the contracts on either side of the handoff.
 */
describe("build routing — production creation chain", () => {
  it("the create decision mints one project; the pinned id resolves as the Studio project", async () => {
    const { decision, result } = await decide("build me a new app");
    expect(decision.kind).toBe("create");
    // The dashboard's own result carries no project target — creation is
    // the composer's job, not the router's.
    expect(result?.target?.projectId).toBeUndefined();
    const plan = buildPlan("build me a new app", result!);
    expect(plan.steps.filter((step) => step.type === "create_project")).toHaveLength(1);

    // The URL seam: BuildConsole pins ?project=<new id>; Studio resolves
    // the same param to the active project on initialization.
    const params = new URLSearchParams({ tool: "chat", prompt: "build me a new app", project: "proj-new" });
    expect(resolveStudioProjectId(params.get("project"))).toBe("proj-new");
  });

  it("a run inside the pinned project can never plan a second create", async () => {
    // When the user actually sends the prompt in Studio, /api/litt/run →
    // runLiTT re-routes it with context.activeProjectId = the resolved
    // project, so result.target.projectId is pinned — and buildPlan can
    // never emit create_project no matter how explicit the original ask.
    const { result } = await decide("build me a new app", { activeProjectId: "proj-9f3" });
    expect(result?.target?.projectId).toBe("proj-9f3");
    const plan = buildPlan("build me a new app", result!);
    expect(plan.steps.some((step) => step.type === "create_project")).toBe(false);
  });

  it("planId is carried for traceability — nothing in Studio consumes or executes it", async () => {
    // The composer pins ?planId=<id> so the routing plan is traceable,
    // but no Studio code path reads it: the prompt lands in the LiTT
    // composer and a run builds a fresh plan inside the pinned project.
    // If plan execution is wired to ?planId= later, this test fails on
    // purpose — the wiring MUST resolve against the pinned ?project=<id>,
    // never the plan's create_project step, or this chain mints a second
    // project.
    const studioDir = path.resolve(__dirname, "../../../app/(app)/studio");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
          if (fs.readFileSync(full, "utf8").includes("planId")) offenders.push(full);
        }
      }
    };
    walk(studioDir);
    expect(offenders).toEqual([]);
  });
});
