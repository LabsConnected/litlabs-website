import { describe, it, expect } from "vitest";
import {
  CONTENT_MUTATION_TOOL_IDS,
  deployOnlyRefusalError,
  isDeployOnlyInstruction,
} from "./deploy-intent";

/**
 * ACC-03 item 1 — deploy-only classification. The Run 1 failure was
 * the F8b hand-off's own prefill, "Deploy this project to production",
 * answered with five content-rewriting writes. These cases pin the
 * classifier's narrow shape: a deploy ask with NO content ask is
 * deploy-only; any content verb anywhere makes it a normal run.
 */
describe("isDeployOnlyInstruction", () => {
  it.each([
    "Deploy this project to production",
    "Deploy this project",
    "deploy it",
    "Publish the site",
    "Publish it",
    "Republish the site",
    "Redeploy with LiTT",
    "Ship it",
    "Go live",
    "Put the site live",
    "Please deploy this project to production.",
  ])("classifies %j as deploy-only", (instruction) => {
    expect(isDeployOnlyInstruction(instruction)).toBe(true);
  });

  it.each([
    "Build a one-page website for a bakery and deploy it",
    "Fix the tagline and publish",
    "Change the tagline to \"Warm bread\" and deploy",
    "Update the menu, then deploy this project to production",
    "Create a landing page and ship it",
    "Add opening hours and go live",
    "Publish the changes I just described",
    "Redesign the hero and redeploy",
    "Build a website for a bakery called Sunny Crust Bakery",
    "Change the tagline to \"Warm bread, honest prices\"",
    "",
    "   ",
  ])("does not classify %j as deploy-only", (instruction) => {
    expect(isDeployOnlyInstruction(instruction)).toBe(false);
  });

  it("keeps project.deploy out of the content-mutation set", () => {
    expect(CONTENT_MUTATION_TOOL_IDS.has("project.deploy")).toBe(false);
    for (const id of ["files.write", "apply_patch", "site.compose", "site.patch", "project.insert_asset"]) {
      expect(CONTENT_MUTATION_TOOL_IDS.has(id)).toBe(true);
    }
  });

  it("the refusal names the tool and points at project.deploy", () => {
    const err = deployOnlyRefusalError("files.write");
    expect(err).toContain("files.write");
    expect(err).toContain("project.deploy");
    expect(err).toMatch(/deploy-only/i);
  });
});
