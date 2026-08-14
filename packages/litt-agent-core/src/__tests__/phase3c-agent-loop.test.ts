/**
 * Phase 3C.2 — Agent loop tests.
 *
 * Tests the canonical agent loop that routes every tool call through
 * the shared ToolRegistry + ShellExecutor. No second executor.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runAgentLoop,
  parseToolCall,
  stripToolCallBlocks,
  buildDefaultSystemPrompt,
} from "../agent-loop.js";
import { createDefaultRegistry } from "../tools.js";
import { NodeShellExecutor } from "../shell.js";
import { RuntimeStore } from "../state.js";
import type {
  ModelProvider,
  ModelStreamEvent,
  ChatMessage,
  ModelProfile,
  ModelResult,
} from "../types.js";

// ─── Mock Model Provider ───────────────────────────────────────────

function makeMockModel(responses: string[]): ModelProvider {
  let callIndex = 0;
  return {
    async stream(
      _messages: ChatMessage[],
      emit: (event: ModelStreamEvent) => void,
    ): Promise<ModelResult> {
      const response = responses[callIndex++] ?? responses[responses.length - 1];
      emit({ type: "meta", provider: "mock", model: "mock-model", profile: "fast" });
      const words = response.split(" ");
      for (const word of words) {
        emit({ type: "delta", text: word + " " });
      }
      emit({
        type: "done",
        model: "mock-model",
        usage: { total_tokens: words.length },
        timing: { ttftMs: 10, generationMs: 20, totalMs: 30 },
      });
      return {
        content: response,
        model: "mock-model",
        provider: "mock",
        usage: { total_tokens: words.length },
        timing: { ttftMs: 10, generationMs: 20, totalMs: 30 },
        profile: "fast" as ModelProfile,
      };
    },
    async health(): Promise<number> {
      return 100;
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("Agent Loop", () => {
  // ─── Tool call parsing ──────────────────────────────────────────

  it("parses a valid tool_call block", () => {
    const content = 'Some text\n\n```tool_call\n{ "tool": "project.status", "inputs": {} }\n```\nMore text';
    const parsed = parseToolCall(content);
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.status");
    assert.deepEqual(parsed!.inputs, {});
  });

  it("parses tool_call with inputs", () => {
    const content = '```tool_call\n{ "tool": "project.run", "inputs": { "command": "echo", "args": ["hello"] } }\n```';
    const parsed = parseToolCall(content);
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.run");
    assert.equal(parsed!.inputs.command, "echo");
    assert.deepEqual(parsed!.inputs.args, ["hello"]);
  });

  it("returns null for malformed tool_call block", () => {
    const content = '```tool_call\n{ not valid json }\n```';
    const parsed = parseToolCall(content);
    assert.equal(parsed, null);
  });

  it("returns null when no tool_call block present", () => {
    const content = "Just a regular response with no tool calls.";
    const parsed = parseToolCall(content);
    assert.equal(parsed, null);
  });

  it("returns null when tool field is missing", () => {
    const content = '```tool_call\n{ "inputs": {} }\n```';
    const parsed = parseToolCall(content);
    assert.equal(parsed, null);
  });

  it("strips tool_call blocks from content", () => {
    const content = 'Before\n```tool_call\n{ "tool": "x", "inputs": {} }\n```\nAfter';
    const stripped = stripToolCallBlocks(content);
    assert.equal(stripped, "Before\n\nAfter");
  });

  // ─── System prompt builder ──────────────────────────────────────

  it("builds system prompt with tool definitions", () => {
    const tools = [
      {
        id: "project.status",
        name: "status",
        description: "Get project status",
        inputSchema: { type: "object", properties: {} },
        readOnly: true,
      },
      {
        id: "project.check",
        name: "check",
        description: "Run typecheck",
        inputSchema: { type: "object", properties: {} },
        readOnly: true,
      },
    ];
    const prompt = buildDefaultSystemPrompt(tools);
    assert.ok(prompt.includes("project.status"));
    assert.ok(prompt.includes("project.check"));
    assert.ok(prompt.includes("tool_call"));
  });

  // ─── Agent loop execution ───────────────────────────────────────

  it("returns final answer when no tool call is needed", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel(["The project looks good. No changes needed."]);

    const result = await runAgentLoop("Check my project", {
      model, tools, shell, store, cwd: process.cwd(),
    });

    assert.equal(result.termination, "complete");
    assert.ok(result.content.includes("project looks good"));
    assert.equal(result.toolCalls.length, 0);
    assert.equal(result.rounds, 1);
  });

  it("executes a tool call and returns the result to the model", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "The project is on the right branch. Everything looks clean.",
    ]);

    const result = await runAgentLoop("What's my project status?", {
      model, tools, shell, store, cwd: process.cwd(),
    });

    assert.equal(result.termination, "complete");
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].toolId, "project.status");
    assert.equal(result.toolCalls[0].toolName, "status");
    assert.equal(result.rounds, 2);
    assert.ok(result.content.length > 0);
  });

  it("handles unknown tool gracefully", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '```tool_call\n{ "tool": "nonexistent.tool", "inputs": {} }\n```',
      "Sorry, that tool doesn't exist. Let me check status instead.",
    ]);

    const result = await runAgentLoop("Run unknown tool", {
      model, tools, shell, store, cwd: process.cwd(),
    });

    assert.equal(result.termination, "complete");
    assert.equal(result.toolCalls.length, 0);
    assert.equal(result.rounds, 2);
  });

  it("respects maxRounds limit", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
    ]);

    const result = await runAgentLoop("Keep calling tools", {
      model, tools, shell, store, cwd: process.cwd(), maxRounds: 3,
    });

    assert.equal(result.termination, "max_rounds");
    assert.equal(result.rounds, 3);
  });

  it("emits agent_tool_call and agent_tool_result events", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "Done.",
    ]);

    const events: string[] = [];
    const result = await runAgentLoop("Check status", {
      model, tools, shell, store, cwd: process.cwd(),
      emitter: (event) => {
        if (event.type === "litt_event") {
          events.push(event.subtype ?? "");
        }
      },
    });

    assert.equal(result.toolCalls.length, 1);
    assert.ok(events.includes("agent_tool_call"));
    assert.ok(events.includes("agent_tool_result"));
  });

  it("tracks tool calls in the result record", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "Status checked.",
    ]);

    const result = await runAgentLoop("Check status", {
      model, tools, shell, store, cwd: process.cwd(),
    });

    assert.equal(result.toolCalls.length, 1);
    const tc = result.toolCalls[0];
    assert.equal(tc.toolId, "project.status");
    assert.equal(tc.toolName, "status");
    assert.ok(tc.toolCallId.startsWith("tc_"));
    assert.ok(tc.durationMs >= 0);
    assert.equal(tc.result.status, "success");
    assert.equal(tc.result.success, true);
  });

  it("handles model errors gracefully", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model: ModelProvider = {
      async stream(): Promise<never> {
        throw new Error("Model API is down");
      },
      async health(): Promise<number> {
        return 0;
      },
    };

    const result = await runAgentLoop("Test", {
      model, tools, shell, store, cwd: process.cwd(),
    });

    assert.equal(result.termination, "error");
    assert.ok(result.content.includes("Model error"));
  });

  it("forwards model stream events to onModelStream callback", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel(["Hello world"]);

    const streamEvents: ModelStreamEvent[] = [];
    await runAgentLoop("Test", {
      model, tools, shell, store, cwd: process.cwd(),
      onModelStream: (event) => streamEvents.push(event),
    });

    assert.ok(streamEvents.length > 0);
    assert.ok(streamEvents.some((e) => e.type === "meta"));
    assert.ok(streamEvents.some((e) => e.type === "delta"));
    assert.ok(streamEvents.some((e) => e.type === "done"));
  });

  it("updates RuntimeStore with command lifecycle", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "Done.",
    ]);

    await runAgentLoop("Check status", {
      model, tools, shell, store, cwd: process.cwd(),
    });

    const state = store.getState();
    assert.notEqual(state.lastResult, null);
  });

  it("chains multiple tool calls", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "project.branch", "inputs": {} }\n```',
      "Both tools completed successfully.",
    ]);

    const result = await runAgentLoop("Check status and branch", {
      model, tools, shell, store, cwd: process.cwd(),
    });

    assert.equal(result.termination, "complete");
    assert.equal(result.toolCalls.length, 2);
    assert.equal(result.toolCalls[0].toolId, "project.status");
    assert.equal(result.toolCalls[1].toolId, "project.branch");
    assert.equal(result.rounds, 3);
  });
});
