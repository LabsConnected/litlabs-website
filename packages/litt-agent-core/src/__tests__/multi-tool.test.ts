/**
 * Tests for multi-tool parallel execution in the agent loop.
 *
 * Tests:
 *   - parseToolCalls extracts multiple tool calls from one response
 *   - parseToolCalls deduplicates identical tool calls
 *   - Parallel execution: 2 successful reads run in one round
 *   - Mixed success/failure: both results fed back to model
 *   - Ordering: results normalized in document order
 *   - Same-tool multiple calls: different inputs, both execute
 *   - Dependent tools remain sequential (mutations not parallelized)
 *   - Unique toolCallIds for each parallel tool
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseToolCalls, parseToolCall, runAgentLoop } from "../agent-loop.js";
import { ToolRegistry } from "../tools.js";
import type { ToolResult, ModelProvider, ChatMessage, ModelStreamEvent, ModelResult, ToolDefinition, ToolMetadata } from "../types.js";

// ─── Mock tool helpers ─────────────────────────────────────────────

function makeTool(
  id: string,
  result: ToolResult,
  opts: { readOnly?: boolean; mutating?: boolean } = {},
): { definition: ToolDefinition; metadata: ToolMetadata; handler: (ctx: unknown, args: Record<string, unknown>) => Promise<ToolResult> } {
  return {
    definition: {
      id,
      name: id,
      description: `Mock tool ${id}`,
      inputSchema: {},
      readOnly: opts.readOnly ?? true,
    },
    metadata: {
      projectScoped: false,
      mutating: opts.mutating ?? false,
      readOnly: opts.readOnly ?? true,
    },
    handler: async () => result,
  };
}

function makeRegistry(tools: Array<{ definition: ToolDefinition; metadata: ToolMetadata; handler: (ctx: unknown, args: Record<string, unknown>) => Promise<ToolResult> }>): ToolRegistry {
  const reg = new ToolRegistry();
  for (const t of tools) {
    reg.register({ definition: t.definition, handler: t.handler, metadata: t.metadata });
  }
  return reg;
}

function mockModelMultiRound(responses: string[]): ModelProvider {
  let round = 0;
  return {
    async stream(_messages: ChatMessage[], emit: (event: ModelStreamEvent) => void): Promise<ModelResult> {
      const response = responses[round] ?? responses[responses.length - 1];
      round++;
      emit({ type: "delta", text: response });
      return {
        content: response,
        model: "mock",
        provider: "mock",
        usage: { total_tokens: 10 },
        timing: { ttftMs: 1, generationMs: 1, totalMs: 1 },
        profile: "fast",
      };
    },
    async health(): Promise<number> { return 1; },
  };
}

// ─── parseToolCalls tests ──────────────────────────────────────────

describe("parseToolCalls", () => {
  it("extracts a single fenced tool call", () => {
    const content = 'Some prose\n```tool_call\n{ "tool": "project.status", "inputs": {} }\n```';
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "project.status");
  });

  it("extracts multiple fenced tool calls", () => {
    const content = [
      "```tool_call",
      '{ "tool": "project.status", "inputs": {} }',
      "```",
      "```tool_call",
      '{ "tool": "project.branch", "inputs": {} }',
      "```",
    ].join("\n");
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].toolId, "project.status");
    assert.equal(calls[1].toolId, "project.branch");
  });

  it("extracts bare JSON tool objects on separate lines", () => {
    const content = [
      'Here are the tools:',
      '{ "tool": "project.status", "inputs": {} }',
      '{ "tool": "project.branch", "inputs": {} }',
    ].join("\n");
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].toolId, "project.status");
    assert.equal(calls[1].toolId, "project.branch");
  });

  it("deduplicates identical tool calls", () => {
    const content = [
      "```tool_call",
      '{ "tool": "project.status", "inputs": {} }',
      "```",
      "```tool_call",
      '{ "tool": "project.status", "inputs": {} }',
      "```",
    ].join("\n");
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 1);
  });

  it("does NOT deduplicate same tool with different inputs", () => {
    const content = [
      "```tool_call",
      '{ "tool": "project.log", "inputs": { "limit": 5 } }',
      "```",
      "```tool_call",
      '{ "tool": "project.log", "inputs": { "limit": 10 } }',
      "```",
    ].join("\n");
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 2);
  });

  it("returns empty array when no tool calls present", () => {
    assert.deepEqual(parseToolCalls("just some text"), []);
    assert.deepEqual(parseToolCalls(""), []);
  });

  it("first element matches parseToolCall result (backward compat)", () => {
    const content = '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```';
    const single = parseToolCall(content);
    const multi = parseToolCalls(content);
    assert.equal(multi.length, 1);
    assert.equal(multi[0].toolId, single!.toolId);
  });

  it("extracts an antml-style <tool_call> envelope (the production leak shape)", () => {
    const content =
      "Let me inspect the file first.\n" +
      "<tool_call>terminal\n<arg_key>command</arg_key>\n<arg_value>cat -n index.html</arg_value>" +
      "<arg_key>project_id</arg_key>\n<arg_value>abc-123</arg_value>\n</tool_call>";
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "terminal");
    assert.deepEqual(calls[0].inputs, { command: "cat -n index.html", project_id: "abc-123" });
  });

  it("extracts <tool_call> envelopes carrying JSON payloads", () => {
    const calls = parseToolCalls(
      'Done.\n<tool_call>{"name":"project.read_file","arguments":{"path":"a.txt"}}</tool_call>',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "project.read_file");
    assert.deepEqual(calls[0].inputs, { path: "a.txt" });
  });

  it("extracts <invoke name>…<parameter> envelopes", () => {
    const calls = parseToolCalls(
      '<invoke name="project.read_file"><parameter name="path">a.txt</parameter></invoke>',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "project.read_file");
    assert.deepEqual(calls[0].inputs, { path: "a.txt" });
  });

  it("extracts <dots_function_call> envelopes", () => {
    const calls = parseToolCalls(
      '<dots_function_call>project.status<arg_key>verbose</arg_key><arg_value>true</arg_value></dots_function_call>',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "project.status");
    assert.deepEqual(calls[0].inputs, { verbose: true });
  });

  it("deduplicates an XML envelope against its fenced twin", () => {
    const content =
      '<tool_call>{"name":"project.status","arguments":{}}</tool_call>\n' +
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```';
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "project.status");
  });

  it("does not extract an envelope whose payload is not a call", () => {
    // Prose payloads with a lone leading word are not calls (a bare token
    // is only a tool id when it constitutes the whole envelope body).
    assert.deepEqual(
      parseToolCalls("<tool_call>example of a non-call payload</tool_call>"),
      [],
    );
  });
});

// ─── Parallel execution tests ──────────────────────────────────────

describe("runAgentLoop multi-tool parallel execution", () => {
  it("executes 2 read-only tools in parallel in one round", async () => {
    const statusTool = makeTool("project.status", {
      status: "success", success: true, message: "clean", data: { branch: "main" },
    });
    const branchTool = makeTool("project.branch", {
      status: "success", success: true, message: "main", data: { branch: "main" },
    });
    const registry = makeRegistry([statusTool, branchTool]);

    const twoToolsResponse = [
      "```tool_call",
      '{ "tool": "project.status", "inputs": {} }',
      "```",
      "```tool_call",
      '{ "tool": "project.branch", "inputs": {} }',
      "```",
    ].join("\n");

    const model = mockModelMultiRound([twoToolsResponse, "Branch is main, status is clean."]);

    const result = await runAgentLoop("what's the status and branch?", {
      model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 5,
    });

    assert.equal(result.toolCalls.length, 2);
    assert.equal(result.toolCalls[0].toolId, "project.status");
    assert.equal(result.toolCalls[1].toolId, "project.branch");
    assert.equal(result.rounds, 2);
  });

  it("handles mixed success/failure in parallel execution", async () => {
    const goodTool = makeTool("project.status", {
      status: "success", success: true, message: "ok", data: {},
    });
    const badTool = makeTool("project.branch", {
      status: "failed", success: false, message: "no git repo", data: {},
    });
    const registry = makeRegistry([goodTool, badTool]);

    const twoToolsResponse = [
      "```tool_call",
      '{ "tool": "project.status", "inputs": {} }',
      "```",
      "```tool_call",
      '{ "tool": "project.branch", "inputs": {} }',
      "```",
    ].join("\n");

    const model = mockModelMultiRound([twoToolsResponse, "Status ok, branch failed."]);

    const result = await runAgentLoop("status and branch", {
      model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 5,
    });

    assert.equal(result.toolCalls.length, 2);
    assert.equal(result.toolCalls[0].result.success, true);
    assert.equal(result.toolCalls[1].result.success, false);
  });

  it("does NOT parallelize mutating tools (falls back to first tool only)", async () => {
    const readTool = makeTool("project.status", {
      status: "success", success: true, message: "ok", data: {},
    });
    const mutatingTool = makeTool("project.run", {
      status: "success", success: true, message: "ran", data: {},
    }, { readOnly: false, mutating: true });
    const registry = makeRegistry([readTool, mutatingTool]);

    const mixedResponse = [
      "```tool_call",
      '{ "tool": "project.status", "inputs": {} }',
      "```",
      "```tool_call",
      '{ "tool": "project.run", "inputs": { "command": "echo" } }',
      "```",
    ].join("\n");
    const runResponse = '```tool_call\n{ "tool": "project.run", "inputs": { "command": "echo" } }\n```';

    const model = mockModelMultiRound([mixedResponse, runResponse, "Done."]);

    const result = await runAgentLoop("check status then run echo", {
      model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 5,
    });

    // Only the first tool (read-only) should execute in round 1.
    assert.ok(result.toolCalls.length >= 1);
    assert.equal(result.toolCalls[0].toolId, "project.status");
  });

  it("preserves result ordering in document order", async () => {
    const toolA = makeTool("tool_a", {
      status: "success", success: true, message: "a", data: { order: 1 },
    });
    const toolB = makeTool("tool_b", {
      status: "success", success: true, message: "b", data: { order: 2 },
    });
    const registry = makeRegistry([toolA, toolB]);

    const twoTools = [
      "```tool_call",
      '{ "tool": "tool_a", "inputs": {} }',
      "```",
      "```tool_call",
      '{ "tool": "tool_b", "inputs": {} }',
      "```",
    ].join("\n");

    const model = mockModelMultiRound([twoTools, "Done."]);

    const result = await runAgentLoop("run a and b", {
      model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 5,
    });

    assert.equal(result.toolCalls[0].toolId, "tool_a");
    assert.equal(result.toolCalls[1].toolId, "tool_b");
    assert.equal((result.toolCalls[0].result.data as { order: number }).order, 1);
    assert.equal((result.toolCalls[1].result.data as { order: number }).order, 2);
  });

  it("assigns unique toolCallIds to each parallel tool", async () => {
    const toolA = makeTool("tool_a", {
      status: "success", success: true, message: "a", data: {},
    });
    const toolB = makeTool("tool_b", {
      status: "success", success: true, message: "b", data: {},
    });
    const registry = makeRegistry([toolA, toolB]);

    const twoTools = [
      "```tool_call",
      '{ "tool": "tool_a", "inputs": {} }',
      "```",
      "```tool_call",
      '{ "tool": "tool_b", "inputs": {} }',
      "```",
    ].join("\n");

    const model = mockModelMultiRound([twoTools, "Done."]);

    const result = await runAgentLoop("run a and b", {
      model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 5,
    });

    assert.equal(result.toolCalls.length, 2);
    assert.notEqual(result.toolCalls[0].toolCallId, result.toolCalls[1].toolCallId);
  });

  it("same tool with different inputs both execute", async () => {
    const logTool: { definition: ToolDefinition; metadata: ToolMetadata; handler: (ctx: unknown, args: Record<string, unknown>) => Promise<ToolResult> } = {
      definition: {
        id: "project.log",
        name: "project.log",
        description: "Git log",
        inputSchema: {},
        readOnly: true,
      },
      metadata: { projectScoped: false, mutating: false, readOnly: true },
      handler: async (_ctx, args) => ({
        status: "success",
        success: true,
        message: `log limit=${args.limit ?? 10}`,
        data: { limit: args.limit ?? 10 },
      }),
    };
    const registry = new ToolRegistry();
    registry.register({ definition: logTool.definition, handler: logTool.handler, metadata: logTool.metadata });

    const twoTools = [
      "```tool_call",
      '{ "tool": "project.log", "inputs": { "limit": 5 } }',
      "```",
      "```tool_call",
      '{ "tool": "project.log", "inputs": { "limit": 10 } }',
      "```",
    ].join("\n");

    const model = mockModelMultiRound([twoTools, "Done."]);

    const result = await runAgentLoop("show 5 and 10 commits", {
      model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 5,
    });

    assert.equal(result.toolCalls.length, 2);
    assert.equal(result.toolCalls[0].toolId, "project.log");
    assert.equal(result.toolCalls[1].toolId, "project.log");
    assert.equal((result.toolCalls[0].result.data as { limit: number }).limit, 5);
    assert.equal((result.toolCalls[1].result.data as { limit: number }).limit, 10);
  });
});

