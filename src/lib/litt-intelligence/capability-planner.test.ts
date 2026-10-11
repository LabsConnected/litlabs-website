/**
 * Tests for the LiTT Capability Planner (Part A).
 *
 * Spec mapping:
 * - Test 1: simple text change → files tools only, no pointless web/image usage
 * - Test 2: research prompt → web.search useful
 * - Test 3: visual prompt → image generation useful, visual verification required
 * - Test 4: reference-match → reference-match triggers
 */
import { describe, it, expect } from "vitest";
import { planCapabilities, buildCapabilityPlanPrompt } from "./capability-planner";

describe("planCapabilities", () => {
  it("Test 1: simple text change uses files only — no web/image/browser", () => {
    const plan = planCapabilities("Change the homepage heading to 'Welcome'");
    expect(plan.requiredCapabilities).toContain("project_inspection");
    expect(plan.requiredCapabilities).toContain("filesystem");
    expect(plan.usefulCapabilities).not.toContain("web_search");
    expect(plan.usefulCapabilities).not.toContain("image_generation");
    expect(plan.usefulCapabilities).not.toContain("browser");
    expect(plan.needsVisualVerification).toBe(false);
    expect(plan.isReferenceMatch).toBe(false);
  });

  it("Test 1b: simple question uses minimal capabilities", () => {
    const plan = planCapabilities("What files control the homepage?");
    expect(plan.usefulCapabilities).not.toContain("web_search");
    expect(plan.usefulCapabilities).not.toContain("image_generation");
  });

  it("Test 2: research prompt marks web.search useful", () => {
    const plan = planCapabilities(
      "Research roofing services in Grand Haven and build the page",
    );
    expect(plan.usefulCapabilities).toContain("web_search");
    expect(plan.reason["web_search"]).toBeTruthy();
  });

  it("Test 3: visual prompt marks image generation useful and requires visual verification", () => {
    const plan = planCapabilities("Build a visually rich roofing landing page");
    expect(plan.usefulCapabilities).toContain("image_generation");
    expect(plan.needsVisualVerification).toBe(true);
    expect(plan.requiredCapabilities).toContain("preview");
    expect(plan.requiredCapabilities).toContain("browser");
  });

  it("Test 4: reference-match triggers on 'make mine look like this'", () => {
    const plan = planCapabilities(
      "Make mine look like this: https://example.com/roofing",
    );
    expect(plan.isReferenceMatch).toBe(true);
    expect(plan.usefulCapabilities).toContain("web_fetch");
    expect(plan.needsVisualVerification).toBe(true);
  });

  it("Test 4b: reference-match triggers on 'match this quality'", () => {
    const plan = planCapabilities(
      "Rebuild what I showed you with the same quality as the reference",
    );
    expect(plan.isReferenceMatch).toBe(true);
  });

  it("deploy is only required when the user asks to ship", () => {
    const noDeploy = planCapabilities("Build me a landing page");
    expect(noDeploy.requiredCapabilities).not.toContain("deployment");

    const withDeploy = planCapabilities("Build me a landing page and deploy it");
    expect(withDeploy.requiredCapabilities).toContain("deployment");
  });

  it("local-business builds get useful web_search for local context", () => {
    const plan = planCapabilities("Build a roofing site for Grand Haven");
    expect(plan.usefulCapabilities).toContain("web_search");
  });
});

describe("buildCapabilityPlanPrompt", () => {
  it("renders required and useful capabilities with reasons", () => {
    const plan = planCapabilities("Build a premium roofing website");
    const prompt = buildCapabilityPlanPrompt(plan);
    expect(prompt).toContain("CAPABILITY PLAN");
    expect(prompt).toContain("preview");
    expect(prompt).toContain("browser");
  });

  it("includes visual-verification directive for visual builds", () => {
    const plan = planCapabilities("Build a landing page");
    const prompt = buildCapabilityPlanPrompt(plan);
    expect(prompt).toContain("VISUAL VERIFICATION REQUIRED");
  });

  it("includes reference-match directive for reference tasks", () => {
    const plan = planCapabilities("Make mine look like this: https://example.com");
    const prompt = buildCapabilityPlanPrompt(plan);
    expect(prompt).toContain("REFERENCE-MATCH TASK");
  });
});
