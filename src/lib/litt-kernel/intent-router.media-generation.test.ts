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

describe("intent-router media generation — 'pic'/'pics' (2026-11-17 mobile refusal)", () => {
  // Production incident 2026-11-17: "Make me a pic of a bike" on the
  // phone surface matched no media pattern ("pic" was in no noun
  // list), fell to the generic create group with
  // requiresExecution=false, and the V1 text-only lane refused in
  // prose — the same failure class as the 2026-11-15 lion refusal,
  // one word over ("picture" was listed, "pic" was not).
  it("Larry's exact ask routes to media: 'Make me a pic of a bike'", () => {
    const r = mediaCase("Make me a pic of a bike");
    expect(r.taskKind).toBe("media");
  });

  it("plural 'pics' routes to media", () => {
    const r = mediaCase("Make me pics of a bike");
    expect(r.taskKind).toBe("media");
  });

  it("desire-verb 'pic' ask routes to media", () => {
    const r = mediaCase("I need a pic of a lion");
    expect(r.taskKind).toBe("media");
  });

  it("'pic' defect reports stay build, not media generation", () => {
    const r = buildCase("Fix the pic upload bug");
    expect(r.taskKind).not.toBe("media");
  });

  it("'pic' placed into a page stays build, not media generation", () => {
    const r = buildCase("Add a pic to my homepage");
    expect(r.taskKind).not.toBe("media");
  });
});

describe("intent-router media generation — 'video'/'vid' (2026-11-17 smartness ruling)", () => {
  // Larry's ruling 2026-11-17: video asks route to Media the same as
  // image asks, and Studio LiTT must understand short keywords and
  // colloquial phrasing ("vid"), not just the formal words. Before
  // this, "video" sat only in the generic create group's noun list,
  // so a bare video ask carried no execution requirement either.
  it("'Make me a video of a bike' routes to media", () => {
    const r = mediaCase("Make me a video of a bike");
    expect(r.taskKind).toBe("media");
  });

  it("plural and desire-verb video asks route to media", () => {
    mediaCase("Make me videos of a bike");
    const r = mediaCase("I need a video of a lion");
    expect(r.taskKind).toBe("media");
  });

  it("short form 'vid'/'vids' routes to media", () => {
    const r = mediaCase("Make me a vid of a bike");
    expect(r.taskKind).toBe("media");
    mediaCase("Make me vids of a bike");
    mediaCase("gimme a vid of a bike");
  });

  it("video defect reports stay build, not media generation", () => {
    const r = buildCase("fix the video upload bug");
    expect(r.taskKind).not.toBe("media");
  });

  it("'video' placed into a page stays build, not media generation", () => {
    const r = buildCase("Add a video to my homepage");
    expect(r.taskKind).not.toBe("media");
  });

  it("'Fix the video player' never reaches media generation", () => {
    // Guard contract: an edit ask about an existing player must not
    // become a generation run. This phrasing classifies as generic
    // create with no execution requirement — identical on base
    // b0b78e7e and on this branch (verified by direct classifier
    // runs on both trees); it was never claimed by the build group
    // and this media-group change does not move it.
    const r = classifyIntent("Fix the video player");
    expect(r.taskKind).not.toBe("media");
    expect(r.requiresExecution).toBe(false);
  });
});

describe("intent-router media generation — excluded short forms stay out", () => {
  // Short-form audit (2026-11-17): candidates evaluated for the media
  // noun list and deliberately NOT added — each is ambiguous with a
  // build/edit meaning in a website builder, so adding it would
  // steal non-generation asks. Already covered instead: drawings?,
  // illustrations? and artwork were already in the noun list, and
  // "render" already works as a generation verb ("render an image").
  it("'render' as a noun is not media generation (render-perf edits)", () => {
    const r = classifyIntent("Make the render faster");
    expect(r.taskKind).not.toBe("media");
    expect(r.requiresExecution).toBe(false);
  });

  it("'img' is code vocabulary, not a generation ask", () => {
    const r = buildCase("add an img tag to the page");
    expect(r.taskKind).not.toBe("media");
  });

  it("'snapshot' is tooling vocabulary, not a generation ask", () => {
    const r = classifyIntent("take a snapshot of the page");
    expect(r.taskKind).not.toBe("media");
    expect(r.requiresExecution).toBe(false);
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
