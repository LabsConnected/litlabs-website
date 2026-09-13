import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression tests for model routing fallback in callLLMWithTools.
 *
 * Root cause being tested: callLLMWithTools previously had NO fallback.
 * If the primary model failed (e.g. GPT-4o BYOK), the entire agent loop died.
 * Tool execution also died because the LLM is needed to decide which tools to call.
 *
 * Fix: callLLMWithTools now tries a chain of fallback models, logging each
 * attempt with provider, model, latency, and failure category.
 */

// Mock braintrust logging
vi.mock("@/lib/evals/braintrust", () => ({
  logLLMCall: vi.fn(),
}));

// Mock siteConfig
vi.mock("@/lib/siteConfig", () => ({
  SITE_URL: "https://test.example.com",
}));

// Mock fetch to simulate provider failures (OpenRouter and Gemini direct)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { callLLMWithTools, buildAssistantToolCallMessage, buildToolResultMessage, AgentBudgetExhaustedError, _resetToolProviderHealth, getToolProviderHealth, type GeminiPart } from "./llm-tool-calling";

function makeSuccessResponse(model: string, text: string, toolCalls: unknown[] = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model,
      choices: [
        {
          message: { content: text, tool_calls: toolCalls },
          finish_reason: "stop",
        },
      ],
    }),
    text: async () => "",
  };
}

function makeErrorResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => message,
  };
}

function makeGeminiSuccessResponse(text: string, functionCalls: { name: string; args: Record<string, unknown> }[] = []) {
  const parts: { text?: string; functionCall?: { name: string; args: Record<string, unknown> } }[] = [];
  for (const fc of functionCalls) parts.push({ functionCall: fc });
  if (text) parts.push({ text });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts } }],
    }),
    text: async () => "",
  };
}

function makeGeminiErrorResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => message,
  };
}

function makeGeminiRawResponse(parts: GeminiPart[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts } }] }),
    text: async () => "",
  };
}

