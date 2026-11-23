import { describe, it, expect } from "vitest";
import { classifyIntent } from "@/lib/litt-kernel/intent-router";

/**
 * Regression test for ACC-01 F2 (paid-beta acceptance, 2026-11-22).
 *
 * Bug: a customer with a finished page asked for a one-paragraph edit
 * ("mention fresh pastries in the welcome paragraph") and then, after a
 * bad overwrite, a correction ("that's the wrong page — it should be
 * Harbor Lights…", "put back the name, the drinks and the hours").
 * classifyIntent routed these phrasings to think/research with
 * requiresExecution=false — "mention" is not edit vocabulary and
 * "paragraph"/"line" were in no target list — so the turns never
 * entered the execution lane: the model replied in prose, nothing
 * changed, and the run still completed, rendering the false
 * "Done · No files changed" card.
 *
 * Expected: page-edit and correction directives classify as "build"
 * with requiresExecution=true; questions ABOUT the text and unrelated
 * chat stay out of the execution lane.
 */
describe("page-edit prompts — execution routing (ACC-01 F2)", () => {
  const CASES: Array<{ msg: string; note: string }> = [
    { msg: "Update the welcome paragraph to mention that we now serve fresh pastries every morning.", note: "update + paragraph" },
    { msg: "Add a line to the welcome paragraph mentioning fresh pastries.", note: "add + line/paragraph" },
    { msg: "Mention fresh pastries in the welcome paragraph.", note: "mention + paragraph" },
    {
      msg: "That's the wrong page — it should be Harbor Lights Coffee with a Classic Latte for $4.50, Harbor Brew for $5.00, and a Seasonal Mocha for $5.75, open 7 AM to 6 PM, and it should mention the fresh pastries. Please fix it.",
      note: "wrong-page correction",
    },
    {
      msg: "The page is wrong. Put back Harbor Lights Coffee, the three drinks with prices, the 7 AM to 6 PM hours, and add the fresh pastries line.",
      note: "page-is-wrong + put back",
    },
    { msg: "Fix the homepage: it lost the Harbor Lights name, the drinks, and the hours.", note: "fix + homepage (pre-existing)" },
  ];

  for (const { msg, note } of CASES) {
    it(`classifies "${msg.slice(0, 48)}…" as build + requiresExecution (${note})`, () => {
      const result = classifyIntent(msg, { hasProject: true });
      expect(result.mode).toBe("build");
      expect(result.requiresExecution).toBe(true);
      expect(result.requiresProject).toBe(true);
    });
  }

  const NEGATIVES: Array<{ msg: string; note: string }> = [
    { msg: "What should the welcome paragraph say?", note: "question about the text" },
    { msg: "How do I add a line to the welcome paragraph?", note: "how-to question" },
    { msg: "I read the wrong page of the book you recommended.", note: "wrong page, not this project" },
    { msg: "That's the wrong shade of blue for a coffee brand.", note: "wrong + no page noun" },
    { msg: "How do I restore the page?", note: "restore how-to question (Greptile, PR #1103)" },
    { msg: "Explain how to revert the title.", note: "revert explanation request (Greptile, PR #1103)" },
  ];

  for (const { msg, note } of NEGATIVES) {
    it(`does not route "${msg.slice(0, 48)}" to execution (${note})`, () => {
      const result = classifyIntent(msg, { hasProject: true });
      expect(result.requiresExecution).toBe(false);
    });
  }
});
