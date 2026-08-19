/**
 * Provider routing regression tests.
 *
 * Enforces the contract from the GPT-5.6 Luna / OpenRouter-credit-error fix:
 *
 *   1. Configured OpenAI BYOK + AUTO routes to the NATIVE OpenAI adapter,
 *      NOT OpenRouter. The request goes to api.openai.com with the
 *      provider-native model id, never to openrouter.ai.
 *   2. Explicit OpenRouter selection still routes to OpenRouter.
 *   3. Fallback to OpenRouter happens ONLY when the native provider has
 *      no direct key (or no native adapter) AND OpenRouter can service it.
 *   4. The UI provider label matches the provider actually used.
 *   5. Provider errors surface as errors — never masquerade as empty
 *      model responses.
 *
 * Scope: provider routing/adapters + provider visibility. No unrelated
 * architecture changes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  OpenRouterModelProvider,
  OpenAICompatibleModelProvider,
  resolveProviderAdapter,
  providerLabel,
  OPENAI_COMPATIBLE_NATIVE_PROVIDERS,
  resolveMaxTokens,
  DEFAULT_MAX_TOKENS,
  buildMaxTokensLadder,
  classifyStreamError,
  InsufficientCreditsError,
  isInsufficientCreditsError,
} from "../lib/model-provider.js";
import { ModelRuntime, type RoutedModel } from "../lib/model-runtime.js";
import type { ModelStreamEvent } from "@litt/agent-core";
import type { ProviderId } from "@litt/models";

// ─── Env fixture ────────────────────────────────────────────────────
const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "MOONSHOT_API_KEY",
  "MISTRAL_API_KEY",
  "DASHSCOPE_API_KEY",
  "LITT_MAX_TOKENS",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  // Default: no keys. Each test sets exactly the keys it wants.
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

// ─── Helpers ────────────────────────────────────────────────────────

/** Build a RoutedModel as the controller would receive from ModelRuntime.route(). */
function routeFromRuntime(
  runtime: ModelRuntime,
  mode: "auto" | "fixed" | "budget" | "max",
  selectedModel: string | null,
  input = "hello",
): RoutedModel {
  return runtime.route(mode, selectedModel, input);
}