describe("callLLMWithTools — model routing fallback", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetToolProviderHealth();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("LITT_GROQ_BASIC_ENABLED", "0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("succeeds on the primary model without fallback", async () => {
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse("google/gemini-2.5-flash", "I can help with that."),
    );

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "google/gemini-2.5-flash" },
    );

    expect(result.text).toBe("I can help with that.");
    expect(result.model).toBe("google/gemini-2.5-flash");
    expect(result.provider).toBe("openrouter-free");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to Gemini direct when OpenRouter fails with 404", async () => {
    // OpenRouter fails → independent provider (Gemini direct) succeeds.
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(404, "Model not found"),
    );
    mockFetch.mockResolvedValueOnce(
      makeGeminiSuccessResponse("Fallback response."),
    );
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "gpt-4o-nonexistent" },
    );

    expect(result.text).toBe("Fallback response.");
    expect(result.provider).toBe("gemini-direct");
    expect(result.model).toBe("gemini-3.6-flash");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("fails over to Gemini direct when OpenRouter returns 429 (rate limited)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(429, "Rate limited"),
    );
    mockFetch.mockResolvedValueOnce(
      makeGeminiSuccessResponse("Rate limit fallback."),
    );
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "openai/gpt-4o" },
    );

    expect(result.text).toBe("Rate limit fallback.");
    expect(result.provider).toBe("gemini-direct");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // 429 puts the provider into cooldown, not disable.
    expect(getToolProviderHealth()["openrouter-free"]).toBe("cooldown");
  });

  it("fails over when the OpenRouter request throws a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network timeout"));
    mockFetch.mockResolvedValueOnce(
      makeGeminiSuccessResponse("Network error fallback."),
    );
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "openai/gpt-4o" },
    );

    expect(result.text).toBe("Network error fallback.");
    expect(result.provider).toBe("gemini-direct");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws structured error when ALL Basic providers fail", async () => {
    // OpenRouter 5xx → degraded → Gemini direct also fails.
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(500, "Server error"))
      .mockResolvedValueOnce(makeGeminiErrorResponse(500, "Server error"));
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    await expect(
      callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "openai/gpt-4o" },
      ),
    ).rejects.toThrow(/All Basic-eligible tool-calling providers failed/);
  });

  it("fails over to Gemini direct on OpenRouter 5xx", async () => {
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(503, "Service unavailable"))
      .mockResolvedValueOnce(makeGeminiSuccessResponse("Recovered."));
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
    );

    expect(result.provider).toBe("gemini-direct");
    expect(getToolProviderHealth()["openrouter-free"]).toBe("degraded");
  });

  it("throws truthfully when no provider credentials are configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");

    await expect(
      callLLMWithTools("You are LiTT.", [{ role: "user", content: "Hello" }], []),
    ).rejects.toThrow(/All Basic-eligible tool-calling providers failed/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips OpenRouter cleanly when only OPENROUTER_API_KEY is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    mockFetch.mockResolvedValueOnce(makeGeminiSuccessResponse("Gemini only."));

    const result = await callLLMWithTools(
      "test",
      [{ role: "user", content: "hi" }],
      [],
    );

    expect(result.text).toBe("Gemini only.");
    expect(result.provider).toBe("gemini-direct");
    // No OpenRouter request was attempted.
    expect(mockFetch.mock.calls.every(([url]) => !String(url).includes("openrouter"))).toBe(true);
  });

  it("parses tool calls from successful response", async () => {
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse("google/gemini-2.5-flash", "Let me check.", [
        {
          id: "call_123",
          function: {
            name: "inspect_project_files",
            arguments: JSON.stringify({ project_id: "test-uuid" }),
          },
        },
      ]),
    );

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Inspect the project" }],
      [
        {
          id: "inspect_project_files",
          description: "Inspect project files",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolId).toBe("inspect_project_files");
    expect(result.toolCalls[0].inputs.project_id).toBe("test-uuid");
  });

  it("does not retry non-retryable 400 errors — fails over to Gemini direct", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(400, "Bad request — invalid model"),
    );
    mockFetch.mockResolvedValueOnce(
      makeGeminiSuccessResponse("Fallback after 400."),
    );
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "bad-model" },
    );

    expect(result.text).toBe("Fallback after 400.");
    expect(result.provider).toBe("gemini-direct");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("fails over to Gemini direct when the OpenRouter fetch never settles (timeout backstop)", async () => {
    // A dangling or runaway HTTP request that ignores AbortSignal must not
    // hang the agent loop; the wall-clock timeout backstop forces a failover.
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementationOnce(() => new Promise(() => {})); // hangs
      mockFetch.mockResolvedValueOnce(
        makeGeminiSuccessResponse("Timeout fallback."),
      );
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "gemini-2.5-flash" },
      );

      // Advance past the 30s OpenRouter per-attempt timeout.
      await vi.advanceTimersByTimeAsync(30_000 + 1);
      const result = await promise;

      expect(result.text).toBe("Timeout fallback.");
      expect(result.provider).toBe("gemini-direct");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws deterministically when every provider attempt times out", async () => {
    // If every provider's HTTP request hangs, the agent loop must still reach a
    // final model_failed/finished/done event instead of silently stalling.
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementation(() => new Promise(() => {})); // all calls hang

      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "gemini-2.5-flash" },
      );
      // Attach the rejection handler before advancing timers so the rejection
      // is never reported as unhandled while fake timers flush.
      const assertion = expect(promise).rejects.toThrow(/All Basic-eligible tool-calling providers failed/);

      await vi.runAllTimersAsync();
      await assertion;
      // 1 OpenRouter attempt + 1 Gemini attempt, each bounded by the 30s backstop.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // All per-attempt timeout timers are cleared after the chain settles.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws deterministically when the Gemini direct HTTP request hangs", async () => {
    // OpenRouter fails, then the Gemini direct HTTP request never settles.
    // The fetch must be aborted by the per-attempt timeout and the failure
    // must surface, not leave an orphan SDK promise.
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockImplementation(() => new Promise(() => {})); // Gemini hangs
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    vi.useFakeTimers();
    try {
      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [{ id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: {}, required: [] } }],
        { model: "gemini-2.5-flash" },
      );
      const assertion = expect(promise).rejects.toThrow(/Gemini direct request timed out/);

      await vi.runAllTimersAsync();
      await assertion;
      // 1 OpenRouter attempt + 1 Gemini attempt (non-429 hangs do not retry).
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start any provider call when the shared deadline is already exhausted", async () => {
    mockFetch.mockResolvedValue(makeSuccessResponse("google/gemini-2.5-flash", "Never used."));

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "gemini-2.5-flash", deadlineMs: Date.now() - 1 },
    );

    await expect(promise).rejects.toThrow(AgentBudgetExhaustedError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("cumulative provider chain respects the single shared deadline", async () => {
    // Both providers hang. With a 35s budget, the OpenRouter attempt uses the
    // full 30s cap, and the Gemini attempt is deadline-constrained — when it
    // times out, the chain must surface the canonical budget error.
    mockFetch.mockImplementation(() => new Promise(() => {}));
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    vi.useFakeTimers();
    try {
      const budgetMs = 35_000;
      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "gemini-2.5-flash", deadlineMs: Date.now() + budgetMs },
      );
      const assertion = expect(promise).rejects.toThrow(AgentBudgetExhaustedError);

      await vi.runAllTimersAsync();
      await assertion;
      // 1 OpenRouter attempt (30s) + 1 deadline-constrained Gemini attempt (~4s).
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates the entire provider chain before the configured overall budget", async () => {
    // If the caller passes a short hard deadline, the chain must stop early
    // instead of blindly running through every provider attempt.
    mockFetch.mockImplementation(() => new Promise(() => {})); // hangs
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    vi.useFakeTimers();
    try {
      const budgetMs = 5_000;
      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "gemini-2.5-flash", deadlineMs: Date.now() + budgetMs },
      );
      const assertion = expect(promise).rejects.toThrow(AgentBudgetExhaustedError);

      await vi.runAllTimersAsync();
      await assertion;
      // Only the OpenRouter attempt runs; the budget is exhausted before the
      // Gemini attempt can start.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects before a Gemini 429 retry would exceed the remaining agent budget", async () => {
    // First Gemini attempt is rate-limited. The required 60s sleep + the next
    // generateContent timeout must fit inside the caller's deadline or it
    // fails deterministically without attempting the sleep.
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeGeminiErrorResponse(429, "Too Many Requests"));
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [{ id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: {}, required: [] } }],
      { model: "gemini-2.5-flash", deadlineMs: Date.now() + 60_000 },
    );

    await expect(promise).rejects.toThrow(AgentBudgetExhaustedError);
    // 1 OpenRouter attempt + 1 Gemini attempt.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("succeeds through the Gemini direct fallback after OpenRouter fails", async () => {
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeGeminiSuccessResponse("I'll create the file.", [{ name: "write_file", args: { path: "test.txt", content: "hello" } }]));
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [{ id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: [] } }],
      { model: "gemini-2.5-flash" },
    );

    expect(result.text).toBe("I'll create the file.");
    expect(result.provider).toBe("gemini-direct");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolId).toBe("write_file");
  });

  it("rejects immediately when the upstream/client signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "gemini-2.5-flash", signal: controller.signal },
      ),
    ).rejects.toThrow(/budget exhausted|aborted by upstream/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("aborts a pending OpenRouter request and stops the chain when the upstream signal aborts", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      mockFetch.mockImplementation(() => new Promise(() => {})); // hangs

      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "gemini-2.5-flash", signal: controller.signal },
      );
      const assertion = expect(promise).rejects.toThrow(/aborted by upstream/);

      // Let the first OpenRouter attempt start, then abort mid-flight.
      await vi.advanceTimersByTimeAsync(5_000);
      controller.abort();
      await vi.advanceTimersByTimeAsync(60_000);

      await assertion;
      // Only the in-flight attempt should have started; the chain stops.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // No orphan timeout or retry/backoff remains after the upstream abort.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries Gemini direct 429 when the backoff fits in the remaining budget", async () => {
    vi.useFakeTimers();
    try {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
        .mockResolvedValueOnce(makeGeminiErrorResponse(429, "Too Many Requests"))
        .mockResolvedValueOnce(makeGeminiSuccessResponse("Retry success."));
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [{ id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: {}, required: [] } }],
        { model: "gemini-2.5-flash", deadlineMs: Date.now() + 300_000 },
      );

      // First run starts the first (and only) 60s backoff timer.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(60_000 + 1);
      const result = await promise;

      expect(result.text).toBe("Retry success.");
      // 1 OpenRouter + 2 Gemini attempts.
      expect(mockFetch).toHaveBeenCalledTimes(3);
      // Backoff and retry completed; no residual timers.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("classifies a Gemini 429 and the subsequent upstream abort of the backoff", async () => {
    vi.useFakeTimers();
    try {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
        .mockResolvedValueOnce(makeGeminiErrorResponse(429, "Too Many Requests"))
        .mockResolvedValueOnce(makeGeminiSuccessResponse("Should not run.", []));
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

      const controller = new AbortController();
      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [{ id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: {}, required: [] } }],
        { model: "gemini-2.5-flash", deadlineMs: Date.now() + 300_000, signal: controller.signal },
      );
      const assertion = expect(promise).rejects.toThrow(/aborted by upstream/);

      await vi.advanceTimersByTimeAsync(0);
      // 429 triggers a 60s backoff.
      controller.abort();
      await vi.advanceTimersByTimeAsync(60_000);

      await assertion;
      // 1 OpenRouter + 1 Gemini (429), and no retry attempt.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // The 429 backoff timer is cleared when the upstream signal aborts.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves Gemini parts across all candidates text, functionCalls, ids and thoughtSignatures", async () => {
    const parts: GeminiPart[] = [
      { text: "I will " },
      { functionCall: { id: "call_abc_1", name: "write_file", args: { path: "test.txt" } }, thoughtSignature: "sig_1" },
      { text: "and then " },
      { functionCall: { name: "list_files", args: { directory: "/" } } },
      { text: "done." },
    ];

    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeGeminiRawResponse(parts));
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [
        { id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: [] } },
        { id: "list_files", description: "List files", inputSchema: { type: "object", properties: { directory: { type: "string" } }, required: [] } },
      ],
      { model: "gemini-2.5-flash" },
    );

    expect(result.text).toBe("I will and then done.");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].toolCallId).toBe("call_abc_1");
    expect(result.toolCalls[0].toolId).toBe("write_file");
    expect(result.toolCalls[1].toolId).toBe("list_files");
    expect(result.rawParts).toEqual(parts);
  });

  it("does not start another provider after an upstream abort has already settled the chain", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(() => new Promise(() => {})); // hangs forever

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "gemini-2.5-flash", signal: controller.signal },
    );

    controller.abort();
    await expect(promise).rejects.toThrow(/aborted by upstream/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("fetchWithTimeout abort/timeouts through callLLMWithTools", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetToolProviderHealth();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("LITT_GROQ_BASIC_ENABLED", "0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("OpenRouter: pending request is aborted by upstream and classifies as upstream_abort", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "gemini-2.5-flash", signal: controller.signal },
      );
      const assertion = expect(promise).rejects.toThrow(/request aborted by upstream/);

      await vi.advanceTimersByTimeAsync(5_000);
      const init = mockFetch.mock.calls[0][1] as { signal: AbortSignal } | undefined;
      expect(init).toBeDefined();
      expect(init!.signal.aborted).toBe(false);

      controller.abort();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(init!.signal.aborted).toBe(true);
      await assertion;
      // No fallback attempts after the upstream abort.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Timeout listener/timer is cleaned up; no pending work remains.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Gemini: per-attempt timeout fires and aborts the internal fetch signal", async () => {
    vi.useFakeTimers();
    try {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
        .mockImplementation(() => new Promise(() => {})); // Gemini hangs
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [{ id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: {}, required: [] } }],
        { model: "gemini-2.5-flash" },
      );
      const assertion = expect(promise).rejects.toThrow(/Gemini direct request timed out/);

      await vi.advanceTimersByTimeAsync(0);
      const geminiInit = mockFetch.mock.calls[1][1] as { signal: AbortSignal } | undefined;
      expect(geminiInit).toBeDefined();
      expect(geminiInit!.signal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(120_000 + 1);

      expect(geminiInit!.signal.aborted).toBe(true);
      await assertion;
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // The per-attempt timeout is cleared and no orphan timer is left.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Gemini: upstream abort during a pending request classifies as upstream_abort", async () => {
    vi.useFakeTimers();
    try {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
        .mockImplementation(() => new Promise(() => {}));
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

      const controller = new AbortController();
      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [{ id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: {}, required: [] } }],
        { model: "gemini-2.5-flash", signal: controller.signal },
      );
      const assertion = expect(promise).rejects.toThrow(/Gemini direct request aborted by upstream/);

      await vi.advanceTimersByTimeAsync(5_000);
      controller.abort();
      await vi.advanceTimersByTimeAsync(5_000);

      await assertion;
      // Only the one Gemini attempt started and was aborted; no retries or fallbacks.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // No orphan timeout or listener remains after the upstream abort.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Gemini 429: no backoff timer starts when the retry cannot fit the deadline", async () => {
    vi.useFakeTimers();
    try {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
        .mockResolvedValueOnce(makeGeminiErrorResponse(429, "Too Many Requests"));
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [{ id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: {}, required: [] } }],
        { model: "gemini-2.5-flash", deadlineMs: Date.now() + 60_000 },
      );

      await expect(promise).rejects.toThrow(AgentBudgetExhaustedError);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // No 60s/120s backoff timer should be pending.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Gemini 429: upstream abort during backoff clears the timer and does not retry", async () => {
    vi.useFakeTimers();
    try {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
        .mockResolvedValueOnce(makeGeminiErrorResponse(429, "Too Many Requests"))
        .mockResolvedValueOnce(makeGeminiSuccessResponse("Should not run.", []));
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

      const controller = new AbortController();
      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [{ id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: {}, required: [] } }],
        { model: "gemini-2.5-flash", deadlineMs: Date.now() + 300_000, signal: controller.signal },
      );
      const assertion = expect(promise).rejects.toThrow(/aborted by upstream/);

      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      controller.abort();
      await vi.advanceTimersByTimeAsync(60_000);

      await assertion;
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Gemini conversation history round-trip", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetToolProviderHealth();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("LITT_GROQ_BASIC_ENABLED", "0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves thoughtSignature from one Gemini turn to the next request's contents.parts", async () => {
    const firstParts: GeminiPart[] = [
      { text: "I will create the file." },
      { functionCall: { id: "call_abc", name: "write_file", args: { path: "test.txt" } }, thoughtSignature: "sig_model_1" },
    ];
    const tools = [
      { id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: [] } },
    ];

    // First call: OpenRouter fails, Gemini returns parts with a thoughtSignature.
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeGeminiRawResponse(firstParts));
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const firstResult = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      tools,
      { model: "gemini-2.5-flash" },
    );

    expect(firstResult.rawParts).toEqual(firstParts);

    // Build the next conversation turn including the provider-specific raw parts.
    const assistantMessage = buildAssistantToolCallMessage(firstResult.toolCalls, firstResult.text, firstResult.rawParts);
    const toolResult = buildToolResultMessage({ toolCallId: firstResult.toolCalls[0].toolCallId, toolId: firstResult.toolCalls[0].toolId, result: { ok: true }, success: true });
    const nextMessages = [
      { role: "user" as const, content: "Now commit that file" },
      { role: "assistant" as const, content: assistantMessage.content, parts: assistantMessage.parts },
      toolResult,
    ];

    // Second call: OpenRouter is account-disabled (402), so the request goes
    // straight to Gemini — which must contain the assistant's raw parts,
    // including thoughtSignature.
    const secondParts: GeminiPart[] = [{ text: "Done." }];
    mockFetch.mockResolvedValueOnce(makeGeminiRawResponse(secondParts));

    await callLLMWithTools(
      "You are LiTT.",
      nextMessages,
      tools,
      { model: "gemini-2.5-flash" },
    );

    const geminiCalls = mockFetch.mock.calls.filter(([url]) => String(url).includes("generativelanguage"));
    const secondGeminiCall = geminiCalls[1];
    const body = JSON.parse((secondGeminiCall[1] as { body: string }).body);
    type GeminiContent = { role: string; parts?: GeminiPart[] };
    const assistantContent = (body.contents as GeminiContent[]).find((c) => c.role === "model");
    const toolResultContent = (body.contents as GeminiContent[]).find((c) => c.role === "user" && c.parts?.some((p: GeminiPart) => p.functionResponse));

    // Assistant/model turn preserves the original raw parts and thoughtSignature.
    expect(assistantContent?.parts).toEqual(firstParts);

    // Tool result turn serializes as a Gemini functionResponse part.
    expect(toolResultContent?.parts).toEqual([
      { functionResponse: { name: "write_file", response: { ok: true } } },
    ]);

    // Gemini wire payload must NOT contain OpenRouter-only metadata.
    for (const c of body.contents) {
      expect(c.tool_calls).toBeUndefined();
      expect(c.tool_call_id).toBeUndefined();
    }
  });
});

