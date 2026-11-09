/**
 * Tests for separator-tolerant tool-id canonicalization.
 *
 * Weak local models emit "project_diff"/"project-diff" for the canonical
 * "project.diff". canonicalizeToolId substitutes the canonical id ONLY
 * when the separator-stripped form matches exactly one registered id;
 * everything else stays on the honest unknown-tool path.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "../agent-loop.js";
import { ToolRegistry } from "../tools.js";
import type { ToolResult, ModelProvider, ChatMessage, ModelStreamEvent, ModelResult, ToolDefinition, ToolMetadata } from "../types.js";

function makeTool(
  id: string,
  result: ToolResult,
): { definition: ToolDefinition; metadata: ToolMetadata; handler: () => Promise<ToolResult> } {
  return {
    definition: {
      id,
      name: id,
      description: `Mock tool ${id}`,
      inputSchema: {},
      readOnly: true,
    },
    metadata: { projectScoped: false, mutating: false, readOnly: true },
    handler: async () => result,
  };
}

function makeRegistry(tools: Array<ReturnType<typeof makeTool>>): ToolRegistry {
  const reg = new ToolRegistry();
  for (const t of tools) reg.register({ definition: t.definition, handler: t.handler, metadata: t.metadata });
  return reg;
}

function mockModel(responses: string[]): ModelProvider {
  let round = 0;
  return {
    async stream(_messages: ChatMessage[], emit: (event: ModelStreamEvent) => void): Promise<ModelResult> {
      const response = responses[Math.min(round, responses.length - 1)];
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

const OK: ToolResult = { status: "success", success: true, message: "ok", data: {} };

describe("tool-id canonicalization", () => {
  it("resolves underscore variant project_diff to canonical project.diff", async () => {
    const registry = makeRegistry([makeTool("project.diff", OK)]);
    const model = mockModel([
      '```tool_call\n{ "tool": "project_diff", "inputs": {} }\n```',
      "done",
    ]);
    const result = await runAgentLoop("show the diff", {
      model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 5,
    });
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].toolId, "project.diff");
    assert.equal(result.toolCalls[0].result.success, true);
  });

  it("resolves hyphen variant project-diff to canonical project.diff", async () => {
    const registry = makeRegistry([makeTool("project.diff", OK)]);
    const model = mockModel([
      '```tool_call\n{ "tool": "project-diff", "inputs": {} }\n```',
      "done",
    ]);
    const result = await runAgentLoop("show the diff", {
      model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 5,
    });
    assert.equal(result.toolCalls[0].toolId, "project.diff");
    assert.equal(result.toolCalls[0].result.success, true);
  });

  it("resolves case-drifted id to canonical form", async () => {
    const registry = makeRegistry([makeTool("project.status", OK)]);
    const model = mockModel([
      '```tool_call\n{ "tool": "PROJECT_STATUS", "inputs": {} }\n```',
      "done",
    ]);
    const result = await runAgentLoop("status?", {
      model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 5,
    });
    assert.equal(result.toolCalls[0].toolId, "project.status");
    assert.equal(result.toolCalls[0].result.success, true);
  });

  it("leaves a genuinely unknown tool on the honest unknown-tool path", async () => {
    const registry = makeRegistry([makeTool("project.diff", OK)]);
    const model = mockModel([
      '```tool_call\n{ "tool": "project_diffff", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "project_diffff", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "project_diffff", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "project_diffff", "inputs": {} }\n```',
    ]);
    const result = await runAgentLoop("show the diff", {
      model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 8,
    });
    // Never executed the wrong tool; terminated with an honest error.
    assert.equal(result.toolCalls.filter((t) => t.result.success).length, 0);
    assert.equal(result.termination, "error");
    assert.match(result.content, /project_diffff/);
  });

  it("does not canonicalize when the squashed form is ambiguous", async () => {
    // "x.y_z" and "x_y.z" both squash to "xyz" — an emitted "x-y-z"
    // must NOT pick one arbitrarily.
    const registry = makeRegistry([
      makeTool("x.y_z", OK),
      makeTool("x_y.z", OK),
    ]);
    const model = mockModel([
      '```tool_call\n{ "tool": "x-y-z", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "x-y-z", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "x-y-z", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "x-y-z", "inputs": {} }\n```',
    ]);
    const result = await runAgentLoop("go", {
      model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 8,
    });
    assert.equal(result.toolCalls.length, 0);
    assert.equal(result.termination, "error");
  });

  it("does not rewrite a leaf-only name that is not a registered id", async () => {
    const registry = makeRegistry([makeTool("project.diff", OK)]);
    const model = mockModel([
      '```tool_call\n{ "tool": "diff", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "diff", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "diff", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "diff", "inputs": {} }\n```',
    ]);
    const result = await runAgentLoop("show the diff", {
      model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 8,
    });
    // "diff" squashes to "diff"; "project.diff" squashes to "projectdiff" —
    // no match, so it stays unknown rather than guessing project.diff.
    assert.equal(result.toolCalls.length, 0);
    assert.equal(result.termination, "error");
  });
});
