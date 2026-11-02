/**
 * Gemini BYOK — regression: a direct GEMINI_API_KEY / GOOGLE_API_KEY
 * must reach Google's OpenAI-compatible endpoint via the native adapter,
 * never silently fall through to OpenRouter (which would require a key
 * the user never configured and bill a different provider).
 *
 * Covers:
 *   1. servedBy=google + GEMINI_API_KEY → OpenAICompatibleModelProvider
 *      aimed at generativelanguage.googleapis.com/.../openai/...
 *   2. GOOGLE_API_KEY (alt env key) resolves the native key too
 *   3. OPENROUTER_API_KEY is never sent to the Gemini endpoint
 *   4. Health/auth headers carry both Bearer (OpenAI route) and
 *      x-goog-api-key (native modelsUrl probe)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveProviderAdapter, OpenAICompatibleModelProvider } from "../lib/model-provider.js";
import type { RoutedModel } from "../lib/model-runtime.js";

const ENV_KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "LITT_ALLOW_OPENROUTER_FALLBACK"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  globalThis.fetch = originalFetch;
});
const originalFetch = globalThis.fetch;

function googleRouted(): RoutedModel {
  return {
    id: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    servedBy: "google",
    provider: "google",
    reason: "test",
    fallbackReason: null,
    appliedPolicy: "auto",
    openRouterModelId: "google/gemini-3.7-flash",
    providerModelId: "gemini-3.7-flash",
  };
}

function capturingFetch() {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const stub = (async (url: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    calls.push({
      url: String(url),
      headers: Object.fromEntries(h.entries()),
    });
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode('data: {"model":"gemini-3.7-flash","choices":[{"delta":{"content":"ok"}}]}\n\n'));
          c.enqueue(encoder.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }) as typeof fetch;
  return { fetch: stub, calls };
}

describe("Gemini BYOK — native OpenAI-compatible adapter", () => {
  it("GEMINI_API_KEY resolves the native google adapter, not OpenRouter", () => {
    process.env.GEMINI_API_KEY = "gemini-key-1";
    const adapter = resolveProviderAdapter(googleRouted());
    expect(adapter).toBeInstanceOf(OpenAICompatibleModelProvider);
    expect((adapter as OpenAICompatibleModelProvider).providerId).toBe("google");
    expect((adapter as OpenAICompatibleModelProvider).configuredModel).toBe("gemini-3.7-flash");
  });

  it("GOOGLE_API_KEY (altEnvKeys) also resolves the native adapter", () => {
    process.env.GOOGLE_API_KEY = "google-alt-key";
    const adapter = resolveProviderAdapter(googleRouted());
    expect(adapter).toBeInstanceOf(OpenAICompatibleModelProvider);
    expect((adapter as OpenAICompatibleModelProvider).providerId).toBe("google");
  });

  it("stream hits generativelanguage OpenAI route with Bearer + x-goog-api-key — never openrouter", async () => {
    process.env.GOOGLE_API_KEY = "google-alt-key";
    process.env.OPENROUTER_API_KEY = "sk-or-must-not-leak";
    const adapter = resolveProviderAdapter(googleRouted());
    const cap = capturingFetch();
    globalThis.fetch = cap.fetch;
    await adapter.stream([{ role: "user", content: "hi" }], () => {});
    expect(cap.calls.length).toBeGreaterThanOrEqual(1);
    const call = cap.calls[0];
    expect(call.url).toContain("generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(call.url).not.toContain("openrouter.ai");
    expect(call.headers["authorization"]).toBe("Bearer google-alt-key");
    expect(call.headers["x-goog-api-key"]).toBe("google-alt-key");
    expect(call.headers["authorization"]).not.toContain("sk-or-must-not-leak");
  });
});
