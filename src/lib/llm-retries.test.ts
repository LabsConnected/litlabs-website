// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";

/**
 * generateText bounded same-provider retry (providerRetries) — proves that
 * transient provider failures (503/429/network) retry the SAME provider a
 * bounded number of times with backoff before failing over, that retries
 * never leave the cost-filtered/pinned chain (no unexpected paid-provider
 * fallback), and that non-retryable errors + caller aborts never retry.
 *
 * The module is imported dynamically AFTER GROQ_API_KEY is set: provider
 * keys are module-level consts evaluated at import time.
 */

vi.mock("@/lib/metrics", () => ({ recordLLMCall: vi.fn() }));
vi.mock("@/lib/evals/braintrust", () => ({ logLLMCall: vi.fn() }));

// Mock the Gemini SDK — generateContent is stubbed per-test via
// geminiGenerateMock so SDK errors (plain Errors with "[NNN]" status text)
// can be exercised without network access.
const { geminiGenerateMock } = vi.hoisted(() => ({ geminiGenerateMock: vi.fn() }));
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: (...args: unknown[]) => geminiGenerateMock(...args) };
    }
  },
}));

const emitLlmMeteringMock = vi.fn(async (..._args: unknown[]) => ({ usageEventId: "evt" }));
vi.mock("@/lib/metering", () => ({
  emitLlmMetering: (...args: unknown[]) => emitLlmMeteringMock(...args),
  getMeteringContext: () => undefined,
}));
vi.mock("@/lib/spend-guards", () => ({
  checkRunawayGuards: vi.fn(async () => ({ allowed: true })),
  SpendGuardError: class SpendGuardError extends Error {},
}));

const GROQ_OK_BODY = JSON.stringify({
  choices: [{ message: { content: "ok-reply" } }],
  usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
});

const prevGroqKey = process.env.GROQ_API_KEY;
const prevGeminiKey = process.env.GEMINI_API_KEY;

