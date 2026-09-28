import { describe, it, expect } from "vitest";
import { classifyIntent } from "@/lib/litt-kernel/intent-router";

/**
 * Regression test for the 2026-09-28 #551 acceptance re-run #2 dead-end.
 *
 * Bug: a customer asked Studio "Add the HTML comment … as the very first
 * line of index.html and save." classifyIntent routed it to `think` with
 * requiresExecution=false — every build-mode mutation pattern paired a
 * verb with a category noun (file|page|component|…), but the prompt named
 * a BARE FILENAME with no category noun. The turn took the V1 text-only
 * lane, the model could only express the file read as tool-call markup,
 * and the run failed honestly with TOOL_CALL_PARSE_FAILED.
 *
 * Expected: explicit file mutations naming a bare filename classify as
 * "build" with requiresExecution=true (mutation verb + filename with a
 * known extension), so the turn takes the V2 structured-tool lane.
 * The mutation verb is the discriminator: genuine questions about a
 * file ("what does index.html do?") carry no mutation verb and must stay
 * out of execution.
 */
describe("bare-filename file mutations — execution routing", () => {
  const EXECUTION_CASES: Array<{ msg: string; note: string }> = [
    {
      msg: "Add the HTML comment <!-- PR551-acceptance-edit-marker-3 --> as the very first line of index.html and save.",
      note: "verbatim acceptance re-run #2 step-5 prompt",
    },
    {
      msg: "Add the HTML comment `<!-- x -->` as the very first line of `index.html` and save.",
      note: "backticked comment + filename",
    },
    {
      msg: "add an HTML comment at the top of index.html and save",
      note: "lowercase, no marker",
    },
    {
      msg: "Please add a meta description tag to index.html",
      note: "leading 'Please' + add",
    },
    { msg: "update styles.css", note: "bare verb + css filename" },
    { msg: "fix the typo in app/page.tsx", note: "fix + relative path" },
    {
      msg: "Change the background color in styles.css to dark blue",
      note: "change + css filename",
    },
    { msg: "save index.html", note: "bare save verb" },
  ];

  for (const { msg, note } of EXECUTION_CASES) {
    it(`classifies "${msg}" as build + requiresExecution (${note})`, () => {
      const result = classifyIntent(msg, { hasProject: true });
      expect(result.mode).toBe("build");
      expect(result.requiresExecution).toBe(true);
      expect(result.requiresProject).toBe(true);
    });
  }

  const QUESTION_CASES: Array<{ msg: string; note: string }> = [
    { msg: "what does index.html do?", note: "what-question about a file" },
    { msg: "how do I add a comment to index.html?", note: "how-question is a question, not an execution request" },
    { msg: "is index.html the entry point?", note: "yes/no question about a file" },
    { msg: "tell me about styles.css", note: "tell-me-about stays out of execution" },
  ];

  for (const { msg, note } of QUESTION_CASES) {
    it(`keeps "${msg}" out of execution (${note})`, () => {
      const result = classifyIntent(msg, { hasProject: true });
      expect(result.requiresExecution).toBe(false);
    });
  }

  it("does not route bare-filename mutations to think", () => {
    for (const { msg } of EXECUTION_CASES) {
      const result = classifyIntent(msg, { hasProject: true });
      expect(result.mode).not.toBe("think");
    }
  });
});
