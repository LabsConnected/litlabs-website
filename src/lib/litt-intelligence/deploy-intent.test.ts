import { describe, it, expect } from "vitest";
import {
  DEPLOY_TRANSPORT_TOOL_IDS,
  deployOnlyRefusalError,
  isBlockedInDeployOnlyRun,
  isDeployOnlyInstruction,
} from "./deploy-intent";
import { toolRegistry } from "./tool-registry";

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
    "Make it live",
    "Make the site live",
    "Make the project live",
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

  // Greptile (PR #1108): genuine edit phrasing paired with a deploy
  // word used to classify deploy-only — the loop then refused the
  // edit and published the unchanged page. Every phrase below asks
  // for content work, so NONE of them may be deploy-only.
  it.each([
    "Make the header blue and deploy",
    "Make the background dark and publish it",
    "Make it darker, then ship it",
    "Make the text bigger and deploy",
    "Make my site bolder and redeploy",
    "Translate the page and publish",
    "Translate the page to Spanish and deploy it",
    "Convert the page to Spanish and go live",
    "Localize the site and deploy",
    "Reword the headline and publish",
    "Rewrite the headline and ship it",
    "Rename the title and publish",
    "Move the logo to the top and deploy",
    "Swap the hero photo and deploy",
    "Resize the hero image and publish",
    "Hide the banner and redeploy",
    "Center the title and go live",
    "Darken the background and publish",
    "Increase the font size and deploy",
    "Decrease the spacing and publish",
    "Set the price to $5 and publish",
    "Turn the menu into a grid and deploy",
    "Upload a new logo and deploy",
    "Insert a photo gallery and publish",
    "Tweak the spacing and publish",
    "Adjust the layout and deploy",
    "Improve the homepage and ship it",
  ])("does not classify the mixed request %j as deploy-only", (instruction) => {
    expect(isDeployOnlyInstruction(instruction)).toBe(false);
  });

  it("blocks every mutation-marked tool except the deploy transport", () => {
    // The Greptile hole: the old hand-picked set covered writes but
    // left removal/move tools executable in a deploy.
    for (const id of [
      "files.write",
      "files.patch",
      "files.delete",
      "files.rename",
      "files.mkdir",
      "apply_patch",
      "site.compose",
      "site.patch",
      "project.insert_asset",
      "image.generate",
      "image.stock",
      "checkpoint.restore",
      "git.commit",
      "terminal.execute",
      "deploy.execute",
    ]) {
      expect(isBlockedInDeployOnlyRun({ id, readOnly: false })).toBe(true);
    }
    // The transport itself stays available — the run exists to call it.
    expect(DEPLOY_TRANSPORT_TOOL_IDS.has("project.deploy")).toBe(true);
    expect(isBlockedInDeployOnlyRun({ id: "project.deploy", readOnly: false })).toBe(false);
    // Read-only tools are never blocked.
    for (const id of ["files.read", "files.list", "project.scan", "deploy.verify"]) {
      expect(isBlockedInDeployOnlyRun({ id, readOnly: true })).toBe(false);
    }
  });

  it("enumerates the live registry: no mutating tool slips past the guard", () => {
    const all = toolRegistry.list();
    // The enumeration must not be vacuous: the registry really does
    // carry the removal/move tools this fix exists to block.
    const ids = new Set(all.map((t) => t.id));
    for (const id of ["files.delete", "files.rename", "files.patch", "terminal.execute"]) {
      expect(ids.has(id)).toBe(true);
    }
    for (const tool of all) {
      if (tool.readOnly) {
        expect(isBlockedInDeployOnlyRun(tool)).toBe(false);
      } else if (tool.id === "project.deploy") {
        expect(isBlockedInDeployOnlyRun(tool)).toBe(false);
      } else {
        expect(isBlockedInDeployOnlyRun(tool)).toBe(true);
      }
    }
  });

  it("ACC-05: resolver-appended context never reclassifies a deploy-only instruction", () => {
    // Acceptance Run 1 on 8935b2a9: the Code Deploy… draft "Deploy this
    // project to a live public URL" reached the loop as the turn
    // resolver's expansion "… — referring to: Rename the menu item
    // 'Chocolate Chip Cookie' to …" — the appended EDIT topic tripped
    // the content-verb net, the run kept the full tool set, and it
    // rewrote index.html (with stale content) before deploying. The
    // classifier judges the user's own words: machine-appended resolver
    // context (the " — referring to:" / " — in the context of:"
    // suffixes and the "[Context: …]" prefix) is stripped first.
    const topic = "Rename the menu item 'Chocolate Chip Cookie' to 'Midnight Chocolate Croissant', keep the price and description the same";
    expect(isDeployOnlyInstruction(`Deploy this project to a live public URL — referring to: ${topic}`)).toBe(true);
    expect(isDeployOnlyInstruction(`Deploy this project — referring to: ${topic}`)).toBe(true);
    expect(isDeployOnlyInstruction(`Deploy this project to production — in the context of: ${topic}`)).toBe(true);
    expect(isDeployOnlyInstruction(`[Context: ${topic}] Deploy this project to a live public URL`)).toBe(true);
    // The user's OWN content verbs still disqualify — stripping only
    // removes the machine-appended segment, never the instruction.
    expect(isDeployOnlyInstruction(`Rename the cookie and deploy it — referring to: ${topic}`)).toBe(false);
    expect(isDeployOnlyInstruction("Make the header blue and deploy")).toBe(false);
  });

  it("the refusal names the tool and points at project.deploy", () => {
    const err = deployOnlyRefusalError("files.write");
    expect(err).toContain("files.write");
    expect(err).toContain("project.deploy");
    expect(err).toMatch(/deploy-only/i);
  });
});
