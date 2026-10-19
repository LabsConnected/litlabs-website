/**
 * Local Ollama thinking control.
 *
 * Measured 2026-10-18 on Ollama 0.40.6, GTX 1050 3 GB, qwen3:1.7b, same
 * prompt via /v1/chat/completions:
 *   default (thinking on)      35.4 s, 389–512 completion tokens, and one
 *                              run spent all 512 tokens reasoning and
 *                              returned EMPTY content
 *   reasoning_effort: "none"    2.6 s, 33 tokens, 0 reasoning
 * Non-thinking models (litt-coder:3b) accept the field; tool calls still work.
 *
 * LiTT sent no thinking control, so the operator's FAST local model thought
 * before every reply. Ollama requests now send reasoning_effort "none"
 * unless LITT_OLLAMA_THINK=1 opts back in. Other providers are unchanged.
 */

import { describe, it, expect, afterEach } from "vitest";
import { OpenAICompatibleModelProvider } from "../lib/model-provider.js";

const originalFetch = globalThis.fetch;
const originalThink = process.env.LITT_OLLAMA_THINK;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalThink === undefined) delete process.env.LITT_OLLAMA_THINK;
  else process.env.LITT_OLLAMA_THINK = originalThink;
});

function recordBody(): { body: Record<string, unknown> | null } {
  const recorded: { body: Record<string, unknown> | null } = { body: null };
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    recorded.body = JSON.parse(String(init?.body ?? "{}"));
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); c.close(); },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  return recorded;
}

function ollama(): OpenAICompatibleModelProvider {
  return new OpenAICompatibleModelProvider({
    providerId: "ollama",
    endpoint: "http://127.0.0.1:11435/v1/chat/completions",
    credentialless: true,
    model: "qwen3:1.7b",
  });
}

describe("Ollama thinking control", () => {
  it("disables thinking by default for local Ollama", async () => {
    delete process.env.LITT_OLLAMA_THINK;
    const recorded = recordBody();
    await ollama().stream([{ role: "user", content: "hi" }], () => {});
    expect(recorded.body?.reasoning_effort).toBe("none");
  });

  it("LITT_OLLAMA_THINK=1 leaves the model's thinking on", async () => {
    process.env.LITT_OLLAMA_THINK = "1";
    const recorded = recordBody();
    await ollama().stream([{ role: "user", content: "hi" }], () => {});
    expect(recorded.body).not.toHaveProperty("reasoning_effort");
  });

  it("does not add reasoning_effort for other OpenAI-compatible providers without tools", async () => {
    delete process.env.LITT_OLLAMA_THINK;
    const recorded = recordBody();
    const provider = new OpenAICompatibleModelProvider({
      providerId: "deepseek",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      apiKey: "sk-test",
      model: "deepseek-chat",
    });
    await provider.stream([{ role: "user", content: "hi" }], () => {});
    expect(recorded.body).not.toHaveProperty("reasoning_effort");
  });
});
