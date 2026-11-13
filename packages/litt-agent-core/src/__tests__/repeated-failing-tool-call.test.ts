/**
 * Regression test for the "verbatim retry of a failing tool call" loop.
 *
 * Observed symptom (phone, weak local model litt-tools:4k): the model
 * hallucinated a `project.run` call, the call failed, and the loop fed
 * the failure back — but the model re-emitted the IDENTICAL call every
 * round. Nothing detected the verbatim repeat, so each round paid a full
 * model inference plus a doomed re-dispatch until the 120s total timeout
 * killed the run (174s wasted on `litt ask "Say hello in five words"`).
 *
 * filterRedundantToolCalls already covers exact repeats of SUCCESSFUL
 * calls; it deliberately keeps repeats of FAILED ones so the model can
 * retry. But a retry is only useful when the args change — a verbatim
 * re-issue of a deterministic failure cannot produce a different result.
 * The repeated-failure guard in the dispatch path terminates the run as
 * "error" the moment a parsed call exactly matches an already-failed
 * {toolId, inputs} signature in the toolCalls ledger.
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
  ToolHandler,
} from "../types.js";

// ─── Mock helpers (mirrors redundant-tool-call.test.ts) ─────────────

type InputsHandler = (inputs: Record<string, unknown>) => Promise<ToolResult>;

function makeTool(
  id: string,
  handler: InputsHandler,
  mutating = false,
): { definition: ToolDefinition; metadata: ToolMetadata; handler: ToolHandler } {
  return {
    definition: { id, name: id, description: `Mock tool ${id}`, inputSchema: {}, readOnly: !mutating },
    metadata: { projectScoped: false, mutating, readOnly: !mutating },
    handler: (_ctx, inputs) => handler(inputs),
  };
}

function makeRegistry(
  tools: Array<{ definition: ToolDefinition; metadata: ToolMetadata; handler: ToolHandler }>,
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

const toolCallBlock = (inputs: Record<string, unknown>): string =>
  '```tool_call\n' + JSON.stringify({ tool: "project.run", inputs }) + '\n```';

// ─── The regression ─────────────────────────────────────────────────

describe("runAgentLoop — repeated identical failing tool call", () => {
  it("terminates as error in ≤2 rounds instead of re-dispatching the verbatim retry", async () => {
    let executions = 0;
    const failingTool = makeTool("project.run", async () => {
      executions++;
      return { status: "failed", success: false, message: "exit 1: bogus command", data: {} };
    }, true);
    const registry = makeRegistry([failingTool]);

    // The model emits the SAME failing call every round — the exact
    // weak-model behavior that burned 174s on the phone.
    const failingCall = toolCallBlock({ command: "bogus" });
    const model = mockModelMultiRound([failingCall, failingCall, failingCall, failingCall]);

    const result = await runAgentLoop("run the thing", {
      model,
      tools: registry,
      shell: null as unknown as never,
      cwd: process.cwd(),
      maxRounds: 12,
      totalTimeoutMs: 120000,
    });

    assert.equal(result.termination, "error");
    assert.ok(result.rounds <= 2, `expected ≤2 rounds, got ${result.rounds}`);
    // The failed call ran exactly once — the verbatim repeat was never
    // dispatched again, let alone retried until the total timeout.
    assert.equal(executions, 1);
    assert.equal(result.toolCalls.length, 1);
    assert.match(result.content, /Repeated identical failing tool call: project\.run/);
    assert.match(result.content, /NOT completed/);
    assert.ok(result.durationMs < 120000, `expected to finish well under the timeout, took ${result.durationMs}ms`);
  });

  it("still executes a retry that carries DIFFERENT args after a first failure", async () => {
    const seen: string[] = [];
    const tool = makeTool("project.run", async (inputs) => {
      const command = String(inputs.command ?? "");
      seen.push(command);
      return command === "real"
        ? { status: "success", success: true, message: "ran ok", data: {} }
        : { status: "failed", success: false, message: "exit 1: bogus command", data: {} };
    }, true);
    const registry = makeRegistry([tool]);

    const model = mockModelMultiRound([
      toolCallBlock({ command: "bogus" }),
      toolCallBlock({ command: "real" }),
      "The first attempt failed but the corrected run succeeded.",
    ]);

    const result = await runAgentLoop("run the thing", {
      model,
      tools: registry,
      shell: null as unknown as never,
      cwd: process.cwd(),
      maxRounds: 12,
      totalTimeoutMs: 120000,
    });

    // A retry with different args is a real correction attempt — it
    // must dispatch and may succeed.
    assert.deepEqual(seen, ["bogus", "real"]);
    assert.equal(result.termination, "complete");
    assert.equal(result.toolCalls.length, 2);
  });

  it("does not misfire on a call that previously succeeded", async () => {
    let executions = 0;
    const tool = makeTool("project.log", async () => {
      executions++;
      return { status: "success", success: true, message: "ok", data: {} };
    });
    const registry = makeRegistry([tool]);

    const call = '```tool_call\n{ "tool": "project.log", "inputs": {} }\n```';
    const final = "Done — the earlier attempt did not fail.";
    const model = mockModelMultiRound([call, `${final}\n${call}`]);

    const result = await runAgentLoop("show the log", {
      model,
      tools: registry,
      shell: null as unknown as never,
      cwd: process.cwd(),
      maxRounds: 5,
    });

    // The repeat matched a SUCCESS, so filterRedundantToolCalls dropped
    // it and the attached prose survived as the final answer.
    assert.equal(result.termination, "complete");
    assert.equal(result.content, final);
    assert.equal(executions, 1);
  });
});
