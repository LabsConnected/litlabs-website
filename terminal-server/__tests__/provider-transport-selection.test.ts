/**
 * Regression tests for server-side provider transport selection.
 *
 * These tests prove that:
 *   1. OpenAI selection invokes the direct OpenAI transport (api.openai.com)
 *   2. OpenRouter selection invokes the OpenRouter transport (openrouter.ai)
 *   3. OpenAI credential absence falls back to OpenRouter (visibly reported)
 *   4. OpenRouter fallback is reported as "openrouter", not "openai"
 *   5. Response metadata cannot claim direct OpenAI when route is OpenRouter
 *   6. An OpenRouter key in OPENAI_API_KEY slot is detected and rejected
 *   7. ":nitro" never appears on a direct OpenAI route
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { streamModelForRemoteClient } from "../litt-code.js";

// ─── Mock setup ───────────────────────────────────────────────────
//
// We mock globalThis.fetch to inspect which endpoint is called and
// control the streaming response. This lets us verify transport
// selection without real API keys or network access.

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  // Clean all provider keys between tests
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

// Helper: build a streaming SSE response with a single text delta
function sseResponse(chunks: Array<{ content?: string; tool_calls?: unknown[]; model?: string; usage?: Record<string, number> }>): Response {
  const lines = chunks.map((c) => `data: ${JSON.stringify({
    model: c.model ?? "test-model",
    choices: [{
      delta: {
        content: c.content,
        tool_calls: c.tool_calls,
      },
      finish_reason: null,
    }],
    usage: c.usage,
  })}`).join("\n\n");
  const body = `${lines}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const messages = [{ role: "user" as const, content: "Hello" }];
const tools: never[] = [];

describe("Provider transport selection", () => {
  it("A: OpenAI selection with real OpenAI key → calls api.openai.com, not openrouter.ai", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-real-openai-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "Hello from OpenAI", model: "gpt-5.6-luna", usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 } },
    ]));

    const events: Array<{ type: string; provider?: string; model?: string }> = [];
    await streamModelForRemoteClient(
      messages,
      tools,
      (e) => events.push(e),
      {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna",
      },
    );

    // Must call api.openai.com
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(callUrl).not.toContain("openrouter.ai");

    // Must use the OpenAI key, not the OpenRouter key
    const callHeaders = fetchMock.mock.calls[0][1]?.headers;
    expect(callHeaders?.Authorization).toBe("Bearer sk-proj-real-openai-key");

    // meta event must report provider: "openai"
    const meta = events.find((e) => e.type === "meta");
    expect(meta?.provider).toBe("openai");
    expect(meta?.model).toBe("gpt-5.6-luna");
  });

  it("B: OpenRouter selection → calls openrouter.ai, not api.openai.com", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test-key";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "Hello from OpenRouter", model: "openai/gpt-5.6-luna", usage: { total_tokens: 10 } },
    ]));

    const events: Array<{ type: string; provider?: string }> = [];
    await streamModelForRemoteClient(
      messages,
      tools,
      (e) => events.push(e),
      {
        model: "openai/gpt-5.6-luna",
        providerHint: "openrouter",
        openRouterModelId: "openai/gpt-5.6-luna",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(callUrl).not.toContain("api.openai.com");

    const meta = events.find((e) => e.type === "meta");
    expect(meta?.provider).toBe("openrouter");
  });

  it("C: OpenAI hint but no OPENAI_API_KEY → falls back to OpenRouter, reported as openrouter", async () => {
    // No OPENAI_API_KEY, only OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "Fallback response", model: "openai/gpt-5.6-luna", usage: { total_tokens: 10 } },
    ]));

    const events: Array<{ type: string; provider?: string }> = [];
    await streamModelForRemoteClient(
      messages,
      tools,
      (e) => events.push(e),
      {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna",
      },
    );

    // Must fall back to OpenRouter
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toBe("https://openrouter.ai/api/v1/chat/completions");

    // meta must report "openrouter", NOT "openai" — the fallback is visible
    const meta = events.find((e) => e.type === "meta");
    expect(meta?.provider).toBe("openrouter");
    expect(meta?.provider).not.toBe("openai");
  });

  it("D: OpenRouter fallback cannot claim direct OpenAI in metadata", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "Response", model: "openai/gpt-5.6-luna", usage: { total_tokens: 5 } },
    ]));

    const events: Array<{ type: string; provider?: string }> = [];
    const result = await streamModelForRemoteClient(
      messages,
      tools,
      (e) => events.push(e),
      {
        model: "gpt-5.6-luna",
        providerHint: "openai", // CLI wanted OpenAI
        openRouterModelId: "openai/gpt-5.6-luna",
      },
    );

    // The result provider must match the actual transport, not the hint
    expect(result.provider).toBe("openrouter");
    expect(result.provider).not.toBe("openai");

    const meta = events.find((e) => e.type === "meta");
    expect(meta?.provider).toBe("openrouter");
  });

  it("E: OpenRouter key in OPENAI_API_KEY slot → falls back to OpenRouter (not treated as direct OpenAI)", async () => {
    process.env.OPENAI_API_KEY = "sk-or-v1-misplaced-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-real-openrouter-key";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "Fallback", model: "openai/gpt-5.6-luna", usage: { total_tokens: 5 } },
    ]));

    const events: Array<{ type: string; provider?: string }> = [];
    await streamModelForRemoteClient(
      messages,
      tools,
      (e) => events.push(e),
      {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna",
      },
    );

    // Must NOT call api.openai.com with the misplaced OpenRouter key
    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(callUrl).not.toContain("api.openai.com");

    // Must report as OpenRouter, not OpenAI
    const meta = events.find((e) => e.type === "meta");
    expect(meta?.provider).toBe("openrouter");
  });

  it("F: direct OpenAI route uses provider-native model id, never :nitro", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-real-openai-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "Response", model: "gpt-5.6-luna", usage: { total_tokens: 5 } },
    ]));

    const events: Array<{ type: string; model?: string }> = [];
    await streamModelForRemoteClient(
      messages,
      tools,
      (e) => events.push(e),
      {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna:nitro",
      },
    );

    // The request body must use the native model id, not the OpenRouter slug
    const callBody = JSON.parse(fetchMock.mock.calls[0][1]?.body);
    expect(callBody.model).toBe("gpt-5.6-luna");
    expect(callBody.model).not.toContain(":nitro");
    expect(callBody.model).not.toContain("/");

    // The meta event must report the native model id
    const meta = events.find((e) => e.type === "meta");
    expect(meta?.model).toBe("gpt-5.6-luna");
    expect(meta?.model).not.toContain(":nitro");
  });

  it("G: no provider keys at all → throws clear error", async () => {
    await expect(
      streamModelForRemoteClient(
        messages,
        tools,
        () => {},
        {
          model: "gpt-5.6-luna",
          providerHint: "openai",
          openRouterModelId: "openai/gpt-5.6-luna",
        },
      ),
    ).rejects.toThrow(/OPENROUTER_API_KEY not configured/i);
  });

  it("G2: OpenRouter key in OPENAI slot but no OPENROUTER_API_KEY → throws clear error", async () => {
    process.env.OPENAI_API_KEY = "sk-or-v1-misplaced-key";
    // No OPENROUTER_API_KEY

    await expect(
      streamModelForRemoteClient(
        messages,
        tools,
        () => {},
        {
          model: "gpt-5.6-luna",
          providerHint: "openai",
          openRouterModelId: "openai/gpt-5.6-luna",
        },
      ),
    ).rejects.toThrow(/OpenRouter key|OPENROUTER_API_KEY not configured/i);
  });

  it("H: OpenAI hint with OpenRouter slug model (has /) → falls back to OpenRouter", async () => {
    // Edge case: CLI sends an OpenRouter slug as the model id even though
    // providerHint is "openai". This can happen for models that have no
    // providerModelId. Server should fall back to OpenRouter.
    process.env.OPENAI_API_KEY = "sk-proj-real-openai-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "Response", model: "anthropic/claude-sonnet-5", usage: { total_tokens: 5 } },
    ]));

    const events: Array<{ type: string; provider?: string }> = [];
    await streamModelForRemoteClient(
      messages,
      tools,
      (e) => events.push(e),
      {
        model: "anthropic/claude-sonnet-5", // OpenRouter slug, has "/"
        providerHint: "openai",
        openRouterModelId: "anthropic/claude-sonnet-5",
      },
    );

    // Must use OpenRouter because the model id contains "/" (OpenRouter slug)
    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toBe("https://openrouter.ai/api/v1/chat/completions");

    const meta = events.find((e) => e.type === "meta");
    expect(meta?.provider).toBe("openrouter");
  });
});
