import { describe, it, expect } from "vitest";
import { classifyIntent } from "@/lib/litt-kernel/intent-router";

/**
 * Regression test for the Ember Roast website-build prompt.
 *
 * Bug: The prompt "Build a simple single-page landing site for a coffee
 * roastery called Ember Roast with a hero, a menu section, and a contact
 * section" was incorrectly routed to Music mode in production, causing
 * the V2 agent loop to never activate (requiresExecution=false).
 *
 * Expected: AUTO mode must classify this as a "build" intent with
 * requiresExecution=true so the V2 agent loop runs, files are written,
 * and the preview starts automatically.
 */
describe("Ember Roast prompt — AUTO classifier routing", () => {
  const EMBER_ROAST_PROMPT =
    "Build a simple single-page landing site for a coffee roastery called Ember Roast with a hero, a menu section, and a contact section";

  it("classifies as 'build' mode (not 'create' or 'music')", () => {
    const result = classifyIntent(EMBER_ROAST_PROMPT);
    expect(result.mode).toBe("build");
  });

  it("sets requiresExecution=true so the V2 agent loop activates", () => {
    const result = classifyIntent(EMBER_ROAST_PROMPT);
    expect(result.requiresExecution).toBe(true);
  });

  it("sets requiresProject=true so a project/workspace is required", () => {
    const result = classifyIntent(EMBER_ROAST_PROMPT);
    expect(result.requiresProject).toBe(true);
  });

  it("includes 'engineering' in domains (code/build intent)", () => {
    const result = classifyIntent(EMBER_ROAST_PROMPT);
    expect(result.domains).toContain("engineering");
  });

  // ── Variations of the same prompt ──

  it("classifies 'Build a landing page for a coffee shop' as build", () => {
    const result = classifyIntent("Build a landing page for a coffee shop");
    expect(result.mode).toBe("build");
    expect(result.requiresExecution).toBe(true);
  });

  it("classifies 'Create a website for Ember Roast with hero and menu' as build (website added to build pattern)", () => {
    const result = classifyIntent(
      "Create a website for Ember Roast with hero and menu",
    );
    // "Create a website" now matches build mode (website added to build pattern)
    expect(result.mode).toBe("build");
    expect(result.requiresExecution).toBe(true);
  });

  it("classifies 'Build a single-page app with a contact form' as build", () => {
    const result = classifyIntent(
      "Build a single-page app with a contact form",
    );
    expect(result.mode).toBe("build");
    expect(result.requiresExecution).toBe(true);
  });

  it("does NOT classify coffee/roastery keywords as music", () => {
    const result = classifyIntent(EMBER_ROAST_PROMPT);
    expect(result.mode).not.toBe("create");
    // Music is not a LiTT kernel mode — it's a Studio LiTTMode.
    // The kernel mode must be build, not create (which lacks requiresExecution).
  });

  it("routes an Inspector selected-button edit into execution", () => {
    const result = classifyIntent(
      "Change only the selected button's visible text from Explore Our Menu to Browse The Roast.",
    );
    expect(result.mode).toBe("build");
    expect(result.requiresExecution).toBe(true);
    expect(result.requiresProject).toBe(true);
  });

  it("routes a plain-language edit to an existing site into execution", () => {
    const result = classifyIntent(
      "Update the existing Ember Roast site footer to include Golden Acceptance follow-up verified and save the edit to index.html.",
    );
    expect(result.mode).toBe("build");
    expect(result.requiresExecution).toBe(true);
    expect(result.requiresProject).toBe(true);
  });
});
