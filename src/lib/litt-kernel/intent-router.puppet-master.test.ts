import { describe, it, expect } from "vitest";
import { classifyIntent } from "@/lib/litt-kernel/intent-router";

/**
 * Regression test for the puppet-master landing-page prompt.
 *
 * Bug: The prompt "I want a landing page showing how your the puppet
 * master and the possibilities of what Litt can do" was classified as
 * `create` (design) mode because the build landing-page pattern requires a
 * verb (build|create|make|…) BEFORE "landing page", while the create
 * pattern matches the bare noun. First-match-wins sent it to the text-only
 * V1 lane (requiresExecution:false), where the model echoed
 * `files.write(path="index.html", …)` as literal text — persisted as a
 * completed message while no file was ever created.
 *
 * Expected: desire-driven artifact requests ("I want/need a landing
 * page …") classify as `build` with requiresExecution:true so the V2
 * execution lane runs.
 */
describe("puppet-master prompt — AUTO classifier routing", () => {
  const PRODUCTION_PROMPT =
    "I want a landing page showing how your the puppet master and the possibilities of what Litt can do";

  it("classifies the production prompt as 'build' mode (not 'create')", () => {
    expect(classifyIntent(PRODUCTION_PROMPT).mode).toBe("build");
  });

  it("sets requiresExecution=true so the V2 agent loop activates", () => {
    expect(classifyIntent(PRODUCTION_PROMPT).requiresExecution).toBe(true);
  });

  it("sets requiresProject=true so a project/workspace is required", () => {
    expect(classifyIntent(PRODUCTION_PROMPT).requiresProject).toBe(true);
  });

  // ── Desire-driven phrasing variations ──
  it.each([
    "I need a website for my bakery",
    "I want a portfolio site",
    "we need a dashboard for the team",
    "get me a landing page",
    "give me a homepage for my product",
    "I would like a blog",
  ])("classifies %j as 'build' with requiresExecution=true", (msg) => {
    const result = classifyIntent(msg);
    expect(result.mode).toBe("build");
    expect(result.requiresExecution).toBe(true);
  });

  // ── Media/design requests must stay in `create` (not execution) ──
  it.each([
    "I want an image of a happy dog",
    "I want a logo",
    "generate an image",
    "design a poster",
  ])("keeps %j in 'create' mode without execution", (msg) => {
    const result = classifyIntent(msg);
    expect(result.mode).toBe("create");
    expect(result.requiresExecution).toBe(false);
  });

  // ── No false positives on lookalike phrasings ──
  it("does not route 'I want to shop for shoes' to build", () => {
    expect(classifyIntent("I want to shop for shoes").mode).not.toBe("build");
  });

  it("keeps 'explain how landing pages work' in learn mode", () => {
    expect(classifyIntent("explain how landing pages work").mode).toBe("learn");
  });

  // ── Existing imperative phrasing unchanged ──
  it("still classifies 'build me a landing page' as build", () => {
    const result = classifyIntent("build me a landing page");
    expect(result.mode).toBe("build");
    expect(result.requiresExecution).toBe(true);
  });
});