describe("OpenRouter conversation history round-trip", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetToolProviderHealth();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("LITT_GROQ_BASIC_ENABLED", "0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves assistant tool_calls and tool result tool_call_id in the next OpenRouter request", async () => {
    const toolCallId = "call_test_123";
    const toolInputs = { path: "test.txt", content: "hello" };
    mockFetch.mockResolvedValueOnce(makeSuccessResponse("openai/gpt-4o", "I will write the file.", [
      { id: toolCallId, type: "function", function: { name: "write_file", arguments: JSON.stringify(toolInputs) } },
    ]));
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");

    const firstResult = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Write a file" }],
      [{ id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: [] } }],
      { model: "openai/gpt-4o" },
    );

    expect(firstResult.toolCalls).toEqual([
      { toolCallId, toolId: "write_file", inputs: toolInputs },
    ]);

    const assistantMessage = buildAssistantToolCallMessage(firstResult.toolCalls, firstResult.text, firstResult.rawParts);
    const toolResult = buildToolResultMessage({ toolCallId, toolId: "write_file", result: { ok: true }, success: true });
    const nextMessages = [
      { role: "user" as const, content: "Now continue" },
      assistantMessage,
      toolResult,
    ];

    mockFetch.mockResolvedValueOnce(makeSuccessResponse("openai/gpt-4o", "Done."));
    await callLLMWithTools("You are LiTT.", nextMessages, [], { model: "openai/gpt-4o" });

    const openRouterCalls = mockFetch.mock.calls.filter(([url]) => String(url).includes("openrouter"));
    const secondOpenRouterCall = openRouterCalls[1];
    const body = JSON.parse((secondOpenRouterCall[1] as { body: string }).body);
    const assistantMsg = body.messages.find((m: { role: string }) => m.role === "assistant");
    const toolMsg = body.messages.find((m: { role: string }) => m.role === "tool");

    expect(assistantMsg.tool_calls).toEqual([
      { id: toolCallId, type: "function", function: { name: "write_file", arguments: JSON.stringify(toolInputs) } },
    ]);
    expect(toolMsg.tool_call_id).toBe(toolCallId);
    expect(toolMsg.content).toBe(JSON.stringify({ ok: true }));
    // OpenRouter wire messages must NOT contain Gemini-only parts.
    for (const m of body.messages) {
      expect(m.parts).toBeUndefined();
    }
  });
});

