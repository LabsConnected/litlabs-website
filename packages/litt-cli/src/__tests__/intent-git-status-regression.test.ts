import { describe, expect, it } from "vitest";
import { classifyIntent } from "../lib/intent.js";

describe("git status intent regression", () => {
  it.each([
    "Check the current git status and tell me what changed.",
    "Check the git status.",
    "Show me the current git status.",
    "Show the git status.",
  ])("classifies %j as READ", (input) => {
    expect(classifyIntent(input)).toBe("read");
  });

  it.each([
    "Run the tests.",
    "Fix the auth bug.",
    "Build the CLI.",
    "Deploy the app.",
  ])("keeps %j as MISSION", (input) => {
    expect(classifyIntent(input)).toBe("mission");
  });

  it("keeps ordinary conversation as CHAT", () => {
    expect(classifyIntent("Reply with exactly: LITT_TUI_OK")).toBe("chat");
  });
});
