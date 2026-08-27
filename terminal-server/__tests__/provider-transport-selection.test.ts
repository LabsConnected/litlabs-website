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
 *
 * Failover policy tests:
 *   L. OpenAI 401 (invalid key) → NO failover, config error
 *   M. OpenAI 429 (insufficient quota) → free failover to OpenRouter
 *   N. OpenAI 402 (credit balance) → free failover to OpenRouter
 *   O. First free model 429 → next free model tried
 *   P. All free models fail → one clean user-facing error
 *   Q. Manually selected free model → direct OpenRouter, no OpenAI attempt
 *   R. /model lists only genuinely routable models (free always routable)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { streamModelForRemoteClient, _clearFreeModelCooldown } from "../litt-code.js";

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
  // Clear the free-model cooldown between tests so they don't interfere
  _clearFreeModelCooldown();
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

  it("L: OpenAI 401 (invalid key) → NO failover, surfaced as configuration error", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-invalid-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    // OpenAI returns 401
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" },
      }), { status: 401, headers: { "Content-Type": "application/json" } }),
    );

    const events: Array<{ type: string; provider?: string; model?: string }> = [];
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
    ).rejects.toThrow(/invalid or revoked/i);

    // Must NOT have called OpenRouter — 401 is a config error, not billing
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toBe("https://api.openai.com/v1/chat/completions");

    // No openrouter meta event should have been emitted
    const orMeta = events.find((e) => e.type === "meta" && e.provider === "openrouter");
    expect(orMeta).toBeUndefined();
  });

  it("M: OpenAI 429 (insufficient quota) → free failover to OpenRouter", async () => {
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

    // First free model succeeds
    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "OK", model: "minimax/minimax-m3:free", usage: { total_tokens: 5 } },
    ]));

    const events: Array<{ type: string; provider?: string; model?: string }> = [];
    const result = await streamModelForRemoteClient(
      messages,
      tools,
      (e) => events.push(e),
      {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna",
      },
    );

    // Must have called OpenAI first, then OpenRouter
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetchMock.mock.calls[1][0]).toBe("https://openrouter.ai/api/v1/chat/completions");

    // Result must report openrouter as the actual provider
    expect(result.provider).toBe("openrouter");

    // A meta event must have been emitted with provider: "openrouter"
    const orMeta = events.find((e) => e.type === "meta" && e.provider === "openrouter");
    expect(orMeta).toBeDefined();
    expect(orMeta?.model).toContain(":free");
  });

  it("M2: OpenAI 429 transient rate-limit → retry OpenAI once, then free fallback if still blocked", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-real-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    // First OpenAI call: 429 rate-limit (transient, NOT insufficient quota)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: {
          message: "Rate limit reached. Please retry after a moment.",
          type: "rate_limit_exceeded",
          code: "rate_limit",
        },
      }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "1" } }),
    );

    // Second OpenAI call (retry after backoff): still 429 rate-limited
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: {
          message: "Still rate limited.",
          type: "rate_limit_exceeded",
          code: "rate_limit",
        },
      }), { status: 429, headers: { "Content-Type": "application/json" } }),
    );

    // Free model succeeds
    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "OK", model: "minimax/minimax-m3:free", usage: { total_tokens: 5 } },
    ]));

    const events: Array<{ type: string; provider?: string }> = [];
    const result = await streamModelForRemoteClient(
      messages,
      tools,
      (e) => events.push(e),
      {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna",
      },
    );

    // 3 calls: OpenAI (429) → OpenAI retry (429) → OpenRouter (success)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetchMock.mock.calls[2][0]).toBe("https://openrouter.ai/api/v1/chat/completions");

    expect(result.provider).toBe("openrouter");
  });

  it("M3: OpenAI 429 transient rate-limit → retry succeeds, no free fallback needed", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-real-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    // First OpenAI call: 429 rate-limit (transient)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: {
          message: "Rate limit reached. Please retry.",
          type: "rate_limit_exceeded",
          code: "rate_limit",
        },
      }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "1" } }),
    );

    // Second OpenAI call (retry): succeeds!
    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "OK from OpenAI", model: "gpt-5.6-luna", usage: { total_tokens: 5 } },
    ]));

    const events: Array<{ type: string; provider?: string }> = [];
    const result = await streamModelForRemoteClient(
      messages,
      tools,
      (e) => events.push(e),
      {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna",
      },
    );

    // Only 2 calls: OpenAI (429) → OpenAI retry (success). No OpenRouter.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.openai.com/v1/chat/completions");

    // Provider must be openai — the retry succeeded
    expect(result.provider).toBe("openai");

    // No openrouter meta event
    const orMeta = events.find((e) => e.type === "meta" && e.provider === "openrouter");
    expect(orMeta).toBeUndefined();
  });

  it("N: OpenAI 402 (credit balance) → free failover to OpenRouter", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-real-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    // OpenAI returns 402
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: { message: "Credit balance exhausted", code: "credit_balance_exhausted" },
      }), { status: 402, headers: { "Content-Type": "application/json" } }),
    );

    // First free model succeeds
    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "OK", model: "z-ai/glm-5.2:free", usage: { total_tokens: 5 } },
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetchMock.mock.calls[1][0]).toBe("https://openrouter.ai/api/v1/chat/completions");

    const orMeta = events.find((e) => e.type === "meta" && e.provider === "openrouter");
    expect(orMeta).toBeDefined();
  });

  it("O: first free model 429 (rate-limited) → next free model tried", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-real-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    // OpenAI returns 429
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: { message: "No credits", code: "insufficient_quota" },
      }), { status: 429, headers: { "Content-Type": "application/json" } }),
    );

    // First free model (minimax) returns 429 rate-limited
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: { message: "rate-limited upstream", code: 429 },
      }), { status: 429, headers: { "Content-Type": "application/json" } }),
    );

    // Second free model (glm-5.2) succeeds
    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "OK", model: "z-ai/glm-5.2:free", usage: { total_tokens: 5 } },
    ]));

    const events: Array<{ type: string; provider?: string; model?: string }> = [];
    const result = await streamModelForRemoteClient(
      messages,
      tools,
      (e) => events.push(e),
      {
        model: "gpt-5.6-luna",
        providerHint: "openai",
        openRouterModelId: "openai/gpt-5.6-luna",
      },
    );

    // 3 calls: OpenAI + minimax (failed) + glm-5.2 (success)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetchMock.mock.calls[1][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(fetchMock.mock.calls[2][0]).toBe("https://openrouter.ai/api/v1/chat/completions");

    // Result must be from the second free model
    expect(result.provider).toBe("openrouter");
    expect(result.model).toContain("glm-5.2:free");
  });

  it("P: all free models fail → one clean user-facing error", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-real-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    // OpenAI returns 429
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: { message: "No credits", code: "insufficient_quota" },
      }), { status: 429, headers: { "Content-Type": "application/json" } }),
    );

    // All free models return 429 rate-limited
    // We need enough mocks for all 6 free models
    for (let i = 0; i < 6; i++) {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({
          error: { message: "rate-limited upstream", code: 429 },
        }), { status: 429, headers: { "Content-Type": "application/json" } }),
      );
    }

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
    ).rejects.toThrow(/rate-limited or unavailable/i);

    // 7 calls: 1 OpenAI + 6 free models
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("Q: manually selected free model (providerHint=openrouter) → direct OpenRouter, no OpenAI attempt", async () => {
    // When user manually selects a free model via /model, the CLI sends
    // providerHint: "openrouter" with the OpenRouter slug. The server
    // should go directly to OpenRouter without trying OpenAI first.
    process.env.OPENAI_API_KEY = "sk-proj-real-key";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fallback-key";

    fetchMock.mockResolvedValueOnce(sseResponse([
      { content: "OK from free model", model: "minimax/minimax-m3:free", usage: { total_tokens: 5 } },
    ]));

    const events: Array<{ type: string; provider?: string; model?: string }> = [];
    const result = await streamModelForRemoteClient(
      messages,
      tools,
      (e) => events.push(e),
      {
        model: "minimax/minimax-m3:free", // OpenRouter slug (has "/")
        providerHint: "openrouter",       // CLI routed to openrouter
        openRouterModelId: "minimax/minimax-m3:free",
      },
    );

    // Must call OpenRouter directly, NOT OpenAI
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(fetchMock.mock.calls[0][0]).not.toContain("api.openai.com");

    // Provider must be openrouter
    expect(result.provider).toBe("openrouter");
    const meta = events.find((e) => e.type === "meta");
    expect(meta?.provider).toBe("openrouter");
    expect(meta?.model).toBe("minimax/minimax-m3:free");
  });

  // Note: Test R (registry isRoutable for free models) lives in
  // tests/free-model-routable.test.ts — it needs @litt/models which
  // is not a dependency of terminal-server.
});
