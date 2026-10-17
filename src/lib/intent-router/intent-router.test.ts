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
    // B-A: "new X" where X is a file/asset-scope artifact FOR an existing
    // project — prepositions and possessives/determiners in the gap mean
    // the deliverable is the target, not the thing being created.
    ["new component for my app", { actionMatched: false, requestsNewProject: false }],
    ["new feature in my app", { actionMatched: false, requestsNewProject: false }],
    ["new logo for my website", { actionMatched: false, requestsNewProject: false }],
    ["new section for the homepage", { actionMatched: false, requestsNewProject: false }],
    ["make my website better", { actionMatched: true, requestsNewProject: false }],
    ["build the website", { actionMatched: true, requestsNewProject: false }],
    // B-B: questions and instructions ABOUT creating — the creation
    // phrase is inside a discussion frame, not a command.
    ["tell me how to build a new app", { actionMatched: true, requestsNewProject: false }],
    ["explain how to create a project", { actionMatched: true, requestsNewProject: false }],
    ["should i build a website?", { actionMatched: true, requestsNewProject: false }],
    ["how do i make an app", { actionMatched: true, requestsNewProject: false }],
    ["what is the best way to create a website", { actionMatched: true, requestsNewProject: false }],
    // F2: interrogative openers — the prompt asks, it doesn't command.
    ["is it possible to create a website", { actionMatched: true, requestsNewProject: false }],
    ["are there ways to build an app", { actionMatched: true, requestsNewProject: false }],
    ["would you build me a website?", { actionMatched: true, requestsNewProject: false }],
    ["does this create a project", { actionMatched: true, requestsNewProject: false }],
    ["do you know how to make an app", { actionMatched: true, requestsNewProject: false }],
    ["will you create a website for me", { actionMatched: true, requestsNewProject: false }],
    ["am i able to create a project", { actionMatched: true, requestsNewProject: false }],
    ["i wonder if you could build me a site", { actionMatched: true, requestsNewProject: false }],
    // F2: a trailing "?" without a direct polite command is a question.
    ["build me a website?", { actionMatched: true, requestsNewProject: false }],
    ["create a new app?", { actionMatched: true, requestsNewProject: false }],
    // F2: information-seeking openers — asking about creating is not a
    // creation command even when the prompt contains a creation phrase.
    ["could you explain how to create a site", { actionMatched: true, requestsNewProject: false }],
    ["can i build a website with this", { actionMatched: true, requestsNewProject: false }],
    ["any idea how to build a website", { actionMatched: true, requestsNewProject: false }],
    ["give me steps to build a website", { actionMatched: true, requestsNewProject: false }],
    ["i'm wondering if i should make an app", { actionMatched: true, requestsNewProject: false }],
    ["i think i should build an app, what do you think", { actionMatched: true, requestsNewProject: false }],
    ["i want to know how to build an app", { actionMatched: true, requestsNewProject: false }],
    ["recommend a stack to build a new app", { actionMatched: true, requestsNewProject: false }],
    // F2: a project noun bound by a destination qualifier names an
    // existing thing — "my new app" is context, not a creation ask.
    ["create a video for my new app", { actionMatched: true, requestsNewProject: false }],
    ["help me with my new app", { actionMatched: false, requestsNewProject: false }],
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
    // Direct creation commands phrased politely stay commands — "can
    // you" and "help me" request the work, they don't ask about it. A
    // trailing "?" after a polite command is courtesy, not a question.
    "can you build me a website",
    "can you build me a website?",
    "could you create a new app?",
    "help me create a website",
    // F2: job-description words mid-prompt never veto a direct command —
    // "tutorial", "describe", and "what is" here are part of the work,
    // not a question frame.
    "build me a site that includes a tutorial section",
    "create a website where users describe their photos",
    "make an app that shows what is new",
  ])("signals a new project for %j", async (prompt) => {
    const output = await routeIntent({ prompt, context: {} });
    expect(output.type).toBe("intent");
    if (output.type === "intent") {
      expect(output.result.actionMatched).toBe(true);
      expect(output.result.requestsNewProject).toBe(true);
    }
  });

  // The pinned-project chain (routeIntent inside the resolved project →
  // buildPlan → no create_project) is covered end-to-end in
  // src/components/dashboard/v3/build-routing.test.ts — here we only
  // assert the router's own contract: the pinned id lands on target.
  it("pins the active project as result.target when the context supplies one", async () => {
    const output = await routeIntent({
      prompt: "build me a new app",
      context: { activeProjectId: "proj-pinned" },
    });
    expect(output.type).toBe("intent");
    if (output.type === "intent") {
      expect(output.result.target?.projectId).toBe("proj-pinned");
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

describe("media-generation signal (requestsMediaGeneration + intents)", () => {
  // A media keyword alone is not a media request — the verb must govern
  // a media noun, or the prompt is work ON a media-adjacent feature.
  it.each([
    ["make an image of a cat", { requestsMediaGeneration: true, intents: ["image"] }],
    ["design a logo", { requestsMediaGeneration: true, intents: ["image", "design"] }],
    ["make a song and a video", { requestsMediaGeneration: true, intents: ["video", "music"] }],
    ["generate a thumbnail for the video", { requestsMediaGeneration: true, intents: ["video"] }],
    ["fix the image upload bug", { requestsMediaGeneration: false, intents: ["debug", "image"] }],
    ["write tests for the audio player", { requestsMediaGeneration: false, intents: ["music"] }],
    ["make an image for my website", { requestsMediaGeneration: true, intents: ["website", "image"] }],
    ["tell me how to make a logo", { requestsMediaGeneration: false, intents: ["image"] }],
    ["how does the image editor work", { requestsMediaGeneration: false, intents: ["image"] }],
    // F1: a media noun followed by a software-artifact head noun names a
    // SOFTWARE deliverable — "music player" is a program, not a song.
    ["make a music player", { requestsMediaGeneration: false, intents: ["music"] }],
    ["build an image gallery", { requestsMediaGeneration: false, intents: ["image"] }],
    ["write a song parser", { requestsMediaGeneration: false, intents: ["music"] }],
    ["write a clip scheduler", { requestsMediaGeneration: false, intents: ["video"] }],
    ["write a beat tracker in python", { requestsMediaGeneration: false, intents: ["music"] }],
    ["create a design system", { requestsMediaGeneration: false, intents: ["design"] }],
    // F1: the governed noun supplies the media intent even when no
    // keyword does — media detection and classification are harmonized.
    ["compose a jingle", { requestsMediaGeneration: true, intents: ["music"] }],
    ["create a banner", { requestsMediaGeneration: true, intents: ["image"] }],
    ["record a voiceover", { requestsMediaGeneration: true, intents: ["music"] }],
    ["draw a dragon", { requestsMediaGeneration: true, intents: ["image"] }],
    ["make a thumbnail for my video", { requestsMediaGeneration: true, intents: ["video"] }],
    // F1: a standalone media deliverable bound to a project by a
    // destination qualifier carries the full intents AND the masked
    // scope — media work with project context, not a creation request.
    ["create a video for my new app", { requestsMediaGeneration: true, intents: ["code", "video"] }],
  ])("classifies %j correctly", async (prompt, expected) => {
    const output = await routeIntent({ prompt, context: {} });
    expect(output.type).toBe("intent");
    if (output.type === "intent") {
      expect(output.result.requestsMediaGeneration).toBe(expected.requestsMediaGeneration);
      expect(output.result.intents).toEqual(expected.intents);
    }
  });

  it("masks project-destination qualifiers only for standalone media deliverables", async () => {
    // "a video for my new app" — the app is where the asset lands, not a
    // second deliverable: the masked scope is media-only.
    const videoForApp = await routeIntent({ prompt: "create a video for my new app", context: {} });
    expect(videoForApp.type).toBe("intent");
    if (videoForApp.type === "intent") {
      expect(videoForApp.result.mediaScopeIntents).toEqual(["video"]);
    }

    // Conjunct deliverables are never masked — "and a website" is real
    // project work, so the scope stays the full constituent list.
    const videoAndSite = await routeIntent({ prompt: "make a video and a website", context: {} });
    expect(videoAndSite.type).toBe("intent");
    if (videoAndSite.type === "intent") {
      expect(videoAndSite.result.mediaScopeIntents).toBeUndefined();
    }

    // Image/design assets destined for a project keep the full scope —
    // the asset is part of that project, not a standalone deliverable.
    const imageForSite = await routeIntent({ prompt: "make an image for my website", context: {} });
    expect(imageForSite.type).toBe("intent");
    if (imageForSite.type === "intent") {
      expect(imageForSite.result.mediaScopeIntents).toBeUndefined();
    }
  });
});
