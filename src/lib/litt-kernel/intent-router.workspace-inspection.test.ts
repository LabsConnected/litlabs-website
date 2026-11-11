import { describe, it, expect } from "vitest";
import { classifyIntent } from "@/lib/litt-kernel/intent-router";
import { routeKernel } from "@/lib/litt-kernel/kernel";

/**
 * Regression test for the 2026-11-11 staging acceptance failure
 * (Gate B verification project, builds d0d88dd4 / #899 + #902 live).
 *
 * Bug: with a project open in Studio, asking the Global LiTT overlay
 * "List the files in the project I'm currently viewing. Just list them,
 * don't change anything." produced a prose decline — "I don't have file
 * inspection tools available in this turn" — and NO Studio run/Activity
 * record. The overlay send DID reach the canonical messages route
 * (#902's wiring works; the exchange persisted to the project's
 * canonical conversation), but classifyIntent had NO pattern for
 * read-only workspace inspection: every execution pattern pairs a
 * MUTATION verb with a target noun, so a pure listing/read request fell
 * through to `think` with requiresExecution=false. The messages route
 * therefore took the V1 text-only lane (which attaches no tools and
 * creates no ActionRun — Activity is fed exclusively by ActionRuns),
 * and the tool-less model honestly declined.
 *
 * The docked chat shares this route and classifier, so the same
 * message failed there too; October's Gate B file-tool successes were
 * execution-classified build/probe tasks, not read-only asks.
 *
 * Expected: read-only workspace inspection requests (list files, show
 * project structure, read a named file) classify as "build" with
 * requiresExecution=true, so the turn takes the V2 structured-tool
 * lane (native files.list / files.read, durable ActionRun, ACT gates
 * untouched) — or, when no verified workspace exists, the route's
 * existing coded 409 TOOL_EXECUTION_UNAVAILABLE instead of a prose
 * decline. Genuine questions ABOUT files ("what does index.html
 * do?") and how-to questions carry no workspace-inspection directive
 * and must stay out of execution.
 */
describe("read-only workspace inspection — execution routing", () => {
  const EXECUTION_CASES: Array<{ msg: string; note: string }> = [
    {
      msg: "List the files in the project I'm currently viewing. Just list them, don't change anything.",
      note: "verbatim 2026-11-11 staging acceptance prompt (Gate B)",
    },
    {
      msg: "List the files in the project I'm currently viewing.",
      note: "acceptance prompt without the read-only tail",
    },
    { msg: "what files are in this project?", note: "what-files question" },
    { msg: "show me the files in this project", note: "show-me listing" },
    { msg: "list files", note: "bare listing imperative" },
    { msg: "what's in the src folder?", note: "folder contents question" },
    { msg: "show me the project structure", note: "structure request" },
    {
      msg: "what's the directory structure of this project?",
      note: "directory structure question",
    },
    { msg: "read index.html", note: "bare read verb + filename" },
    { msg: "read the README.md file", note: "read + path-y filename" },
    {
      msg: "open src/lib/litt-kernel/intent-router.ts",
      note: "open + relative path",
    },
  ];

  for (const { msg, note } of EXECUTION_CASES) {
    it(`classifies "${msg}" as build + requiresExecution (${note})`, () => {
      const result = classifyIntent(msg, { hasProject: true });
      expect(result.mode).toBe("build");
      expect(result.requiresExecution).toBe(true);
      expect(result.requiresProject).toBe(true);
    });
  }

  it("flows through the Kernel decision the messages route consumes", () => {
    const result = routeKernel({
      message:
        "List the files in the project I'm currently viewing. Just list them, don't change anything.",
      userId: "user_1",
      conversationId: "conv_1",
      projectId: "proj_1",
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    expect(result.decision.routing.requiresExecution).toBe(true);
    expect(result.decision.routing.mode).toBe("build");
  });

  const QUESTION_CASES: Array<{ msg: string; note: string }> = [
    { msg: "what does index.html do?", note: "what-question about a file" },
    { msg: "tell me about styles.css", note: "tell-me-about stays out" },
    {
      msg: "how do I list files in a directory?",
      note: "how-to question is teaching, not a workspace directive",
    },
    { msg: "list my projects", note: "project-list ask is not workspace inspection" },
    { msg: "what is a file?", note: "concept question" },
    { msg: "explain what a directory is", note: "concept explanation" },
  ];

  for (const { msg, note } of QUESTION_CASES) {
    it(`keeps "${msg}" out of execution (${note})`, () => {
      const result = classifyIntent(msg, { hasProject: true });
      expect(result.requiresExecution).toBe(false);
    });
  }

  it("does not treat 'show me' informational requests as inspection", () => {
    const result = classifyIntent("Show me the price of the Pro plan");
    expect(result.mode).not.toBe("build");
    expect(result.requiresExecution).toBe(false);
  });
});
