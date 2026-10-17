import { describe, expect, it } from "vitest";
import { routeIntent } from "./router";

describe("LiTT intent router", () => {
  it("routes a song request to music without a mode menu", async () => {
    const output = await routeIntent({ prompt: "make me a song", context: {} });
    expect(output.type).toBe("intent");
    if (output.type === "intent") expect(output.result.primaryIntent).toBe("music");
  });

  it("uses selected asset context for a contextual edit", async () => {
    const output = await routeIntent({ prompt: "make the logo darker", context: { selectedAssetId: "asset-1" } });
    expect(output.type).toBe("intent");
    if (output.type === "intent") {
      expect(output.result.primaryIntent).toBe("image");
      expect(output.result.action).toBe("edit");
    }
  });

  it("routes a failed deployment fix to debug", async () => {
    const output = await routeIntent({ prompt: "fix it", context: { activeProjectId: "project-1", deploymentState: "failed" } });
    expect(output.type).toBe("intent");
    if (output.type === "intent") expect(output.result.primaryIntent).toBe("debug");
  });

  it("asks one useful clarification for vague context-free requests", async () => {
    const output = await routeIntent({ prompt: "make it better", context: {} });
    expect(output).toEqual({
      type: "clarification",
      request: { question: "What should LiTT work on? Tell me the project, file, asset, or result you want changed." },
    });
  });

  it("marks destructive requests for approval", async () => {
    const output = await routeIntent({ prompt: "delete production", context: { activeProjectId: "project-1" } });
    expect(output.type).toBe("intent");
    if (output.type === "intent") {
      expect(output.result.consequence).toBe("destructive");
      expect(output.result.requirements.needsApproval).toBe(true);
    }
  });
});

describe("explicit new-project signal (requestsNewProject + actionMatched)", () => {
  // Ordinary conversation, questions, and file-scope work must never
  // carry a new-project signal — a defaulted "create" action is not an
  // explicit creation request.
  it.each([
    ["how does the api component work", { actionMatched: false, requestsNewProject: false }],
    ["what is the difference between a website and an app", { actionMatched: false, requestsNewProject: false }],
    ["write a function to parse dates", { actionMatched: true, requestsNewProject: false }],
    ["make an image of a cat", { actionMatched: true, requestsNewProject: false }],
    ["update the existing website", { actionMatched: true, requestsNewProject: false }],
    ["make changes to the site", { actionMatched: true, requestsNewProject: false }],
    ["start the app", { actionMatched: false, requestsNewProject: false }],
    ["fix the broken checkout page", { actionMatched: true, requestsNewProject: false }],
  ])("does not signal project creation for %j", async (prompt, expected) => {
    const output = await routeIntent({ prompt, context: {} });
    expect(output.type).toBe("intent");
    if (output.type === "intent") {
      expect(output.result.actionMatched).toBe(expected.actionMatched);
      expect(output.result.requestsNewProject).toBe(expected.requestsNewProject);
    }
  });

  it.each([
    "create a new website project",
    "build me a new app",
    "create a website for my landscaping business",
    "make me a landing page",
    "start a new project",
    "spin up a new site",
  ])("signals a new project for %j", async (prompt) => {
    const output = await routeIntent({ prompt, context: {} });
    expect(output.type).toBe("intent");
    if (output.type === "intent") {
      expect(output.result.actionMatched).toBe(true);
      expect(output.result.requestsNewProject).toBe(true);
    }
  });

  it("classifies 'create a new website project' as mixed yet still signalled", async () => {
    const output = await routeIntent({ prompt: "create a new website project", context: {} });
    expect(output.type).toBe("intent");
    if (output.type === "intent") {
      expect(output.result.primaryIntent).toBe("mixed");
      expect(output.result.action).toBe("create");
      expect(output.result.actionMatched).toBe(true);
      expect(output.result.requestsNewProject).toBe(true);
    }
  });

  it("routes media generation to a media intent without a project signal", async () => {
    const output = await routeIntent({ prompt: "make an image of a cat", context: {} });
    expect(output.type).toBe("intent");
    if (output.type === "intent") {
      expect(output.result.primaryIntent).toBe("image");
      expect(output.result.requestsNewProject).toBe(false);
    }
  });

  it("file-scope code work keeps the code intent but no project signal", async () => {
    const output = await routeIntent({ prompt: "write a function to parse dates", context: {} });
    expect(output.type).toBe("intent");
    if (output.type === "intent") {
      expect(output.result.primaryIntent).toBe("code");
      expect(output.result.action).toBe("generate");
      expect(output.result.actionMatched).toBe(true);
      expect(output.result.requestsNewProject).toBe(false);
    }
  });
});
