/**
 * Regression tests for LiTT agent UX behavior rules.
 *
 * These verify the intent classification, conversational detection,
 * and turn resolution that prevent LiTT from behaving like a chatbot
 * with fake work logs.
 *
 * Run: npx vitest run src/lib/litt-kernel/intent-router.test.ts
 */

import { describe, it, expect } from "vitest";
import { classifyIntent, isConversational } from "./intent-router";
import { resolveTurn } from "../litt-intelligence/turn-resolver";

// ─── Rule 1: "what's up" in ACT → conversational reply, no work log ──

describe("Rule 1: Conversational messages don't trigger execution", () => {
  it("'what's up' is classified as conversational, not status mode", () => {
    const result = classifyIntent("what's up");
    expect(result.requiresExecution).toBe(false);
    expect(result.requiresProject).toBe(false);
    expect(result.mode).toBe("think");
    expect(isConversational("what's up")).toBe(true);
  });

  it("'hey' is conversational", () => {
    const result = classifyIntent("hey");
    expect(result.requiresExecution).toBe(false);
    expect(isConversational("hey")).toBe(true);
  });

  it("'thanks' is conversational", () => {
    const result = classifyIntent("thanks");
    expect(result.requiresExecution).toBe(false);
    expect(isConversational("thanks")).toBe(true);
  });

  it("'cool' is conversational", () => {
    const result = classifyIntent("cool");
    expect(result.requiresExecution).toBe(false);
    expect(isConversational("cool")).toBe(true);
  });

  it("'ok' is conversational", () => {
    const result = classifyIntent("ok");
    expect(result.requiresExecution).toBe(false);
    expect(isConversational("ok")).toBe(true);
  });

  it("conversational messages have high confidence (not default 0.5)", () => {
    const result = classifyIntent("what's up");
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.reasoning).toContain("Conversational");
  });
});

// ─── Rule 2: "fix the failing voice test" → tool execution begins ──

describe("Rule 2: Actionable messages trigger execution", () => {
  it("'fix the failing voice test' requires execution and project", () => {
    const result = classifyIntent("fix the failing voice test");
    expect(result.requiresExecution).toBe(true);
    expect(result.requiresProject).toBe(true);
    expect(result.mode).toBe("build");
  });

  it("'add a new endpoint' requires execution", () => {
    const result = classifyIntent("add a new endpoint");
    expect(result.requiresExecution).toBe(true);
  });

  it("'deploy the project' requires execution", () => {
    const result = classifyIntent("deploy the project");
    expect(result.requiresExecution).toBe(true);
  });

  it("'refactor the auth module' requires execution", () => {
    const result = classifyIntent("refactor the auth module");
    expect(result.requiresExecution).toBe(true);
  });

  it("actionable messages are not conversational", () => {
    expect(isConversational("fix the failing voice test")).toBe(false);
    expect(isConversational("add a new endpoint")).toBe(false);
  });
});

// ─── Rule 3: "yes, do it" continues previous proposed action ──

describe("Rule 3: Continuation phrases resolve to previous topic", () => {
  const history = [
    { role: "user" as const, content: "Fix the failing voice test" },
    { role: "assistant" as const, content: "I found the issue in the token route. Should I fix it?" },
  ];

  it("'yes, do it' resolves with context from conversation", () => {
    const result = resolveTurn("yes, do it", history);
    expect(result.confidence).toBeGreaterThan(0.7);
    // The resolver extracts context from the assistant's response
    // (mentions of files/errors) or falls back to the user's message.
    // Either way, the resolved message should contain "proceed with".
    expect(result.resolved).toContain("proceed with");
  });

  it("'do it' resolves with context from conversation", () => {
    const result = resolveTurn("do it", history);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.resolved).toContain("proceed with");
  });

  it("'go ahead' resolves with context from conversation", () => {
    const result = resolveTurn("go ahead", history);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.resolved).toContain("proceed with");
  });

  it("'keep going' resolves with context from conversation", () => {
    const result = resolveTurn("keep going", history);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.resolved).toContain("proceed with");
  });

  it("'proceed' resolves with context from conversation", () => {
    const result = resolveTurn("proceed", history);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.resolved).toContain("proceed with");
  });

  it("continuation resolves to user's original message when assistant has no file/error mentions", () => {
    const historyNoMentions = [
      { role: "user" as const, content: "Fix the failing voice test" },
      { role: "assistant" as const, content: "Sure, I can help with that." },
    ];
    const result = resolveTurn("do it", historyNoMentions);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.resolved).toContain("Fix the failing voice test");
  });
});

// ─── Rule 4: Project already selected → no project-confirmation question ──

describe("Rule 4: Project context doesn't require confirmation", () => {
  it("actionable message with project context doesn't ask for project", () => {
    // The intent router should classify "fix the bug" as build mode
    // with requiresProject=true. The kernel should NOT block when
    // a project IS provided.
    const result = classifyIntent("fix the bug in the auth route");
    expect(result.requiresProject).toBe(true);
    // When a project IS selected, the kernel's project check passes.
    // This is tested in kernel.test.ts — here we verify the intent
    // doesn't produce a "needs project" conversational mode.
    expect(result.mode).not.toBe("think");
    expect(result.requiresExecution).toBe(true);
  });
});

// ─── Rule 5: Progress card only appears after real action/tool invocation ──

describe("Rule 5: Conversational messages don't produce tool activity", () => {
  it("conversational classification has requiresExecution=false", () => {
    const result = classifyIntent("hey");
    expect(result.requiresExecution).toBe(false);
    // requiresExecution=false means the V2 agent loop won't run,
    // which means no toolActivity will be generated,
    // which means ActiveTaskCard won't render.
  });

  it("actionable classification has requiresExecution=true", () => {
    const result = classifyIntent("fix the bug");
    expect(result.requiresExecution).toBe(true);
    // requiresExecution=true means the V2 agent loop will run,
    // which means toolActivity will be generated,
    // which means ActiveTaskCard will render.
  });
});

// ─── Rule 6: Completed task collapses into one summary ──

describe("Rule 6: Turn resolver doesn't fragment responses", () => {
  it("long actionable messages are not treated as conversational", () => {
    const longMessage = "Fix the failing voice test by updating the token route to properly handle the case where the LiveKit environment variables are missing";
    expect(isConversational(longMessage)).toBe(false);
    const result = classifyIntent(longMessage);
    expect(result.requiresExecution).toBe(true);
  });

  it("short conversational messages are not treated as actionable", () => {
    expect(isConversational("what's good")).toBe(true);
    const result = classifyIntent("what's good");
    expect(result.requiresExecution).toBe(false);
  });
});
