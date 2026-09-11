/**
 * Regression test for the "final assistant text disappears after a tool
 * call" bug.
 *
 * Observed symptom (reported against the CLI's MISSION/CHAT lanes, which
 * both call runAgentLoop): a read-only request like "show me the last 3
 * git commits and summarize what changed" runs its tool successfully,
 * the run reaches a terminal ✓ Complete state, but the model's actual
 * summary text never renders in the chat transcript.
 *
 * Root cause: local/weaker models sometimes deliver their real final
 * answer as prose in the SAME turn as a reflexive re-call of a tool they
 * already have evidence from (e.g. "double-checking" project.log again
 * right after already summarizing its result). Before this fix, ANY
 * parsed tool call in a turn — including an exact repeat of an
 * already-succeeded call — caused the loop to dispatch it and `continue`
 * to the next round. A round that dispatches a tool call never returns
 * its content to the caller; the prose is pushed into the model's own
 * conversation history but is never surfaced as the loop's result. If a
 * later round doesn't repeat that prose verbatim (the common case — the
 * model considers the question already answered), the user never sees
 * it, even though the run legitimately completes.
 *
 * The fix (filterRedundantToolCalls) drops tool calls that exactly
 * repeat an already-successful {toolId, inputs} pair before deciding
 * whether the turn is "still calling a tool". A turn whose only tool
 * call is redundant is treated as a final answer instead — so the prose
 * survives.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop, filterRedundantToolCalls } from "../agent-loop.js";
import { ToolRegistry } from "../tools.js";
import type {
  ToolResult,
  ModelProvider,
  ChatMessage,
  ModelStreamEvent,
  ModelResult,
  ToolDefinition,
  ToolMetadata,
} from "../types.js";
import type { AgentToolCallRecord, ParsedToolCall } from "../agent-loop.js";

// ─── Mock helpers (mirrors multi-tool.test.ts) ──────────────────────

function makeTool(
  id: string,
  result: ToolResult,
): { definition: ToolDefinition; metadata: ToolMetadata; handler: () => Promise<ToolResult> } {
  return {
    definition: { id, name: id, description: `Mock tool ${id}`, inputSchema: {}, readOnly: true },
    metadata: { projectScoped: false, mutating: false, readOnly: true },
    handler: async () => result,
  };
}

function makeRegistry(
  tools: Array<{ definition: ToolDefinition; metadata: ToolMetadata; handler: () => Promise<ToolResult> }>,
): ToolRegistry {
  const reg = new ToolRegistry();
  for (const t of tools) reg.register({ definition: t.definition, handler: t.handler, metadata: t.metadata });
  return reg;
}

/** A model whose Nth call returns responses[N] (or the last one, repeated). */
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

// ─── Unit tests: filterRedundantToolCalls ───────────────────────────

describe("filterRedundantToolCalls", () => {
  const succeeded = (toolId: string, inputs: Record<string, unknown>): AgentToolCallRecord => ({
    toolCallId: "tc_1",
    toolId,
    toolName: toolId,
    inputs,
    result: { status: "success", success: true, message: "ok", data: {} },
    durationMs: 1,
  });

  it("drops a call that exactly repeats an already-successful call", () => {
    const calls: ParsedToolCall[] = [{ toolId: "project.log", inputs: { limit: 10 } }];
    const prior = [succeeded("project.log", { limit: 10 })];
    assert.deepEqual(filterRedundantToolCalls(calls, prior), []);
  });

  it("keeps a call with different inputs from the prior success", () => {
    const calls: ParsedToolCall[] = [{ toolId: "project.log", inputs: { limit: 20 } }];
    const prior = [succeeded("project.log", { limit: 10 })];
    assert.deepEqual(filterRedundantToolCalls(calls, prior), calls);
  });

  it("keeps a repeat of a call that previously FAILED (not evidence yet)", () => {
    const calls: ParsedToolCall[] = [{ toolId: "project.log", inputs: {} }];
    const prior: AgentToolCallRecord[] = [{
      toolCallId: "tc_1", toolId: "project.log", toolName: "project.log", inputs: {},
      result: { status: "failed", success: false, message: "boom", data: {} }, durationMs: 1,
    }];
    assert.deepEqual(filterRedundantToolCalls(calls, prior), calls);
  });

  it("keeps novel calls and drops only the redundant one in a mixed batch", () => {
    const calls: ParsedToolCall[] = [
      { toolId: "project.log", inputs: {} },
      { toolId: "project.branch", inputs: {} },
    ];
    const prior = [succeeded("project.log", {})];
    assert.deepEqual(filterRedundantToolCalls(calls, prior), [{ toolId: "project.branch", inputs: {} }]);
  });
});

// ─── Integration: runAgentLoop must not swallow prose ───────────────

describe("runAgentLoop — prose attached to a redundant tool call is not swallowed", () => {
  it("returns the model's real answer instead of re-dispatching an already-proven tool call", async () => {
    const logTool = makeTool("project.log", {
      status: "success",
      success: true,
      message: "3 commits",
      data: { commits: ["c3: fix bug", "c2: add feature", "c1: init"] },
    });
    const registry = makeRegistry([logTool]);

    // Round 1: the model calls project.log (real evidence gathering).
    const round1 = '```tool_call\n{ "tool": "project.log", "inputs": {} }\n```';

    // Round 2: the model writes its REAL final answer as prose, but also
    // reflexively re-calls the exact same tool it already has evidence
    // from ("just double-checking"). Before the fix, this made the loop
    // treat the turn as "still calling a tool", dispatch the redundant
    // call, and discard this prose — the user would never see it.
    const finalSummary = "Here are the last 3 commits: c3 fixed a bug, c2 added a feature, c1 was the initial commit.";
    const round2 = `${finalSummary}\n\`\`\`tool_call\n{ "tool": "project.log", "inputs": {} }\n\`\`\``;

    const model = mockModelMultiRound([round1, round2]);

    const result = await runAgentLoop(
      "Show me the last 3 git commits and summarize what changed.",
      { model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 5 },
    );

    // The real answer must be the content the caller/UI receives.
    assert.equal(result.content, finalSummary);
    assert.equal(result.termination, "complete");
    // project.log ran exactly once — the redundant re-call was dropped,
    // not silently executed a second time.
    assert.equal(result.toolCalls.length, 1);
  });
});
