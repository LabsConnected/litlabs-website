/**
 * Chat-run guardrails — regression coverage for the observed failure:
 * an informational question entered a multi-round agent loop and kept
 * executing tools for over a minute, and ESC did not reliably stop it.
 *
 * The controller now wires, for EVERY CHAT/MISSION agent-loop call:
 *   - abortSignal  → ESC / Ctrl+C / watchdog cancel the in-flight model
 *                    round itself (a LOCAL Ollama stream included), not
 *                    just spawned processes — verified here mid-stream
 *   - totalTimeoutMs → the loop's own deadline matches the watchdog's
 *                      LITT_MAX_RUN_MS ceiling
 *   - maxRounds    → the tool-call budget: a model that always emits a
 *                    tool call is hard-stopped at the budget, never
 *                    allowed to run an unbounded tool spree
 *
 * These tests exercise the REAL runAgentLoop from @litt/agent-core —
 * the same function the cockpit calls — with stub providers, so they
 * lock the contract the controller relies on rather than re-testing
 * React wiring.
 */

import { describe, it, expect } from "vitest";
import {
  runAgentLoop,
  createDefaultRegistry,
  type ChatMessage,
  type ModelProvider,
  type ModelResult,
  type ModelStreamEvent,
} from "@litt/agent-core";

/** A model whose stream never settles until the abort signal fires —
 *  the shape of a stuck/slow LOCAL Ollama round. */
function makeHangingModel(): ModelProvider {
  return {
    async stream(
      _messages: ChatMessage[],
      _emit: (event: ModelStreamEvent) => void,
      abortSignal?: AbortSignal,
    ): Promise<ModelResult> {
      return new Promise<ModelResult>((_resolve, reject) => {
        const onAbort = () => reject(new Error("aborted"));
        if (abortSignal?.aborted) return onAbort();
        abortSignal?.addEventListener("abort", onAbort, { once: true });
      });
    },
    async health() {
      return 100;
    },
  };
}

/** A model that ALWAYS responds with a tool call — the pathological
 *  behavior the budget exists to bound. */
function makeToolCallOnlyModel(toolId: string): { model: ModelProvider; calls: () => number } {
  let calls = 0;
  const body = `\`\`\`tool_call\n{ "tool": "${toolId}", "inputs": {} }\n\`\`\``;
  return {
    calls: () => calls,
    model: {
      async stream(
        _messages: ChatMessage[],
        emit: (event: ModelStreamEvent) => void,
      ): Promise<ModelResult> {
        calls++;
        emit({ type: "delta", text: body });
        return {
          content: body,
          model: "stub",
          provider: "stub",
          usage: { total_tokens: 1 },
          timing: { ttftMs: 0, generationMs: 0, totalMs: 0 },
          profile: "fast" as const,
        };
      },
      async health() {
        return 100;
      },
    },
  };
}

/** A shell stub — no real subprocesses in unit tests. */
const stubShell = {
  cwd: process.cwd(),
  async execute() {
    return {
      ok: true,
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      status: "success" as const,
      truncated: false,
      pid: 1,
    };
  },
};

describe("cancellation — abortSignal stops an in-flight model round", () => {
  it("aborting mid-stream terminates the loop as 'cancelled'", async () => {
    const controller = new AbortController();
    const tools = createDefaultRegistry();

    const promise = runAgentLoop("any question", {
      model: makeHangingModel(),
      tools,
      shell: stubShell as never,
      cwd: process.cwd(),
      maxRounds: 4,
      abortSignal: controller.signal,
    });

    // ESC/Ctrl+C/watchdog → controller.cancelActiveRun() → runAbort.abort()
    setTimeout(() => controller.abort(), 25);

    const result = await promise;
    expect(result.termination).toBe("cancelled");
    expect(result.content).toContain("cancelled");
  });

  it("a run without abortSignal still completes (contract preserved)", async () => {
    const tools = createDefaultRegistry();
    let streamed = false;
    const quickModel: ModelProvider = {
      async stream(_m, emit) {
        streamed = true;
        emit({ type: "delta", text: "hello" });
        return {
          content: "hello",
          model: "stub",
          provider: "stub",
          usage: { total_tokens: 1 },
          timing: { ttftMs: 0, generationMs: 0, totalMs: 0 },
          profile: "fast" as const,
        };
      },
      async health() {
        return 100;
      },
    };
    const result = await runAgentLoop("say hi", {
      model: quickModel,
      tools,
      shell: stubShell as never,
      cwd: process.cwd(),
      maxRounds: 4,
    });
    expect(streamed).toBe(true);
    expect(result.termination).toBe("complete");
    expect(result.content).toBe("hello");
  });
});

describe("tool-call budget — maxRounds bounds a tool-call spree", () => {
  it("a model that always emits a tool call is stopped at the chat budget", async () => {
    // The CHAT path runs maxRounds: 4. A weak model that never answers
    // must be hard-stopped — not allowed to run tools for a minute.
    const { model, calls } = makeToolCallOnlyModel("project.status");
    const tools = createDefaultRegistry();

    const result = await runAgentLoop("what tools do you have?", {
      model,
      tools,
      shell: stubShell as never,
      cwd: process.cwd(),
      maxRounds: 4,
    });

    expect(calls()).toBeLessThanOrEqual(4);
    expect(result.rounds).toBeLessThanOrEqual(4);
    expect(["max_rounds", "verification_failed", "failed"]).toContain(result.termination);
    expect(result.termination).not.toBe("complete");
  });
});

describe("execution deadline — totalTimeoutMs bounds the whole run", () => {
  it("a hanging model round is ended by the total deadline", async () => {
    const tools = createDefaultRegistry();
    const result = await runAgentLoop("any question", {
      model: makeHangingModel(),
      tools,
      shell: stubShell as never,
      cwd: process.cwd(),
      maxRounds: 10,
      totalTimeoutMs: 200,
    });
    expect(result.termination).toBe("error");
    expect(result.content).toContain("timed out");
    expect(result.durationMs).toBeLessThan(10_000);
  });
});