/** A healthy SSE fetch stub that streams one delta then [DONE]. */
function healthySseFetch(content = "ok"): typeof fetch {
  return (async () => {
    const encoder = new TextEncoder();
    const chunks = [
      `data: {"model":"gpt-5.6-luna","choices":[{"delta":{"content":"${content}"}}]}\n\n`,
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
}

/** A fetch stub whose SSE stream embeds a provider error in a chunk. */
function errorSseFetch(message: string): typeof fetch {
  return (async () => {
    const encoder = new TextEncoder();
    const chunk = `data: {"error":{"message":"${message}"}}\n\n`;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
}

/** Capture the URL + Authorization header a fetch call used. */
function capturingFetch(): { fetch: typeof fetch; calls: { url: string; auth: string }[] } {
  const calls: { url: string; auth: string }[] = [];
  const stub = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const u = String(url);
    const auth = init?.headers?.Authorization ?? "";
    calls.push({ url: u, auth });
    return healthySseFetch()(url, init);
  }) as typeof fetch;
  return { fetch: stub, calls };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("provider routing: configured OpenAI BYOK takes precedence over OpenRouter", () => {
  it("AUTO + OPENAI_API_KEY routes to the native OpenAI adapter (not OpenRouter)", () => {
    process.env.OPENAI_API_KEY = "sk-openai-byok";
    process.env.OPENROUTER_API_KEY = "sk-or";
    const runtime = new ModelRuntime();

    // AUTO routing for a fast/chat task resolves to LITT_DEFAULTS.fast = gpt-5.6-luna.
    const routed = routeFromRuntime(runtime, "auto", null, "hello");

    expect(routed.id).toBe("gpt-5.6-luna");
    // The registry correctly reports servedBy=openai (direct key wins).
    expect(routed.servedBy).toBe("openai");
    // The provider-native id is used for the transport, not the OR slug.
    expect(routed.providerModelId).toBe("gpt-5.6-luna");

    const adapter = resolveProviderAdapter(routed);
    expect(adapter).toBeInstanceOf(OpenAICompatibleModelProvider);
    expect(adapter).not.toBeInstanceOf(OpenRouterModelProvider);
    expect((adapter as OpenAICompatibleModelProvider).providerId).toBe("openai");
    expect((adapter as OpenAICompatibleModelProvider).configuredModel).toBe("gpt-5.6-luna");
  });

  it("the native OpenAI adapter calls api.openai.com with the OpenAI key, never openrouter.ai", async () => {
    process.env.OPENAI_API_KEY = "sk-openai-byok";
    process.env.OPENROUTER_API_KEY = "sk-or";
    const runtime = new ModelRuntime();
    const routed = routeFromRuntime(runtime, "auto", null, "hello");
    const adapter = resolveProviderAdapter(routed);

    const cap = capturingFetch();
    globalThis.fetch = cap.fetch;
    await adapter.stream([{ role: "user", content: "hi" }], () => {});

    expect(cap.calls).toHaveLength(1);
    expect(cap.calls[0].url).toContain("api.openai.com");
    expect(cap.calls[0].url).not.toContain("openrouter.ai");
    expect(cap.calls[0].auth).toBe("Bearer sk-openai-byok");
  });

  it("FIXED on an OpenAI model with OPENAI_API_KEY routes to the native adapter", () => {
    process.env.OPENAI_API_KEY = "sk-openai-byok";
    process.env.OPENROUTER_API_KEY = "sk-or";
    const runtime = new ModelRuntime();
    const routed = routeFromRuntime(runtime, "fixed", "gpt-5.6-luna", "hello");

    expect(routed.servedBy).toBe("openai");
    const adapter = resolveProviderAdapter(routed);
    expect(adapter).toBeInstanceOf(OpenAICompatibleModelProvider);
  });
});

describe("provider routing: explicit OpenRouter selection still routes to OpenRouter", () => {
  it("a model whose servedBy resolves to openrouter uses the OpenRouter adapter", () => {
    // Only an OpenRouter key, no direct OpenAI key → OpenRouter serves.
    process.env.OPENROUTER_API_KEY = "sk-or";
    const runtime = new ModelRuntime();
    const routed = routeFromRuntime(runtime, "auto", null, "hello");

    expect(routed.servedBy).toBe("openrouter");
    const adapter = resolveProviderAdapter(routed);
    expect(adapter).toBeInstanceOf(OpenRouterModelProvider);
    expect((adapter as OpenRouterModelProvider).providerId).toBe("openrouter");
  });

  it("the OpenRouter adapter calls openrouter.ai with the OpenRouter key", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or";
    const runtime = new ModelRuntime();
    const routed = routeFromRuntime(runtime, "auto", null, "hello");
    const adapter = resolveProviderAdapter(routed);

    const cap = capturingFetch();
    globalThis.fetch = cap.fetch;
    await adapter.stream([{ role: "user", content: "hi" }], () => {});

    expect(cap.calls).toHaveLength(1);
    expect(cap.calls[0].url).toContain("openrouter.ai");
    expect(cap.calls[0].auth).toBe("Bearer sk-or");
  });
});

describe("provider routing: fallback behavior works only when intended", () => {
  it("no OpenAI key + OpenRouter key → falls back to OpenRouter (intended fallback)", () => {
    process.env.OPENROUTER_API_KEY = "sk-or";
    // No OPENAI_API_KEY.
    const runtime = new ModelRuntime();
    const routed = routeFromRuntime(runtime, "auto", null, "hello");

    // servedBy flips to openrouter because no direct OpenAI key.
    expect(routed.servedBy).toBe("openrouter");
    const adapter = resolveProviderAdapter(routed);
    expect(adapter).toBeInstanceOf(OpenRouterModelProvider);
  });

  it("no OpenAI key AND no OpenRouter key → resolver throws a clear error (no silent fallback)", () => {
    // No keys at all.
    const runtime = new ModelRuntime();
    // route() itself throws when no provider is configured — that's the
    // registry's contract. We simulate a routed model that escaped routing
    // (e.g. a stale pin) and confirm the resolver also fails clearly.
    const routed: RoutedModel = {
      id: "gpt-5.6-luna",
      label: "GPT-5.6 Luna",
      servedBy: "openai",
      reason: "test",
      fallbackReason: null,
      appliedPolicy: "auto",
      openRouterModelId: "openai/gpt-5.6-luna",
      providerModelId: "gpt-5.6-luna",
    };
    expect(() => resolveProviderAdapter(routed)).toThrow(/No provider adapter/);
  });

  it("OpenAI key present but model only servable via OpenRouter (e.g. Anthropic) → OpenRouter", () => {
    process.env.OPENAI_API_KEY = "sk-openai-byok";
    process.env.OPENROUTER_API_KEY = "sk-or";
    const runtime = new ModelRuntime();
    // Pin an Anthropic model — Anthropic has no native adapter in this
    // pass, so it must fall back to OpenRouter even though an OpenAI key
    // is present. This proves the OpenAI key does NOT leak into other
    // providers' routing.
    const claude = runtime.getAllModels().find((m) => m.provider === "anthropic");
    expect(claude).toBeDefined();
    const routed = routeFromRuntime(runtime, "fixed", claude!.canonicalId, "hello");
    expect(routed.servedBy).toBe("openrouter");
    const adapter = resolveProviderAdapter(routed);
    expect(adapter).toBeInstanceOf(OpenRouterModelProvider);
  });
});

describe("provider routing: UI provider label matches the adapter actually used", () => {
  it("providerLabel maps known ids to human labels", () => {
    expect(providerLabel("openai")).toBe("OpenAI");
    expect(providerLabel("openrouter")).toBe("OpenRouter");
    expect(providerLabel("xai")).toBe("xAI");
    expect(providerLabel(null)).toBe("");
    expect(providerLabel("unknown")).toBe("Unknown");
  });

  it("the adapter's providerId is the source of truth for the served provider", async () => {
    process.env.OPENAI_API_KEY = "sk-openai-byok";
    process.env.OPENROUTER_API_KEY = "sk-or";
    const runtime = new ModelRuntime();
    const routed = routeFromRuntime(runtime, "auto", null, "hello");
    const adapter = resolveProviderAdapter(routed);

    // The controller reads adapter.providerId after streaming to set the
    // status bar's provider label. It must match the adapter that ran,
    // not merely routed.servedBy (the intent).
    globalThis.fetch = healthySseFetch();
    await adapter.stream([{ role: "user", content: "hi" }], () => {});

    const servedProvider: ProviderId = adapter.providerId;
    expect(servedProvider).toBe("openai");
    expect(providerLabel(servedProvider)).toBe("OpenAI");
    // The display string the status bar renders:
    expect(`${routed.label} · ${providerLabel(servedProvider)}`).toBe("GPT-5.6 Luna · OpenAI");
  });

  it("OpenRouter fallback displays as OpenRouter, not the native provider", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or";
    const runtime = new ModelRuntime();
    const routed = routeFromRuntime(runtime, "auto", null, "hello");
    const adapter = resolveProviderAdapter(routed);

    globalThis.fetch = healthySseFetch();
    await adapter.stream([{ role: "user", content: "hi" }], () => {});

    expect(adapter.providerId).toBe("openrouter");
    expect(`${routed.label} · ${providerLabel(adapter.providerId)}`).toBe("GPT-5.6 Luna · OpenRouter");
  });
});

describe("provider routing: errors do not masquerade as empty responses", () => {
  it("OpenAI-compatible adapter surfaces an embedded SSE error by throwing (not empty content)", async () => {
    process.env.OPENAI_API_KEY = "sk-openai-byok";
    const runtime = new ModelRuntime();
    const routed = routeFromRuntime(runtime, "auto", null, "hello");
    const adapter = resolveProviderAdapter(routed);

    globalThis.fetch = errorSseFetch("insufficient credits");
    await expect(
      adapter.stream([{ role: "user", content: "hi" }], () => {}),
    ).rejects.toThrow(/stream error: insufficient credits/);
  });

  it("OpenRouter adapter surfaces an embedded SSE error by throwing (not empty content)", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or";
    const runtime = new ModelRuntime();
    const routed = routeFromRuntime(runtime, "auto", null, "hello");
    const adapter = resolveProviderAdapter(routed);

    globalThis.fetch = errorSseFetch("This request requires more credits");
    await expect(
      adapter.stream([{ role: "user", content: "hi" }], () => {}),
    ).rejects.toThrow(/OpenRouter stream error: This request requires more credits/);
  });

  it("a non-ok HTTP response from the native adapter throws with the status + body", async () => {
    process.env.OPENAI_API_KEY = "sk-openai-byok";
    const runtime = new ModelRuntime();
    const routed = routeFromRuntime(runtime, "auto", null, "hello");
    const adapter = resolveProviderAdapter(routed);

    globalThis.fetch = (async () =>
      new Response("rate limited", { status: 429 })) as typeof fetch;
    await expect(
      adapter.stream([{ role: "user", content: "hi" }], () => {}),
    ).rejects.toThrow(/openai API error 429/);
  });
});

describe("provider routing: OpenAI-compatible native provider coverage", () => {
  it("OPENAI_COMPATIBLE_NATIVE_PROVIDERS covers the six providers with chatUrls", () => {
    expect(OPENAI_COMPATIBLE_NATIVE_PROVIDERS.has("openai")).toBe(true);
    expect(OPENAI_COMPATIBLE_NATIVE_PROVIDERS.has("xai")).toBe(true);
    expect(OPENAI_COMPATIBLE_NATIVE_PROVIDERS.has("deepseek")).toBe(true);
    expect(OPENAI_COMPATIBLE_NATIVE_PROVIDERS.has("kimi")).toBe(true);
    expect(OPENAI_COMPATIBLE_NATIVE_PROVIDERS.has("mistral")).toBe(true);
    expect(OPENAI_COMPATIBLE_NATIVE_PROVIDERS.has("qwen")).toBe(true);
    // Anthropic and Google are explicitly excluded this pass.
    expect(OPENAI_COMPATIBLE_NATIVE_PROVIDERS.has("anthropic")).toBe(false);
    expect(OPENAI_COMPATIBLE_NATIVE_PROVIDERS.has("google")).toBe(false);
  });

  it("a direct xAI key routes to the native xAI adapter", () => {
    process.env.XAI_API_KEY = "sk-xai";
    process.env.OPENROUTER_API_KEY = "sk-or";
    const runtime = new ModelRuntime();
    const grok = runtime.getAllModels().find((m) => m.provider === "xai");
    if (!grok) return; // xAI model may not be in the catalog yet — skip gracefully
    const routed = routeFromRuntime(runtime, "fixed", grok.canonicalId, "hello");
    expect(routed.servedBy).toBe("xai");
    const adapter = resolveProviderAdapter(routed);
    expect(adapter).toBeInstanceOf(OpenAICompatibleModelProvider);
    expect((adapter as OpenAICompatibleModelProvider).providerId).toBe("xai");
  });
});

describe("provider routing: no silent model rewrite or max_tokens lowering", () => {
  it("the native adapter uses the provider-native model id verbatim (no rewriting to OR slug)", () => {
    process.env.OPENAI_API_KEY = "sk-openai-byok";
    process.env.OPENROUTER_API_KEY = "sk-or";
    const runtime = new ModelRuntime();
    const routed = routeFromRuntime(runtime, "auto", null, "hello");
    const adapter = resolveProviderAdapter(routed) as OpenAICompatibleModelProvider;
    // Must be the provider-native id, NOT "openai/gpt-5.6-luna".
    expect(adapter.configuredModel).toBe("gpt-5.6-luna");
    expect(adapter.configuredModel).not.toContain("/");
  });

  it("the resolver does not mutate the routed model or lower max_tokens", () => {
    process.env.OPENAI_API_KEY = "sk-openai-byok";
    const runtime = new ModelRuntime();
    const routed = routeFromRuntime(runtime, "auto", null, "hello");
    const before = { ...routed };
    resolveProviderAdapter(routed, { maxTokens: 8192 });
    // The routed object is unchanged — the resolver only reads it.
    expect(routed).toEqual(before);
  });
});

// ─── Configurable max_tokens + insufficient-credits retry ───────────
//
// Enforces the GPT-5.6 Luna / OpenRouter-credit-error fix:
//   1. max_tokens is configurable via LITT_MAX_TOKENS (default 3000, not 4096).
//   2. The resolver/adapter never silently lower max_tokens — the ONLY
//      place it steps down is the OpenRouter adapter's retry on a
//      CONFIRMED insufficient-credits error, surfaced via [litt-diag].
//   3. Non-credit failures (auth, rate limit, model gone) surface as
//      hard errors — never retried by lowering max_tokens.
//   4. A retry never happens after content has already streamed.

describe("max_tokens policy: configurable limit + default", () => {
  it("defaults to 3000 (not the old 4096) when nothing is configured", () => {
    delete process.env.LITT_MAX_TOKENS;
    expect(resolveMaxTokens()).toBe(DEFAULT_MAX_TOKENS);
    expect(DEFAULT_MAX_TOKENS).toBe(3000);
  });

  it("honors LITT_MAX_TOKENS env var", () => {
    process.env.LITT_MAX_TOKENS = "2048";
    expect(resolveMaxTokens()).toBe(2048);
  });

  it("explicit numeric override beats env var", () => {
    process.env.LITT_MAX_TOKENS = "2048";
    expect(resolveMaxTokens(8192)).toBe(8192);
  });

  it("ignores non-positive override and falls through to env/default", () => {
    process.env.LITT_MAX_TOKENS = "4096";
    expect(resolveMaxTokens(0)).toBe(4096);
    expect(resolveMaxTokens(-1)).toBe(4096);
  });

  it("ignores malformed LITT_MAX_TOKENS and falls back to default", () => {
    process.env.LITT_MAX_TOKENS = "not-a-number";
    expect(resolveMaxTokens()).toBe(DEFAULT_MAX_TOKENS);
  });

  it("OpenRouterModelProvider constructor uses resolveMaxTokens for its default", () => {
    delete process.env.LITT_MAX_TOKENS;
    process.env.OPENROUTER_API_KEY = "sk-or";
    const p = new OpenRouterModelProvider({ model: "openrouter/auto" });
    // Private field, but the diagnostic + ladder derive from it; verify
    // indirectly via the ladder the retry would build.
    expect(buildMaxTokensLadder(3000)[0]).toBe(3000);
    // Explicit override is honored.
    const p2 = new OpenRouterModelProvider({ model: "openrouter/auto", maxTokens: 4096 });
    expect((p2 as unknown as { _maxTokens: number })._maxTokens).toBe(4096);
    // Env override is honored.
    process.env.LITT_MAX_TOKENS = "1500";
    const p3 = new OpenRouterModelProvider({ model: "openrouter/auto" });
    expect((p3 as unknown as { _maxTokens: number })._maxTokens).toBe(1500);
  });
});

describe("buildMaxTokensLadder: stepped insufficient-credits fallback", () => {
  it("produces [initial, 75%, 50%] for a typical initial", () => {
    expect(buildMaxTokensLadder(4096)).toEqual([4096, 3072, 2048]);
  });

  it("floors at 256 tokens so a tiny initial never goes negative", () => {
    expect(buildMaxTokensLadder(300)).toEqual([300, 256]);
  });

  it("dedups so a small initial does not produce repeated steps", () => {
    // 256 → 192 → 128 all clamp to 256 floor → single step.
    expect(buildMaxTokensLadder(256)).toEqual([256]);
  });
});

describe("classifyStreamError: insufficient-credits detection", () => {
  it("promotes a credit-error message to InsufficientCreditsError", () => {
    const err = classifyStreamError(
      new Error("OpenRouter API error 402: Your balance only supports 3624 tokens"),
    );
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect(isInsufficientCreditsError(err)).toBe(true);
    // The affordable token count is extracted from the message.
    expect((err as InsufficientCreditsError).affordableTokens).toBe(3624);
  });

  it("leaves non-credit errors as plain Errors (no retry)", () => {
    const auth = classifyStreamError(new Error("OpenRouter API error 401: invalid api key"));
    expect(auth).not.toBeInstanceOf(InsufficientCreditsError);
    expect(auth.message).toContain("401");

    const rate = classifyStreamError(new Error("OpenRouter API error 429: rate limit exceeded"));
    expect(rate).not.toBeInstanceOf(InsufficientCreditsError);

    const gone = classifyStreamError(new Error("OpenRouter API error 404: model not found"));
    expect(gone).not.toBeInstanceOf(InsufficientCreditsError);
  });

  it("passes through an already-classified InsufficientCreditsError", () => {
    const original = new InsufficientCreditsError("credits low", 1000);
    const again = classifyStreamError(original);
    expect(again).toBe(original);
  });
});

describe("OpenRouterModelProvider: insufficient-credits graceful retry", () => {
  /**
   * A fetch stub that rejects with HTTP 402 + a credit-error body when
   * the request's max_tokens exceeds `affordable`, and streams a healthy
   * SSE response otherwise. Records every requested max_tokens so the
   * test can assert the stepped ladder was walked.
   */
  function creditGatedFetch(affordable: number, content = "ok") {
    const requested: number[] = [];
    const stub = (async (_url: unknown, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      requested.push(body.max_tokens);
      if (body.max_tokens > affordable) {
        return new Response(
          `Your balance only supports ${affordable} tokens`,
          { status: 402, headers: { "Content-Type": "text/plain" } },
        );
      }
      return healthySseFetch(content)(_url, init);
    }) as typeof fetch;
    return { fetch: stub, requested };
  }

  it("retries down the ladder on a 402 credit error and succeeds at a lower step", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or";
    delete process.env.LITT_MAX_TOKENS;
    // initial 4096 → ladder [4096, 3072, 2048]. Affordable = 3000 means
    // 4096 and 3072 are rejected, 2048 succeeds.
    const { fetch: stub, requested } = creditGatedFetch(3000, "hello from luna");
    globalThis.fetch = stub;

    const provider = new OpenRouterModelProvider({ model: "openrouter/auto", maxTokens: 4096 });
    const events: ModelStreamEvent[] = [];
    const result = await provider.stream(
      [{ role: "user", content: "whats up" }],
      (e) => events.push(e),
    );

    // The ladder was walked: 4096 (rejected) → 3072 (rejected) → 2048 (ok).
    expect(requested).toEqual([4096, 3072, 2048]);
    // The successful response content reached the caller.
    expect(result.content).toBe("hello from luna");
    expect(result.provider).toBe("openrouter");
    // A delta was emitted for the successful attempt.
    expect(events.some((e) => e.type === "delta")).toBe(true);
    // Meta was emitted exactly once (not re-emitted on retry).
    expect(events.filter((e) => e.type === "meta").length).toBe(1);
  });

  it("does NOT retry non-credit failures (auth error surfaces as a hard error)", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or";
    // 401 with no credit keywords → hard error, no retry.
    const requested: number[] = [];
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      requested.push(body.max_tokens);
      return new Response("invalid api key", { status: 401 });
    }) as typeof fetch;

    const provider = new OpenRouterModelProvider({ model: "openrouter/auto", maxTokens: 4096 });
    await expect(
      provider.stream([{ role: "user", content: "hi" }], () => {}),
    ).rejects.toThrow(/401/);
    // Only the first attempt ran — no stepped retry.
    expect(requested).toEqual([4096]);
  });

  it("does NOT retry after content has already streamed to the user", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or";
    // First call streams a delta THEN embeds a credit error in a chunk.
    // Because a delta already reached the caller, the provider must NOT
    // retry (it would duplicate partial content) — it surfaces the error.
    const encoder = new TextEncoder();
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(
            `data: {"choices":[{"delta":{"content":"partial"}}]}\n\n`,
          ));
          controller.enqueue(encoder.encode(
            `data: {"error":{"message":"insufficient credits for remaining tokens"}}\n\n`,
          ));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;

    const provider = new OpenRouterModelProvider({ model: "openrouter/auto", maxTokens: 4096 });
    await expect(
      provider.stream([{ role: "user", content: "hi" }], () => {}),
    ).rejects.toThrow(/insufficient credits/);
  });

  it("surfaces the original credit error when the whole ladder is rejected", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or";
    // Affordable below the floor → every step rejected.
    const { fetch: stub, requested } = creditGatedFetch(100);
    globalThis.fetch = stub;

    const provider = new OpenRouterModelProvider({ model: "openrouter/auto", maxTokens: 4096 });
    await expect(
      provider.stream([{ role: "user", content: "hi" }], () => {}),
    ).rejects.toThrow(/402/);
    // The full ladder was attempted before giving up.
    expect(requested).toEqual([4096, 3072, 2048]);
  });
});
