import { describe, expect, it } from "vitest";
import { classifyIntent } from "./intent-router";
import { routeKernel } from "./kernel";

/**
 * Live-browser / preview inspection classification (ART-20261111-070 §2).
 *
 * Production run aa70559b (2026-11-11, f9ad12cd): the verbatim prompt
 * "Use the live browser to inspect this project's preview page and tell
 * me what you see — check the hero, the cards, and whether every image
 * renders." was a pure read-only inspection of the project's own
 * preview, but NO pattern in the #905 inspection group matched it (that
 * group only knows file/folder/filename vocabulary), so taskKind was
 * never set. The quality session fell back to prose classification →
 * "standard" scope → the gate demanded build/test evidence a read can
 * never produce, and the run failed with '2 required stage(s) lack
 * evidence: "build" (pending), "test" (pending)'.
 *
 * The fix is ONE discriminating pattern (browser/preview inspection)
 * carrying the inspection group's exact semantics, given precedence
 * over both the browser-session group and the build-mutation placement
 * pattern, with a whole-message exclusion for mutation verbs: any
 * request that ALSO asks to change something keeps its previous
 * routing and full build gating. classifyTaskScope and the required
 * stage sets are untouched — the kernel signal remains the only source
 * of the inspection scope.
 *
 * Corpus discipline: every PURE case below must classify as
 * inspection; every HYBRID (inspection + mutation) case must keep
 * EXACTLY the routing it had before the fix (mode recorded from the
 * pre-fix router); every NEGATIVE case must be unchanged.
 */

// ─── Pure inspection — must be taskKind "inspection" ─────────────

const PURE_INSPECTION: Array<{ msg: string; note: string }> = [
  {
    msg: "Use the live browser to inspect this project's preview page and tell me what you see — check the hero, the cards, and whether every image renders.",
    note: "verbatim production prompt, run aa70559b",
  },
  { msg: "inspect the preview", note: "bare inspect + preview" },
  { msg: "look at the site in the browser", note: "look at + site in browser" },
  {
    msg: "look at my page in the browser and tell me how it looks",
    note: "look at + page in browser",
  },
  {
    msg: "open the preview and tell me what you see",
    note: "open the preview + report back",
  },
  {
    msg: "check whether the hero renders correctly in the preview",
    note: "check … renders (hero)",
  },
  {
    msg: "check that every image renders on the page",
    note: "check … renders (images)",
  },
  { msg: "screenshot the preview", note: "screenshot + preview" },
  { msg: "take a screenshot of the preview page", note: "screenshot + preview page" },
  { msg: "view the site in the browser", note: "view + site in browser" },
  {
    msg: "inspect this project's preview page in the live browser",
    note: "inspect + preview + live browser",
  },
  { msg: "show me what the preview looks like", note: "show me + preview" },
  { msg: "check the preview", note: "bare check + preview" },
];

// ─── Hybrids — inspection + mutation: must NOT be inspection, and
//     must keep the exact mode the pre-fix router produced ────────

const HYBRIDS: Array<{ msg: string; beforeMode: string; note: string }> = [
  {
    msg: "inspect the preview and fix the hero",
    beforeMode: "build",
    note: "fix excludes; build-mutation placement/edit owns it",
  },
  {
    msg: "check the page then update the headline",
    beforeMode: "build",
    note: "update excludes; build owns it",
  },
  {
    msg: "build a page and show me in the browser",
    beforeMode: "browser",
    note: "build excludes; browser-session routing unchanged",
  },
  {
    msg: "look at the site in the browser and change the headline",
    beforeMode: "browser",
    note: "change excludes; browser-session routing unchanged",
  },
  {
    msg: "screenshot the preview, then delete the hero section",
    beforeMode: "build",
    note: "delete excludes; build owns it",
  },
  {
    msg: "open the preview and edit the title",
    beforeMode: "think",
    note: "edit excludes; unchanged (was think, stays think)",
  },
  {
    msg: "check the preview and add a contact section",
    beforeMode: "build",
    note: "add excludes; build owns it",
  },
  {
    msg: "inspect the preview, then redesign the hero",
    beforeMode: "build",
    note: "redesign excludes; build owns it",
  },
  {
    msg: "view the site in the browser and publish it",
    beforeMode: "ship",
    note: "publish excludes; ship routing unchanged",
  },
];

// ─── Negatives — no preview/page inspection of this project ──────

const NEGATIVES: Array<{ msg: string; beforeMode: string; note: string }> = [
  {
    msg: "open a live browser",
    beforeMode: "browser",
    note: "bare browser-session start stays browser control",
  },
  {
    msg: "start a browser session",
    beforeMode: "browser",
    note: "session lifecycle stays browser control",
  },
  {
    msg: "use the browser to check the dashboard",
    beforeMode: "browser",
    note: "external dashboard, no project preview/page target",
  },
  {
    msg: "go to https://example.com in the browser",
    beforeMode: "browser",
    note: "external navigation stays browser control",
  },
];

describe("browser/preview inspection — pure reads classify as inspection", () => {
  for (const { msg, note } of PURE_INSPECTION) {
    it(`inspection: ${note}`, () => {
      const intent = classifyIntent(msg, { hasProject: true });
      expect(intent.mode).toBe("build");
      expect(intent.requiresProject).toBe(true);
      expect(intent.requiresExecution).toBe(true);
      expect(intent.taskKind).toBe("inspection");
    });
  }

  it("kernel routing carries the inspection task kind for the production prompt", () => {
    const result = routeKernel({
      message: PURE_INSPECTION[0].msg,
      userId: "user-1",
      conversationId: "conv-1",
      projectId: "proj-1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    expect(result.decision.routing.requiresExecution).toBe(true);
    expect(result.decision.routing.taskKind).toBe("inspection");
  });
});

describe("browser/preview inspection — hybrids keep build routing and full gating", () => {
  for (const { msg, beforeMode, note } of HYBRIDS) {
    it(`not inspection, unchanged mode (${beforeMode}): ${note}`, () => {
      const intent = classifyIntent(msg, { hasProject: true });
      expect(intent.taskKind).toBeUndefined();
      expect(intent.mode).toBe(beforeMode);
    });
  }
});

describe("browser/preview inspection — negatives unchanged", () => {
  for (const { msg, beforeMode, note } of NEGATIVES) {
    it(`unchanged (${beforeMode}): ${note}`, () => {
      const intent = classifyIntent(msg, { hasProject: true });
      expect(intent.taskKind).toBeUndefined();
      expect(intent.mode).toBe(beforeMode);
    });
  }
});
