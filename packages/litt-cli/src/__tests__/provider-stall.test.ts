/**
 * Provider transport stall watchdog — dogfood P0 regression.
 *
 * A silently-dropped SSE connection must not leave the run stuck in
 * "Working": the provider aborts after idleStallMs with no bytes and
 * the error flows to the run's terminal cleanup.
 */

import { describe, it, expect, afterEach } from "vitest";
import { OpenRouterModelProvider } from "../lib/model-provider.js";
import { runAgentLoop } from "@litt/agent-core";
import type { ModelStreamEvent } from "@litt/agent-core";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A fetch stub that hangs until the abort signal fires (like a dead
 *  SSE connection where the socket never closes). */
function hangingFetch(): typeof fetch {
  return ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
    })) as typeof fetch;
}

/** An SSE response stub that streams a few deltas then stalls forever.
 *  Mirrors real fetch: aborting the signal errors the body reader. */
function stalledSseFetch(): typeof fetch {
  return (async (_url: unknown, init?: { signal?: AbortSignal }) => {
    const encoder = new TextEncoder();
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"partial answer\"}}]}\n\n"));
        // Never send [DONE] — the connection goes silent. On abort,
        // error the reader exactly like a cancelled real fetch.
        signal?.addEventListener("abort", () =>
          controller.error(new DOMException("The operation was aborted.", "AbortError")),
        );
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
}

describe("OpenRouterModelProvider transport stall watchdog", () => {
  it("aborts a connection that never produces bytes (hanging fetch)", async () => {
    globalThis.fetch = hangingFetch();
    const provider = new OpenRouterModelProvider({
      apiKey: "sk-test",
      model: "openai/gpt-5.6-luna",
      idleStallMs: 150,
    });

    await expect(provider.stream([{ role: "user", content: "hi" }], () => {})).rejects.toThrow(/stalled/);
  }, 10_000);

  it("aborts a stream that produced output but never emits the final transport event", async () => {
    // Observed dogfood shape: useful text arrives, then the connection
    // dies without [DONE]. The run must reconcile, not spin forever.
    globalThis.fetch = stalledSseFetch();
    const provider = new OpenRouterModelProvider({
      apiKey: "sk-test",
      model: "openai/gpt-5.6-luna",
      idleStallMs: 150,
    });

    const deltas: string[] = [];
    await expect(
      provider.stream([{ role: "user", content: "hi" }], (e: ModelStreamEvent) => {
        if (e.type === "delta") deltas.push(e.text);
      }),
    ).rejects.toThrow(/stalled/);

    // The useful output was surfaced before the stall was detected.
    expect(deltas.join("")).toContain("partial answer");
  }, 10_000);

  it("does not stall a healthy stream that completes normally", async () => {
    globalThis.fetch = (async () => {
      const encoder = new TextEncoder();
      const chunks = [
        "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n",
        "data: [DONE]\n\n",
      ];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;

    const provider = new OpenRouterModelProvider({
      apiKey: "sk-test",
      model: "openai/gpt-5.6-luna",
      idleStallMs: 5000,
    });
    const result = await provider.stream([{ role: "user", content: "hi" }], () => {});
    expect(result.content).toBe("hello world");
  }, 10_000);
});

describe("run reconciliation — a stalled provider surfaces as a terminal error", () => {
  it("runAgentLoop terminates with 'error' when the provider stream rejects (stall)", async () => {
    // The controller's finally-style cleanup fires on this rejection:
    // the run can never stay visually Working.
    globalThis.fetch = hangingFetch();
    const provider = new OpenRouterModelProvider({
      apiKey: "sk-test",
      model: "openai/gpt-5.6-luna",
      idleStallMs: 120,
    });

    // Minimal loop with no tools/gateway — the model error path returns
    // termination "error" (mirrors controller.ts's CHAT path catch).
    const result = await runAgentLoop("hello", {
      model: provider,
      tools: { list: () => [], get: () => null, execute: async () => ({ status: "failed" as const, success: false, message: "n/a", data: {} }) } as never,
      shell: {} as never,
      cwd: process.cwd(),
      maxRounds: 1,
    });
    expect(result.termination).toBe("error");
    expect(result.content).toMatch(/stalled/);
  }, 10_000);
});
