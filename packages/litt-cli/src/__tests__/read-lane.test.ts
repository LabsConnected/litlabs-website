/**
 * Tests for the READ lane — bounded read-only project inspection.
 *
 * Tests:
 *   - matchReadTools maps queries to correct canonical tool calls
 *   - executeReadTools runs tools in parallel and preserves order
 *   - formatReadResultsForSynthesis produces evidence-only prompts
 *   - Compound queries trigger synthesis
 *   - Single bounded queries may skip synthesis
 */

import { describe, it, expect } from "vitest";
import { matchReadTools, executeReadTools, formatReadResultsForSynthesis } from "../lib/read-lane.js";
import type { ToolResult } from "@litt/agent-core";

const ok = (message: string, data: Record<string, unknown> = {}): ToolResult => ({
  status: "success",
  success: true,
  message,
  data,
});

const fail = (message: string): ToolResult => ({
  status: "failed",
  success: false,
  message,
  data: {},
});

describe("matchReadTools", () => {
  it("maps 'what framework is this' to project.inspect_package", () => {
    const m = matchReadTools("what framework is this");
    expect(m).not.toBeNull();
    expect(m!.calls).toHaveLength(1);
    expect(m!.calls[0].toolId).toBe("project.inspect_package");
  });

  it("maps 'what package manager is this' to project.inspect_package", () => {
    const m = matchReadTools("what package manager is this");
    expect(m).not.toBeNull();
    expect(m!.calls[0].toolId).toBe("project.inspect_package");
  });

  it("maps 'what files changed' to project.status", () => {
    const m = matchReadTools("what files changed");
    expect(m).not.toBeNull();
    expect(m!.calls[0].toolId).toBe("project.status");
  });

  it("maps 'show recent commits' to project.log", () => {
    const m = matchReadTools("show recent commits");
    expect(m).not.toBeNull();
    expect(m!.calls[0].toolId).toBe("project.log");
  });

  it("maps 'what branch am i on' to project.branch", () => {
    const m = matchReadTools("what branch am i on");
    expect(m).not.toBeNull();
    expect(m!.calls[0].toolId).toBe("project.branch");
  });

  it("maps compound 'tell me the framework and branch' to both tools", () => {
    const m = matchReadTools("tell me the framework and branch");
    expect(m).not.toBeNull();
    expect(m!.calls).toHaveLength(2);
    const toolIds = m!.calls.map((c) => c.toolId).sort();
    expect(toolIds).toEqual(["project.branch", "project.inspect_package"]);
    expect(m!.needsSynthesis).toBe(true);
  });

  it("maps 'what framework and branch is this' to both tools", () => {
    const m = matchReadTools("what framework and branch is this");
    expect(m).not.toBeNull();
    expect(m!.calls).toHaveLength(2);
    expect(m!.needsSynthesis).toBe(true);
  });

  it("returns null for unmatched queries", () => {
    expect(matchReadTools("whats up")).toBeNull();
    expect(matchReadTools("fix the bug")).toBeNull();
    expect(matchReadTools("hello")).toBeNull();
  });

  it("single inspect_package query needs synthesis (raw data needs formatting)", () => {
    const m = matchReadTools("what framework is this");
    expect(m!.needsSynthesis).toBe(true);
  });

  it("single branch query does not need synthesis", () => {
    const m = matchReadTools("what branch am i on");
    expect(m!.needsSynthesis).toBe(false);
  });

  it("single status query does not need synthesis", () => {
    const m = matchReadTools("what files changed");
    expect(m!.needsSynthesis).toBe(false);
  });
});

describe("executeReadTools", () => {
  it("executes tools and returns results in order", async () => {
    const calls = [
      { toolId: "project.branch", args: {}, label: "Get branch" },
      { toolId: "project.inspect_package", args: {}, label: "Inspect package" },
    ];
    const execute = async (toolId: string) =>
      ok(`${toolId} result`, { toolId });
    const results = await executeReadTools(calls, execute);
    expect(results).toHaveLength(2);
    expect(results[0].toolId).toBe("project.branch");
    expect(results[1].toolId).toBe("project.inspect_package");
    expect(results[0].result.success).toBe(true);
    expect(results[1].result.success).toBe(true);
  });

  it("preserves order even with different execution times", async () => {
    const calls = [
      { toolId: "slow", args: {}, label: "Slow tool" },
      { toolId: "fast", args: {}, label: "Fast tool" },
    ];
    const execute = async (toolId: string) => {
      if (toolId === "slow") {
        await new Promise((r) => setTimeout(r, 50));
      }
      return ok(`${toolId} done`);
    };
    const results = await executeReadTools(calls, execute);
    expect(results[0].toolId).toBe("slow");
    expect(results[1].toolId).toBe("fast");
  });

  it("handles mixed success/failure", async () => {
    const calls = [
      { toolId: "good", args: {}, label: "Good" },
      { toolId: "bad", args: {}, label: "Bad" },
    ];
    const execute = async (toolId: string) =>
      toolId === "good" ? ok("worked") : fail("broke");
    const results = await executeReadTools(calls, execute);
    expect(results[0].result.success).toBe(true);
    expect(results[1].result.success).toBe(false);
  });

  it("records timing for each tool", async () => {
    const calls = [{ toolId: "timed", args: {}, label: "Timed" }];
    const execute = async () => {
      await new Promise((r) => setTimeout(r, 20));
      return ok("done");
    };
    const results = await executeReadTools(calls, execute);
    expect(results[0].ms).toBeGreaterThanOrEqual(15);
  });
});

describe("formatReadResultsForSynthesis", () => {
  it("includes original query in synthesis prompt", () => {
    const results = [
      {
        toolId: "project.inspect_package",
        label: "Inspect package",
        result: ok("next.js", { framework: "Next.js" }),
        ms: 10,
      },
    ];
    const prompt = formatReadResultsForSynthesis("what framework is this", results);
    expect(prompt).toContain("what framework is this");
    expect(prompt).toContain("project.inspect_package");
    expect(prompt).toContain("Next.js");
  });

  it("instructs model to use only evidence", () => {
    const results = [
      {
        toolId: "project.branch",
        label: "Get branch",
        result: ok("main", { branch: "main" }),
        ms: 5,
      },
    ];
    const prompt = formatReadResultsForSynthesis("what branch", results);
    expect(prompt).toContain("do not fabricate");
  });

  it("includes multiple tool results for compound queries", () => {
    const results = [
      {
        toolId: "project.inspect_package",
        label: "Inspect package",
        result: ok("next.js", { framework: "Next.js" }),
        ms: 10,
      },
      {
        toolId: "project.branch",
        label: "Get branch",
        result: ok("main", { branch: "main" }),
        ms: 5,
      },
    ];
    const prompt = formatReadResultsForSynthesis("framework and branch", results);
    expect(prompt).toContain("project.inspect_package");
    expect(prompt).toContain("project.branch");
  });
});
