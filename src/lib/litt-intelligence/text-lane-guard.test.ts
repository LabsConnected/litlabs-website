// @vitest-environment node
import { describe, it, expect } from "vitest";
import { V1_NO_TOOLS_DIRECTIVE, withV1NoToolsDirective } from "./text-lane-guard";

/**
 * The V1 text-only lane attaches no tools to the model call, but the shared
 * runtime-context block teaches tool-invocation tokens. Without an explicit
 * constraint the model may echo tool calls as text — markup that can never
 * execute on this path. These pin the guard: the directive exists, names
 * every syntax shape the detector watches, and is actually appended.
 */
describe("text-lane guard — V1 no-tools directive", () => {
  it("states that no tools are available this turn", () => {
    expect(V1_NO_TOOLS_DIRECTIVE).toMatch(/no tools/i);
  });

  it("forbids every tool-call syntax shape the detector recognizes", () => {
    expect(V1_NO_TOOLS_DIRECTIVE).toMatch(/<tool_call>/);
    expect(V1_NO_TOOLS_DIRECTIVE).toMatch(/```tool_call/);
    expect(V1_NO_TOOLS_DIRECTIVE).toMatch(/JSON tool envelopes/i);
    expect(V1_NO_TOOLS_DIRECTIVE).toMatch(/tool\.name\(args\)/);
  });

  it("directs the model to plain words instead of written-out calls", () => {
    expect(V1_NO_TOOLS_DIRECTIVE).toMatch(/plain words/);
  });

  it("appends the directive to the prompt", () => {
    const prompt = "You are LiTT. Answer the user.";
    const guarded = withV1NoToolsDirective(prompt);
    expect(guarded.startsWith(prompt)).toBe(true);
    expect(guarded).toContain(V1_NO_TOOLS_DIRECTIVE);
    expect(guarded.length).toBeGreaterThan(prompt.length);
  });
});