describe("generateText — bounded same-provider retry", () => {
  beforeAll(async () => {
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";
  });

  afterAll(() => {
    if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGeminiKey;
  });

  afterAll(() => {
    if (prevGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prevGroqKey;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    emitLlmMeteringMock.mockClear();
  });

  async function importGenerateText() {
    const mod = await import("./llm");
    return mod.generateText;
  }

  it("retries the same provider on a transient 503 and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("overloaded", { status: 503 }))
      .mockResolvedValueOnce(new Response("overloaded", { status: 503 }))
      .mockResolvedValueOnce(new Response(GROQ_OK_BODY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const generateText = await importGenerateText();
    const res = await generateText("hi", {
      task: "chat",
      provider: "groq",
      providerRetries: 2,
      providerRetryDelayMs: 1,
      metering: { feature: "demo-chat" },
    });

    expect(res.provider).toBe("groq");
    expect(res.text).toBe("ok-reply");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Every dispatch hit the SAME provider — retries never left the pinned
    // chain (no unexpected paid-provider fallback).
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toContain("api.groq.com");
    }
    // Each attempt was metered individually with ordered retrySequence.
    const sequences = (emitLlmMeteringMock.mock.calls as unknown[][]).map(
      (c) => (c[0] as { retrySequence?: number }).retrySequence,
    );
    expect(sequences).toEqual([0, 1, 2]);
  });

  it("stops after the bounded retry limit and reports the truthful failure", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("overloaded", { status: 503 })));
    vi.stubGlobal("fetch", fetchMock);

    const generateText = await importGenerateText();
    await expect(
      generateText("hi", {
        task: "chat",
        provider: "groq",
        providerRetries: 1,
        providerRetryDelayMs: 1,
      }),
    ).rejects.toThrow(/All LLM providers failed\. Tried: groq/);

    // 1 initial attempt + 1 retry — bounded, not a storm.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry transient errors when providerRetries is unset (default)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("overloaded", { status: 503 }))
      .mockResolvedValueOnce(new Response(GROQ_OK_BODY, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const generateText = await importGenerateText();
    await expect(
      generateText("hi", { task: "chat", provider: "groq" }),
    ).rejects.toThrow(/All LLM providers failed/);

    // Historical behavior preserved: immediate failover, single attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries non-retryable errors (400 bad request)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("bad request", { status: 400 })));
    vi.stubGlobal("fetch", fetchMock);

    const generateText = await importGenerateText();
    await expect(
      generateText("hi", {
        task: "chat",
        provider: "groq",
        providerRetries: 3,
        providerRetryDelayMs: 1,
      }),
    ).rejects.toThrow(/All LLM providers failed/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honours a caller abort during retry backoff", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("overloaded", { status: 503 })));
    vi.stubGlobal("fetch", fetchMock);

    const generateText = await importGenerateText();
    const ctrl = new AbortController();
    const pending = generateText("hi", {
      task: "chat",
      provider: "groq",
      providerRetries: 3,
      providerRetryDelayMs: 60_000, // long backoff — abort must cut it short
      signal: ctrl.signal,
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    ctrl.abort(new Error("Cancelled by user"));

    await expect(pending).rejects.toThrow("Cancelled by user");
    // The abort killed the wait — no further attempts were dispatched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("generateText — Gemini SDK error classification + timeout", () => {
  afterEach(() => {
    geminiGenerateMock.mockReset();
  });

  async function importGenerateText() {
    const mod = await import("./llm");
    return mod.generateText;
  }

  const okResult = () => ({
    response: {
      text: () => "gemini-ok",
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
    },
  });

  it("retries a Gemini SDK 503 (plain Error, not ProviderError) on the same provider", async () => {
    const err503 = () =>
      new Error(
        "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/x:generateContent: [503 Service Unavailable] high demand",
      );
    // primary(503) → fallback(503) → [providerRetries] primary(OK): only a
    // real retry produces the third dispatch — a model-fallback success
    // would stop at two.
    geminiGenerateMock
      .mockRejectedValueOnce(err503())
      .mockRejectedValueOnce(err503())
      .mockResolvedValueOnce(okResult());

    const generateText = await importGenerateText();
    const res = await generateText("hi", {
      task: "chat",
      provider: "gemini",
      providerRetries: 2,
      providerRetryDelayMs: 1,
    });

    expect(res.provider).toBe("gemini");
    expect(res.text).toBe("gemini-ok");
    expect(geminiGenerateMock).toHaveBeenCalledTimes(3);
    // Every SDK call carried the bounded requestOptions.timeout (default 30s).
    for (const call of geminiGenerateMock.mock.calls) {
      const reqOpts = call[1] as { timeout?: number; signal?: AbortSignal };
      expect(reqOpts?.timeout).toBe(30_000);
    }
  });

  it("classifies a Gemini SDK 400 as non-retryable (no wasted attempts)", async () => {
    geminiGenerateMock.mockRejectedValue(
      new Error("[GoogleGenerativeAI Error]: [400 Bad Request] invalid request"),
    );

    const generateText = await importGenerateText();
    await expect(
      generateText("hi", {
        task: "chat",
        provider: "gemini",
        providerRetries: 3,
        providerRetryDelayMs: 1,
      }),
    ).rejects.toThrow(/All LLM providers failed\. Tried: gemini/);

    // 400 on primary → fallback model once (ProviderError catch) → no retries.
    expect(geminiGenerateMock).toHaveBeenCalledTimes(2);
  });

  it("forwards timeoutMs + caller signal into the SDK request options", async () => {
    geminiGenerateMock.mockResolvedValue(okResult());
    const ctrl = new AbortController();

    const generateText = await importGenerateText();
    await generateText("hi", {
      task: "chat",
      provider: "gemini",
      timeoutMs: 7_500,
      signal: ctrl.signal,
    });

    const reqOpts = geminiGenerateMock.mock.calls[0][1] as {
      timeout?: number;
      signal?: AbortSignal;
    };
    expect(reqOpts?.timeout).toBe(7_500);
    expect(reqOpts?.signal).toBe(ctrl.signal);
  });
});
