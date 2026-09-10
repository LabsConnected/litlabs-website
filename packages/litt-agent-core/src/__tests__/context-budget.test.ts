/**
 * Context budget (Ollama/local constrained-model path).
 *
 * These exercise the compact/prune utilities that live in agent-loop.ts,
 * imported as production code — no test-local duplicate implementations.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDefaultSystemPrompt,
  compactToolResultData,
  estimateMessageTokens,
  pruneMessages,
} from "../agent-loop.js";
import type { ChatMessage, ToolDefinition } from "../types.js";

const sampleTool: ToolDefinition = {
  id: "project.status",
  name: "project status",
  description: "Show the current project status including git and package state.",
  inputSchema: {
    type: "object",
    properties: {
      verbose: { type: "boolean", description: "Include extra details." },
    },
    required: ["verbose"],
  },
  readOnly: true,
};

const sampleTools: ToolDefinition[] = [
  sampleTool,
  {
    id: "project.run",
    name: "project run",
    description: "Run a command in the project directory.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to run." },
        args: { type: "array", items: { type: "string" } },
      },
      required: ["command"],
    },
    readOnly: false,
  },
];

describe("buildDefaultSystemPrompt", () => {
  it("produces a compact prompt for Ollama with concise tool signatures", () => {
    const prompt = buildDefaultSystemPrompt(sampleTools, null, "linux", true);
    assert.ok(prompt.includes("tool_call"), "compact prompt should show tool_call fence");
    assert.ok(prompt.includes("project.status(verbose:boolean)"), "compact tool list should include required param type");
    assert.ok(prompt.includes("project.run(command:string, args?:array)"), "compact tool list should mark optional array param");
    assert.ok(!prompt.includes("Parameters:"), "compact prompt should not contain verbose Parameters section");
    assert.ok(prompt.includes("Be concise and evidence-driven."), "compact prompt should ask for conciseness");
  });

  it("keeps the full verbose prompt when compact is false", () => {
    const prompt = buildDefaultSystemPrompt(sampleTools, null, "linux", false);
    assert.ok(prompt.includes("Parameters:"), "non-compact prompt should contain Parameters section");
    assert.ok(prompt.includes('"verbose": boolean'), "non-compact prompt should describe verbose param");
    assert.ok(prompt.includes("AI development agent for LiTTree Lab Studios"), "non-compact prompt should keep full identity");
  });
});

describe("compactToolResultData", () => {
  it("returns data unchanged when compaction is disabled", () => {
    const data = { a: "x".repeat(10000) };
    assert.deepEqual(compactToolResultData(data, false), data);
  });

  it("truncates long strings in the middle", () => {
    const data = { output: "x".repeat(10000) };
    const out = compactToolResultData(data, true);
    const compacted = out.output as string;
    assert.ok(compacted.length < 2000, "long string should be compacted");
    assert.ok(compacted.startsWith("x"), "head should be preserved");
    assert.ok(compacted.endsWith("x"), "tail should be preserved");
    assert.ok(compacted.includes("[truncated]"), "truncation marker should be present");
  });

  it("caps arrays and reports remaining count", () => {
    const data = { items: Array.from({ length: 30 }, (_, i) => `item-${i}`) };
    const out = compactToolResultData(data, true);
    const arr = out.items as unknown[];
    assert.equal(arr.length, 21); // 20 items + marker
    assert.ok(arr.includes("... [10 more items truncated]"), "array truncation marker should be present");
  });

  it("caps object keys and reports omitted count", () => {
    const data: Record<string, string> = {};
    for (let i = 0; i < 40; i++) data[`key${i}`] = `value${i}`;
    const out = compactToolResultData(data, true);
    assert.ok(out.__truncated__, "truncation count should be recorded");
    assert.equal(Object.keys(out).length, 33); // 32 kept keys + __truncated__
  });
});

describe("estimateMessageTokens", () => {
  it("estimates from total message chars plus per-message overhead", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
    ];
    const tokens = estimateMessageTokens(messages);
    const chars = messages.reduce((s, m) => s + m.content.length + 32, 0);
    assert.equal(tokens, Math.ceil(chars / 3.25));
  });

  it("grows with message count", () => {
    const short: ChatMessage[] = [{ role: "user", content: "hi" }];
    const long: ChatMessage[] = Array.from({ length: 10 }, () => ({ role: "user", content: "hi" }));
    assert.ok(estimateMessageTokens(long) > estimateMessageTokens(short));
  });
});

describe("pruneMessages", () => {
  function makeConversation(): ChatMessage[] {
    return [
      { role: "system", content: "system" },
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
      { role: "assistant", content: "fourth" },
      { role: "user", content: "current" },
    ];
  }

  it("leaves a small conversation under budget unchanged", () => {
    const messages = makeConversation();
    pruneMessages(messages, 10000, "current");
    assert.equal(messages.length, 6);
  });

  it("preserves the system message and current prompt", () => {
    const messages = makeConversation();
    pruneMessages(messages, 1, "current");
    assert.equal(messages[0].role, "system");
    assert.ok(messages.some((m) => m.role === "user" && m.content === "current"), "current prompt must survive");
  });

  it("removes older messages before newer ones", () => {
    const messages = makeConversation();
    pruneMessages(messages, 1, "current");
    // After removal, current and system remain; the oldest user/assistant pair is gone.
    assert.ok(!messages.some((m) => m.content === "first"), "oldest user turn should be pruned first");
    assert.ok(!messages.some((m) => m.content === "second"), "matching assistant turn should also be pruned");
  });

  it("protects the most recent messages", () => {
    // A budget so tight that most messages must go, but the last few should be kept.
    const messages: ChatMessage[] = [
      { role: "system", content: "system" },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `turn-${i}`,
      })),
      { role: "user", content: "current" },
    ];
    pruneMessages(messages, 200, "current");
    assert.equal(messages[0].role, "system");
    assert.ok(messages.some((m) => m.role === "user" && m.content === "current"), "current prompt protected");
    assert.ok(messages.some((m) => m.content === "turn-19"), "last assistant turn protected");
    assert.ok(!messages.some((m) => m.content === "turn-0"), "oldest turns removed");
  });

  it("does nothing when budget is zero or negative", () => {
    const messages = makeConversation();
    pruneMessages(messages, 0, "current");
    assert.equal(messages.length, 6);
    pruneMessages(messages, -1, "current");
    assert.equal(messages.length, 6);
  });
});
