/**
 * Regression tests for server-side provider transport selection.
 *
 * These tests prove that:
 *   1. OpenAI selection invokes the direct OpenAI transport (api.openai.com)
 *   2. OpenRouter selection invokes the OpenRouter transport (openrouter.ai)
 *   3. OpenAI credential absence is a CONFIGURATION ERROR, not a silent
 *      provider switch. Fallback requires LITT_ALLOW_OPENROUTER_FALLBACK=1.
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
  delete process.env.LITT_ALLOW_OPENROUTER_FALLBACK;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.LITT_ALLOW_OPENROUTER_FALLBACK;
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

  it("C: OpenAI hint + no OPENAI_API_KEY + fallback disabled → clear config error, NO provider switch", async () => {
    // Policy: a missing OpenAI credential is a configuration problem, not
    // an invitation to bill a different provider. Previously this fell
    // back to OpenRouter automatically; that behavior is now opt-in.
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    await expect(
      streamModelForRemoteClient(messages, tools, () => {}, {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna",
      }),
    ).rejects.toThrow(/OPENAI_API_KEY is not configured|Refusing to silently reroute/);

    // Nothing was sent anywhere — not to OpenAI, not to OpenRouter.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("C2: OpenAI hint + no OPENAI_API_KEY + fallback ENABLED → OpenRouter, reported as openrouter", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";
    process.env.LITT_ALLOW_OPENROUTER_FALLBACK = "1";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "Fallback response", model: "openai/gpt-5.6-luna", usage: { total_tokens: 10 } },
    ]));

    const events: Array<{ type: string; provider?: string }> = [];
    await streamModelForRemoteClient(messages, tools, (e) => events.push(e), {
      model: "gpt-5.6-luna",
      providerHint: "openai",
      openRouterModelId: "openai/gpt-5.6-luna",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    // The switch stays visible in metadata.
    const meta = events.find((e) => e.type === "meta");
    expect(meta?.provider).toBe("openrouter");
  });

  it("D: OpenRouter fallback cannot claim direct OpenAI in metadata", async () => {
    // Exercises the fallback path deliberately — opt in explicitly.
    process.env.LITT_ALLOW_OPENROUTER_FALLBACK = "1";
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
    // Exercises the fallback path deliberately — opt in explicitly.
    process.env.LITT_ALLOW_OPENROUTER_FALLBACK = "1";
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
      // With hint=openai the OpenAI configuration error now fires first
      // and names the actual problem, rather than reporting the absence
      // of the fallback provider the user never asked for.
    ).rejects.toThrow(/OPENAI_API_KEY is not configured/i);
  });

  it("G3: no provider keys at all + fallback ENABLED → reports the missing OpenRouter key", async () => {
    process.env.LITT_ALLOW_OPENROUTER_FALLBACK = "1";
    await expect(
      streamModelForRemoteClient(messages, tools, () => {}, {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna",
      }),
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
    // Exercises the fallback path deliberately — opt in explicitly.
    process.env.LITT_ALLOW_OPENROUTER_FALLBACK = "1";
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

  // ─── max_tokens regression tests ──────────────────────────────

  it("I: missing maxTokens → server defaults to 3000, never 65536", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-real-openai-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "OK", model: "gpt-5.6-luna", usage: { total_tokens: 5 } },
    ]));

    await streamModelForRemoteClient(
      messages,
      tools,
      () => {},
      {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna",
        // maxTokens intentionally omitted
      },
    );

    const callBody = JSON.parse(fetchMock.mock.calls[0][1]?.body);
    expect(callBody.max_tokens).toBe(3000);
    expect(callBody.max_tokens).not.toBe(65536);
  });

  it("J: explicit valid maxTokens is preserved (not overwritten by default)", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-real-openai-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "OK", model: "gpt-5.6-luna", usage: { total_tokens: 5 } },
    ]));

    await streamModelForRemoteClient(
      messages,
      tools,
      () => {},
      {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna",
        maxTokens: 256,
      },
    );

    const callBody = JSON.parse(fetchMock.mock.calls[0][1]?.body);
    expect(callBody.max_tokens).toBe(256);
    expect(callBody.max_tokens).not.toBe(3000);
    expect(callBody.max_tokens).not.toBe(65536);
  });

  it("K: missing maxTokens on OpenRouter fallback → defaults to 3000, never 65536", async () => {
    // Exercises the fallback path deliberately — opt in explicitly.
    process.env.LITT_ALLOW_OPENROUTER_FALLBACK = "1";
    // No OPENAI_API_KEY → falls back to OpenRouter
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "OK", model: "openai/gpt-5.6-luna", usage: { total_tokens: 5 } },
    ]));

    await streamModelForRemoteClient(
      messages,
      tools,
      () => {},
      {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna",
        // maxTokens intentionally omitted
      },
    );

    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toBe("https://openrouter.ai/api/v1/chat/completions");

    const callBody = JSON.parse(fetchMock.mock.calls[0][1]?.body);
    expect(callBody.max_tokens).toBe(3000);
    expect(callBody.max_tokens).not.toBe(65536);
  });

  // ─── Error surfacing tests ────────────────────────────────────

  it("L: OpenAI 401 error is surfaced as OpenAI error, not mislabeled as OpenRouter", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-invalid-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    // OpenAI returns 401
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" },
      }), { status: 401, headers: { "Content-Type": "application/json" } }),
    );

    const events: Array<{ type: string; provider?: string; message?: string }> = [];
    await expect(
      streamModelForRemoteClient(
        messages,
        tools,
        (e) => events.push(e),
        {
          model: "gpt-5.6-luna",
          providerHint: "openai",
          openRouterModelId: "openai/gpt-5.6-luna",
        },
      ),
    ).rejects.toThrow(/OpenAI API error 401/);

    // The error must mention OpenAI, not OpenRouter
    const errorEvents = events.filter((e) => e.type === "error");
    // streamModelForRemoteClient throws — no error event is emitted,
    // but the thrown error message must reference OpenAI, not OpenRouter
  });

  it("M: OpenAI 429 (insufficient quota) is surfaced as OpenAI error, not silently switched to OpenRouter", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-real-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    // OpenAI returns 429 — insufficient quota
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: {
          message: "You have no credits remaining.",
          type: "insufficient_quota",
          code: "credit_balance_exhausted",
        },
      }), { status: 429, headers: { "Content-Type": "application/json" } }),
    );

    // The server must NOT silently fall back to OpenRouter.
    // It must surface the OpenAI 429 error truthfully.
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
    ).rejects.toThrow(/OpenAI API error 429/);

    // Verify it only called OpenAI once — no OpenRouter fallback attempt
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("N: explicit OpenRouter selection is honored regardless of the fallback flag", async () => {
    // Choosing OpenRouter yourself is not a "fallback" — the opt-in gate
    // must never block it, in either flag state.
    for (const flag of [undefined, "1"]) {
      fetchMock.mockReset();
      process.env.OPENROUTER_API_KEY = "sk-or-v1-key";
      process.env.OPENAI_API_KEY = "sk-proj-real-openai-key";
      if (flag) process.env.LITT_ALLOW_OPENROUTER_FALLBACK = flag;
      else delete process.env.LITT_ALLOW_OPENROUTER_FALLBACK;

      fetchMock.mockResolvedValueOnce(sseResponse([
        { content: "ok", model: "anthropic/claude-sonnet-5", usage: { total_tokens: 3 } },
      ]));

      const events: Array<{ type: string; provider?: string }> = [];
      await streamModelForRemoteClient(messages, tools, (e) => events.push(e), {
        model: "anthropic/claude-sonnet-5",
        providerHint: "openrouter",
        openRouterModelId: "anthropic/claude-sonnet-5",
      });

      expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(events.find((e) => e.type === "meta")?.provider).toBe("openrouter");
    }
  });

  it("O: OpenAI hint + valid OpenAI key still goes direct with the fallback flag OFF", async () => {
    // The gate must not accidentally block the happy path it protects.
    process.env.OPENAI_API_KEY = "sk-proj-real-openai-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-key";
    delete process.env.LITT_ALLOW_OPENROUTER_FALLBACK;

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "direct", model: "gpt-5.6-luna", usage: { total_tokens: 4 } },
    ]));

    const events: Array<{ type: string; provider?: string }> = [];
    await streamModelForRemoteClient(messages, tools, (e) => events.push(e), {
      model: "gpt-5.6-luna",
      providerHint: "openai",
      openRouterModelId: "openai/gpt-5.6-luna",
    });

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(events.find((e) => e.type === "meta")?.provider).toBe("openai");
  });

  it("P: server clamps an absurd maxTokens instead of forwarding the model ceiling", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-real-openai-key";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "ok", model: "gpt-5.6-luna", usage: { total_tokens: 2 } },
    ]));

    await streamModelForRemoteClient(messages, tools, () => {}, {
      model: "gpt-5.6-luna",
      providerHint: "openai",
      openRouterModelId: "openai/gpt-5.6-luna",
      maxTokens: 65536,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.max_tokens).toBe(16384);
    expect(body.max_tokens).not.toBe(65536);
  });
});
