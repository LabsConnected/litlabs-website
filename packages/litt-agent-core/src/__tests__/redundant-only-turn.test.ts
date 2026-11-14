/**
 * Regression test for the "bare repeat of an already-successful tool
 * call" loop.
 *
 * filterRedundantToolCalls drops repeats of succeeded calls so a turn
 * that pairs prose with a reflexive re-call still surfaces the prose.
 * But a turn whose ENTIRE output is a verbatim repeat of the most recent
 * successful call (no prose, no novel call) used to fall back to
 * re-dispatching the identical call — a deterministic repeat that cannot
 * produce new evidence. On weak local models this repeated every round
 * until maxRounds, burning a full model inference per dead repeat.
 *
 * The bounded-nudge path feeds a synthesis instruction back instead of
 * re-executing, and after MAX_REDUNDANT_ONLY_RETRIES dead-repeat turns
 * the run terminates truthfully. A repeat of an OLDER success (other
 * calls ran since — e.g. an edit) still re-dispatches, because project
 * state may have changed and fresh evidence is legitimate.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "../agent-loop.js";
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

// ─── Mock helpers (mirrors redundant-tool-call.test.ts) ─────────────

function makeTool(
  id: string,
  result: ToolResult,
): { definition: ToolDefinition; metadata: ToolMetadata; handler: () => Promise<ToolResult>; readonly calls: number } {
  const counter = { n: 0 };
  return {
    definition: { id, name: id, description: `Mock tool ${id}`, inputSchema: {}, readOnly: true },
    metadata: { projectScoped: false, mutating: false, readOnly: true },
    handler: async () => { counter.n++; return result; },
    get calls() { return counter.n; },
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

const CALL_STATUS = '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```';
const CALL_DIFF = '```tool_call\n{ "tool": "project.diff", "inputs": {} }\n```';

// ─── Bare repeat of the most recent success ──────────────────────────

describe("runAgentLoop — redundant-only turns", () => {
  it("nudges instead of re-dispatching a verbatim repeat of the latest success, then completes", async () => {
    const statusTool = makeTool("project.status", {
      status: "success", success: true, message: "clean", data: {},
    });
    const registry = makeRegistry([statusTool]);

    // Round 1: real evidence call. Round 2: ONLY the same call again,
    // no prose — the dead-repeat case. Round 3: the nudge worked and
    // the model answers.
    const model = mockModelMultiRound([
      CALL_STATUS,
      CALL_STATUS,
      "Working tree is clean — nothing to commit.",
    ]);

    const result = await runAgentLoop(
      "Check the project status.",
      { model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 6 },
    );

    assert.equal(result.termination, "complete");
    assert.equal(result.content, "Working tree is clean — nothing to commit.");
    // The tool ran exactly once: the bare repeat was nudged, not executed.
    assert.equal(result.toolCalls.length, 1);
    assert.equal(statusTool.calls, 1);
  });

  it("terminates truthfully when the model never synthesizes past MAX_REDUNDANT_ONLY_RETRIES", async () => {
    const statusTool = makeTool("project.status", {
      status: "success", success: true, message: "clean", data: {},
    });
    const registry = makeRegistry([statusTool]);

    // Model emits ONLY the same call every round — the pathological case.
    const model = mockModelMultiRound([CALL_STATUS]);

    const result = await runAgentLoop(
      "Check the project status.",
      { model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 10 },
    );

    assert.equal(result.termination, "error");
    assert.match(result.content, /repeated an already-successful tool call/);
    assert.match(result.content, /NOT completed/i);
    // Still exactly one real execution — dead repeats never dispatched.
    assert.equal(result.toolCalls.length, 1);
    assert.equal(statusTool.calls, 1);
    // Rounds: 1 real call + 2 nudged repeats + 1 terminating repeat = 4.
    assert.equal(result.rounds, 4);
  });

  it("re-dispatches a repeat of an OLDER success when other calls ran since (fresh evidence)", async () => {
    const statusTool = makeTool("project.status", {
      status: "success", success: true, message: "clean", data: {},
    });
    const diffTool = makeTool("project.diff", {
      status: "success", success: true, message: "diff output", data: {},
    });
    const registry = makeRegistry([statusTool, diffTool]);

    // status → diff → status again (repeat, but diff ran in between —
    // state may have changed) → final answer.
    const model = mockModelMultiRound([
      CALL_STATUS,
      CALL_DIFF,
      CALL_STATUS,
      "Diff applied and status is still clean.",
    ]);

    const result = await runAgentLoop(
      "Check status, diff, then re-check status.",
      { model, tools: registry, shell: null as unknown as any, cwd: process.cwd(), maxRounds: 6 },
    );

    assert.equal(result.termination, "complete");
    assert.equal(result.content, "Diff applied and status is still clean.");
    // status ran twice — the intervening diff makes the re-check real.
    assert.equal(statusTool.calls, 2);
    assert.equal(diffTool.calls, 1);
    assert.equal(result.toolCalls.length, 3);
  });
});
