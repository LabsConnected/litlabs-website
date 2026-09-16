/**
 * Canonical tool-call normalization for XML envelopes.
 *
 * The production defect: models that regress from native function calling
 * (or were trained on the AntML/Qwen text protocol) emit tool calls as
 * XML envelopes instead of fenced JSON:
 *
 *   <tool_call>terminal\n<arg_key>command</arg_key><arg_value>…</arg_value></tool_call>
 *   <invoke name="project.read_file"><parameter name="path">x</parameter></invoke>
 *   <dots_function_call>{"name": "…", "arguments": {…}}</dots_function_call>
 *
 * Nothing parsed those envelopes — the model's intent leaked into the
 * transcript as prose and the run completed with zero tools executed.
 * These tests pin the normalization contract: envelopes parse into the
 * SAME ParsedToolCall shape, dispatch through the SAME gateway, and strip
 * from transcript text — while prose that merely quotes markup never
 * executes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseToolCall, parseToolCalls, stripToolCallBlocks, runAgentLoop } from "../agent-loop.js";
import { ToolRegistry } from "../tools.js";
import type {
  ChatMessage,
  ModelProvider,
  ModelResult,
  ModelStreamEvent,
  ToolDefinition,
  ToolMetadata,
  ToolResult,
} from "../types.js";

// ─── Mock helpers (same shape as multi-tool.test.ts) ──────────────

function makeTool(
  id: string,
  result: ToolResult,
  onCall?: (args: Record<string, unknown>) => void,
) {
  return {
    definition: { id, name: id, description: `Mock ${id}`, inputSchema: {}, readOnly: true } as ToolDefinition,
    metadata: { projectScoped: false, mutating: false, readOnly: true } as ToolMetadata,
    handler: async (_ctx: unknown, args: Record<string, unknown>) => {
      onCall?.(args);
      return result;
    },
  };
}

function makeRegistry(tools: ReturnType<typeof makeTool>[]): ToolRegistry {
  const reg = new ToolRegistry();
  for (const t of tools) reg.register(t);
  return reg;
}

function mockModel(responses: string[]): ModelProvider {
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
    async health(): Promise<number> {
      return 1;
    },
  };
}

// ─── parseToolCalls / parseToolCall ────────────────────────────────

describe("XML envelope parsing", () => {
  it("parses <tool_call> with arg_key/arg_value pairs (observed production shape)", () => {
    const content =
      "Let me check that.\n<tool_call>terminal.execute\n" +
      "<arg_key>command</arg_key>\n<arg_value>git status</arg_value>\n</tool_call>";
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "terminal.execute");
    assert.equal(calls[0].inputs.command, "git status");
  });

  it("parses <tool_call> carrying a JSON body", () => {
    const content = '<tool_call>{"name": "project.read_file", "arguments": {"path": "package.json"}}</tool_call>';
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "project.read_file");
    assert.equal(calls[0].inputs.path, "package.json");
  });

  it("parses <invoke name> with <parameter> pairs", () => {
    const content =
      '<invoke name="project.read_file">' +
      '<parameter name="path">src/index.ts</parameter>' +
      "</invoke>";
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "project.read_file");
    assert.equal(calls[0].inputs.path, "src/index.ts");
  });

  it("parses antml-namespaced <antml:invoke> / <antml:parameter>", () => {
    const content =
      '<antml:invoke name="project.search">' +
      '<antml:parameter name="query">handleFilesWrite</antml:parameter>' +
      "</antml:invoke>";
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "project.search");
    assert.equal(calls[0].inputs.query, "handleFilesWrite");
  });

  it("parses <dots_function_call> with a JSON body", () => {
    const content =
      '<dots_function_call>{"name": "project.status", "arguments": {}}</dots_function_call>';
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "project.status");
  });

  it("parses <invoke> children inside a <function_calls> container", () => {
    const content =
      "<function_calls>" +
      '<invoke name="project.branch"></invoke>' +
      '<invoke name="project.status"></invoke>' +
      "</function_calls>";
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].toolId, "project.branch");
    assert.equal(calls[1].toolId, "project.status");
  });

  it("parses `name {json-args}` bodies", () => {
    const content = '<tool_call>project.log {"count": 3}</tool_call>';
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "project.log");
    assert.equal(calls[0].inputs.count, 3);
  });

  it("parses a bare tool id inside an envelope as a no-arg call", () => {
    const calls = parseToolCalls("<tool_call>project.status</tool_call>");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolId, "project.status");
    assert.deepEqual(calls[0].inputs, {});
  });

  it("coerces numeric/boolean arg values", () => {
    const content =
      "<tool_call>project.log\n<arg_key>count</arg_key><arg_value>10</arg_value>\n" +
      "<arg_key>staged</arg_key><arg_value>true</arg_value></tool_call>";
    const calls = parseToolCalls(content);
    assert.equal(calls[0].inputs.count, 10);
    assert.equal(calls[0].inputs.staged, true);
  });

  it("does NOT parse prose that quotes markup inside backticks", () => {
    const content = "Use `<tool_call>project.status</tool_call>` to check status.";
    assert.equal(parseToolCalls(content).length, 0);
    assert.equal(parseToolCall(content), null);
  });

  it("does NOT parse an envelope with no tool name", () => {
    assert.equal(parseToolCalls("<tool_call>hello world</tool_call>").length, 0);
    assert.equal(
      parseToolCalls("<invoke><parameter name=\"x\">1</parameter></invoke>").length,
      0,
    );
  });

  it("rejects a truncated envelope without executing what arrived", () => {
    const content =
      "<tool_call>project.read_file\n<arg_key>path</arg_key><arg_value>README.md</arg_value>";
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 0);
  });
});

// ─── stripToolCallBlocks ───────────────────────────────────────────

describe("stripToolCallBlocks — XML envelopes", () => {
  it("strips a closed <tool_call> envelope and its arg pairs", () => {
    const text =
      "Done.\n<tool_call>terminal.execute\n<arg_key>command</arg_key><arg_value>ls</arg_value></tool_call>";
    assert.equal(stripToolCallBlocks(text), "Done.");
  });

  it("strips <invoke> envelopes with parameters", () => {
    const text =
      'Checking.<invoke name="project.read_file"><parameter name="path">a.ts</parameter></invoke>';
    assert.equal(stripToolCallBlocks(text), "Checking.");
  });

  it("strips <dots_function_call> and <function_calls> containers", () => {
    const a = stripToolCallBlocks(
      'x<dots_function_call>{"name":"project.status","arguments":{}}</dots_function_call>y',
    );
    assert.equal(a, "xy");
    const b = stripToolCallBlocks(
      'ok<function_calls><invoke name="project.branch"></invoke></function_calls>',
    );
    assert.equal(b, "ok");
  });

  it("strips an unclosed trailing envelope", () => {
    const text = "Working on it.\n<tool_call>project.status\n<arg_key>foo</arg_key>";
    assert.equal(stripToolCallBlocks(text), "Working on it.");
  });

  it("strips orphan close tags", () => {
    assert.equal(stripToolCallBlocks("text </tool_call> more"), "text  more");
  });

  it("leaves ordinary prose untouched", () => {
    const text = "The project uses <components> and angle <brackets> in docs.";
    assert.equal(stripToolCallBlocks(text), text);
  });
});

// ─── Loop integration ──────────────────────────────────────────────

describe("runAgentLoop — XML envelope dispatch", () => {
  it("executes an XML-envelope call through the normal tool dispatch", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const tools = makeRegistry([
      makeTool(
        "project.read_file",
        { status: "success", success: true, message: "file contents", data: {} },
        (args) => seen.push(args),
      ),
    ]);
    const model = mockModel([
      "<tool_call>project.read_file\n<arg_key>path</arg_key><arg_value>package.json</arg_value>\n</tool_call>",
      "The package.json file exists.",
    ]);

    const result = await runAgentLoop("read package.json", {
      model,
      tools,
      shell: null as unknown as never,
      cwd: process.cwd(),
      maxRounds: 3,
    });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].path, "package.json");
    assert.equal(result.content, "The package.json file exists.");
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].toolId, "project.read_file");
    assert.equal(result.toolCalls[0].result.success, true);
  });
});
