/**
 * Intent-router media-generation regression tests.
 *
 * Production incident 2026-11-15: "Need a picture of a lion" in Studio
 * chat matched NO execution group ("need" is not a creation verb and
 * "picture" was in no noun list), so it fell to the default think mode
 * with requiresExecution=false → the V1 text-only lane, whose model has
 * no tools and could only decline in prose ("I can't generate image
 * files directly…"). Even textbook phrasings ("generate an image of…")
 * landed in the generic create group, which carries no
 * requiresExecution either. Bare media asks must now route to create
 * WITH requiresExecution=true so the turn reaches the V2 tool lane
 * where image.generate lives — while site/build asks keep their
 * existing routing untouched.
 *
 * Run: npx vitest run src/lib/litt-kernel/intent-router.media-generation.test.ts
 */
import { describe, it, expect } from "vitest";
import { classifyIntent } from "@/lib/litt-kernel/intent-router";

function mediaCase(message: string) {
  const r = classifyIntent(message);
  expect(r.mode).toBe("create");
  expect(r.requiresExecution).toBe(true);
  return r;
}

function buildCase(message: string) {
  const r = classifyIntent(message);
  expect(r.mode).toBe("build");
  expect(r.requiresExecution).toBe(true);
  expect(r.requiresProject).toBe(true);
  return r;
}

describe("intent-router media generation — bare media asks execute", () => {
  // The exact reproduced ask from the 2026-11-15 production screenshot.
  it("Larry's exact ask routes to execution: 'Need a picture of a lion'", () => {
    mediaCase("Need a picture of a lion");
  });

  it("generation-verb variants route to execution", () => {
    mediaCase("generate an image of a lion");
    mediaCase("create an image of a mountain cabin");
    mediaCase("make me a picture of a sunset over the lake");
    mediaCase("make me a logo");
  });

  it("desire-verb variants route to execution", () => {
    mediaCase("I want a photo of a red barn");
    mediaCase("get me an illustration of a sailboat");
    mediaCase("give me a thumbnail for the video");
  });

  it("'draw a …' routes to execution (verb is the artifact signal)", () => {
    mediaCase("draw a dragon");
    mediaCase("sketch a castle on a hill");
  });
});

describe("intent-router media generation — taskKind signal (LION-RUN-DIAGNOSIS-2026-11-16 F1a)", () => {
  // The quality gate scopes a run from this signal: without it a pure
  // media ask fell back to the prose classifier's "standard" build
  // scope and a successful generation failed its gate.
  it("bare media asks carry taskKind 'media'", () => {
    expect(classifyIntent("Need a picture of a lion").taskKind).toBe("media");
    expect(classifyIntent("generate an image of a lion").taskKind).toBe("media");
    expect(classifyIntent("draw a dragon").taskKind).toBe("media");
  });

  it("build asks do not carry the media kind", () => {
    expect(classifyIntent("build me a website").taskKind).not.toBe("media");
    expect(classifyIntent("generate an image for my landing page").taskKind).not.toBe("media");
  });
});

describe("intent-router media generation — build routing unchanged", () => {
  it("website/build asks still route to build", () => {
    buildCase("build me a website");
    buildCase("create a landing page for my bakery");
    buildCase("I need a website for my bakery");
  });

  it("media added to a site target still routes to build", () => {
    buildCase("add images to my project");
    buildCase("upload photos to my site");
    buildCase("generate an image for my landing page");
  });
});

describe("intent-router media generation — round-10 scope steal (2026-11-16 proof)", () => {
  // The exact failing ask from the round-10 live proof: the build
  // group's old `generate ... project` pattern matched first, the run
  // was born with build scope, and a successful generation failed the
  // build quality gate ("task scope: standard"). The persistence fix
  // (#1018) faithfully carried the wrong scope — the wording was the
  // defect.
  it("generation-led ask with a save-to-project tail routes to media", () => {
    const r = mediaCase("Generate an image of a lion and save it to this project.");
    expect(r.taskKind).toBe("media");
  });

  it("the same steal is gone without the lion subject", () => {
    const r = mediaCase("generate an image and save it to this project");
    expect(r.taskKind).toBe("media");
  });

  it("additive placement into a project page stays build", () => {
    buildCase("Add images to my project page");
    buildCase("insert a photo into the gallery section of my site");
  });

  it("generation into a named site element stays build", () => {
    buildCase("generate an image for my landing page");
    buildCase("generate a banner image for the homepage section");
  });
});

describe("intent-router media generation — non-generation stays out", () => {
  it("question about images gains no execution requirement", () => {
    const r = classifyIntent("what is an image gallery?");
    expect(r.requiresExecution).toBe(false);
  });

  it("explanation ask gains no execution requirement", () => {
    const r = classifyIntent("explain how image generation works");
    expect(r.requiresExecution).toBe(false);
  });

  it("media-noun defect reports stay build, not media generation", () => {
    buildCase("I need to fix the image upload bug");
    buildCase("fix the image upload bug");
  });

  it("draw idioms are not media generation", () => {
    const r = classifyIntent("draw a conclusion from these results");
    expect(r.requiresExecution).toBe(false);
  });
});
