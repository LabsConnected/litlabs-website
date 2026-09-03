/**
 * LOCAL provider pin contract — proves the OpenRouterModelProvider (the
 * LOCAL-BYOK adapter used in executionTarget=local) honors routingMode=fixed:
 *  - sends provider.allow_fallbacks=false on the outbound request
 *  - preserves the configured model as the authoritative model
 *  - does NOT adopt a provider-reported different model as activeModel
 *  - records the provider-reported model only as actualServedModel
 *
 * AUTO mode leaves existing behavior intact (allow_fallbacks=true, provider
 * model may become activeModel).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenRouterModelProvider, resolveProviderAdapter } from "../lib/model-provider.js";

let fetchMock: ReturnType<typeof vi.fn>;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "«redacted»";
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

function sseResponse(model: string, content = "LITT_PIN_TEST", usage = { total_tokens: 10 }): Response {
  const line = `data: ${JSON.stringify({ model, choices: [{ delta: { content } }], usage })}`;
  const body = `${line}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, statusText: "OK", headers: { "Content-Type": "text/event-stream" } });
}

function getFetchBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string);
}

const KIMI_OR = "moonshotai/kimi-k3";
const CLAUDE_FABLE = "anthropic/claude-fable-5";

describe("LOCAL OpenRouterModelProvider — FIXED routingMode pin contract", () => {
  it("sends allow_fallbacks=false + preserves configured model when provider substitutes", async () => {
    // Provider reports a DIFFERENT model than what was requested
    fetchMock.mockResolvedValueOnce(sseResponse(CLAUDE_FABLE));

    const provider = new OpenRouterModelProvider({
      model: KIMI_OR,
      apiKey: "«redacted»",
      routingMode: "fixed",
    });

    const deltas: string[] = [];
    const result = await provider.stream(
      [{ role: "user", content: "Reply with exactly: LITT_PIN_TEST" }],
      (event) => {
        if (event.type === "delta") deltas.push(event.text);
      },
    );

    const body = getFetchBody();
    // FIXED: outbound must forbid OpenRouter cross-model fallback
    expect(body.provider).toEqual({ allow_fallbacks: false });
    expect(body.model).toBe(KIMI_OR);

    // Configured model stays authoritative — NOT the substituted claude-fable-5
    expect(result.model).toBe(KIMI_OR);
    expect(result.actualServedModel).toBe(CLAUDE_FABLE);
    expect(provider.configuredModel).toBe(KIMI_OR);
    expect(provider.activeModel).toBe(KIMI_OR);
    expect(provider.isPinned).toBe(true);
  });

  it("isPinned is true for fixed, false for auto", () => {
    const fixed = new OpenRouterModelProvider({ model: KIMI_OR, apiKey: "«redacted»", routingMode: "fixed" });
    const auto = new OpenRouterModelProvider({ model: KIMI_OR, apiKey: "«redacted»", routingMode: "auto" });
    const def = new OpenRouterModelProvider({ model: KIMI_OR, apiKey: "«redacted»" });
    expect(fixed.isPinned).toBe(true);
    expect(auto.isPinned).toBe(false);
    expect(def.isPinned).toBe(false);
  });
});

describe("LOCAL OpenRouterModelProvider — AUTO routingMode preserves existing behavior", () => {
  it("sends allow_fallbacks=true and adopts provider-reported model as active", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(CLAUDE_FABLE));

    const provider = new OpenRouterModelProvider({
      model: KIMI_OR,
      apiKey: "«redacted»",
      routingMode: "auto",
    });

    const result = await provider.stream([{ role: "user", content: "hi" }], () => {});

    const body = getFetchBody();
    expect(body.provider).toEqual({ allow_fallbacks: true });

    // AUTO: provider-reported model becomes authoritative
    expect(result.model).toBe(CLAUDE_FABLE);
    expect(provider.activeModel).toBe(CLAUDE_FABLE);
    expect(result.actualServedModel).toBeUndefined();
  });
});

describe("LOCAL resolveProviderAdapter — routingMode wired to OpenRouterModelProvider", () => {
  it("fixed routingMode reaches the constructed provider (kimi-k3)", () => {
    const provider = resolveProviderAdapter(
      {
        id: "kimi-k3",
        label: "Kimi K3",
        servedBy: "openrouter" as const,
        provider: "kimi",
        reason: "pinned",
        fallbackReason: null,
        appliedPolicy: "pinned",
        openRouterModelId: KIMI_OR,
        providerModelId: undefined,
      },
      { routingMode: "fixed" },
    ) as OpenRouterModelProvider;

    expect(provider.isPinned).toBe(true);
    expect(provider.configuredModel).toBe(KIMI_OR);
  });

  it("auto routingMode leaves the provider non-pinned", () => {
    const provider = resolveProviderAdapter(
      {
        id: "kimi-k3",
        label: "Kimi K3",
        servedBy: "openrouter" as const,
        provider: "kimi",
        reason: "auto",
        fallbackReason: null,
        appliedPolicy: "auto",
        openRouterModelId: KIMI_OR,
        providerModelId: undefined,
      },
      { routingMode: "auto" },
    ) as OpenRouterModelProvider;

    expect(provider.isPinned).toBe(false);
  });
});