describe("callLLMWithTools — Basic provider routing policy", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetToolProviderHealth();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("LITT_GROQ_BASIC_ENABLED", "0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function openRouterRequestBody(): { model?: string } {
    const call = mockFetch.mock.calls.find(([url]) => String(url).includes("openrouter"));
    expect(call).toBeDefined();
    return JSON.parse((call![1] as { body: string }).body);
  }

  it("Basic routing only ever sends openrouter/free — paid model hints are constrained", async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse("openrouter/free", "ok"));

    await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "hi" }],
      [],
      { model: "openai/gpt-4o" },
    );

    // A paid model ID must never reach the wire for a Basic call.
    expect(openRouterRequestBody().model).toBe("openrouter/free");
  });

  it("honors a model hint only when it is an explicit free-tier model", async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse("google/gemini-2.5-flash:free", "ok"));

    await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "hi" }],
      [],
      { model: "google/gemini-2.5-flash:free" },
    );

    expect(openRouterRequestBody().model).toBe("google/gemini-2.5-flash:free");
  });

  it("402 on OpenRouter is an account-level failure — one attempt, then independent failover", async () => {
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Insufficient credits"))
      .mockResolvedValueOnce(makeGeminiSuccessResponse("Served by Gemini."));
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "anthropic/claude-sonnet-4.6" },
    );

    expect(result.provider).toBe("gemini-direct");
    // Exactly one OpenRouter request — no retrying sibling models behind the
    // same dead billing account.
    const openRouterCalls = mockFetch.mock.calls.filter(([url]) => String(url).includes("openrouter"));
    expect(openRouterCalls).toHaveLength(1);
    expect(getToolProviderHealth()["openrouter-free"]).toBe("disabled");

    // A subsequent call must skip the dead account entirely.
    mockFetch.mockResolvedValueOnce(makeGeminiSuccessResponse("Still Gemini."));
    const second = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello again" }],
      [],
    );
    expect(second.provider).toBe("gemini-direct");
    const laterOpenRouterCalls = mockFetch.mock.calls
      .slice(2)
      .filter(([url]) => String(url).includes("openrouter"));
    expect(laterOpenRouterCalls).toHaveLength(0);
  });

  it("Groq is never attempted unless the operator opts it into Basic", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    // LITT_GROQ_BASIC_ENABLED stays "0" — credential alone must not open the route.
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeGeminiErrorResponse(500, "Server error"));
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    await expect(
      callLLMWithTools("You are LiTT.", [{ role: "user", content: "hi" }], []),
    ).rejects.toThrow(/All Basic-eligible tool-calling providers failed/);

    expect(mockFetch.mock.calls.some(([url]) => String(url).includes("groq.com"))).toBe(false);
  });

  it("Groq 401 disables the Groq route without blocking other providers", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("LITT_GROQ_BASIC_ENABLED", "1");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required")) // OpenRouter
      .mockResolvedValueOnce(makeGeminiErrorResponse(500, "Server error")) // Gemini
      .mockResolvedValueOnce(makeErrorResponse(401, "Invalid API key")); // Groq

    let message = "";
    try {
      await callLLMWithTools("You are LiTT.", [{ role: "user", content: "hi" }], []);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toContain("All Basic-eligible tool-calling providers failed");
    expect(getToolProviderHealth().groq).toBe("disabled");
    // The error must truthfully list every attempted provider.
    expect(message).toContain("groq");
  });

  it("serves from Groq when it is the only healthy Basic route", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("LITT_GROQ_BASIC_ENABLED", "1");
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeSuccessResponse("openai/gpt-oss-120b", "Groq served."));

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "hi" }],
      [],
    );

    expect(result.provider).toBe("groq");
    expect(result.text).toBe("Groq served.");
    const groqCall = mockFetch.mock.calls.find(([url]) => String(url).includes("groq.com"));
    expect(groqCall).toBeDefined();
    expect(JSON.parse((groqCall![1] as { body: string }).body).model).toBe("openai/gpt-oss-120b");
  });

  it("a Gemini 429 fails fast to a configured Groq route instead of sleeping", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("LITT_GROQ_BASIC_ENABLED", "1");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required")) // OpenRouter
      .mockResolvedValueOnce(makeGeminiErrorResponse(429, "Too Many Requests")) // Gemini
      .mockResolvedValueOnce(makeSuccessResponse("openai/gpt-oss-120b", "Groq after 429."));

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "hi" }],
      [],
      { deadlineMs: Date.now() + 300_000 },
    );

    expect(result.provider).toBe("groq");
    // Gemini attempt 1 returned 429 → no 60s provider-local sleep was taken.
    expect(getToolProviderHealth()["gemini-direct"]).toBe("cooldown");
  });

  it("a malformed OpenRouter response body fails over instead of escaping", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => { throw new Error("bad json"); },
        text: async () => "",
      })
      .mockResolvedValueOnce(makeGeminiSuccessResponse("Recovered."));
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "hi" }],
      [],
    );

    expect(result.provider).toBe("gemini-direct");
  });

  it("all Basic routes failing produces a truthful per-provider failure summary", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("LITT_GROQ_BASIC_ENABLED", "1");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeGeminiErrorResponse(503, "Unavailable"))
      .mockResolvedValueOnce(makeErrorResponse(401, "Invalid API key"));

    let message = "";
    try {
      await callLLMWithTools("You are LiTT.", [{ role: "user", content: "hi" }], []);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toContain("All Basic-eligible tool-calling providers failed");
    expect(message).toContain("openrouter-free");
    expect(message).toContain("gemini-direct");
    expect(message).toContain("groq");
  });
});

describe("buildToolResultMessage", () => {
  it("produces an OpenRouter tool message and a Gemini functionResponse part", () => {
    const result = buildToolResultMessage({ toolCallId: "call_1", toolId: "project.scan", result: { found: 1 }, success: true });
    expect(result.role).toBe("tool");
    expect(result.tool_call_id).toBe("call_1");
    expect(result.content).toBe(JSON.stringify({ found: 1 }));
    expect(result.parts).toEqual([
      { functionResponse: { name: "project_scan", response: { found: 1 } } },
    ]);
  });
});
