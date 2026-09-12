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

import { callLLMWithTools } from "./llm-tool-calling";

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

describe("callLLMWithTools — model routing fallback", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
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
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to a secondary model when primary fails with 404", async () => {
    // Primary model fails
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(404, "Model not found"),
    );
    // Fallback succeeds (first fallback in chain: gemini-2.5-flash)
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse("google/gemini-2.5-flash", "Fallback response."),
    );

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "gpt-4o-nonexistent" },
    );

    expect(result.text).toBe("Fallback response.");
    expect(result.model).toBe("google/gemini-2.5-flash");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back when primary fails with 429 (rate limited)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(429, "Rate limited"),
    );
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse("google/gemini-2.5-flash", "Rate limit fallback."),
    );

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "openai/gpt-4o" },
    );

    expect(result.text).toBe("Rate limit fallback.");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back when primary fails with network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network timeout"));
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse("google/gemini-2.5-flash", "Network error fallback."),
    );

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "openai/gpt-4o" },
    );

    expect(result.text).toBe("Network error fallback.");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws structured error when ALL fallbacks fail", async () => {
    // All models fail
    mockFetch.mockResolvedValue(makeErrorResponse(500, "Server error"));

    await expect(
      callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "openai/gpt-4o" },
      ),
    ).rejects.toThrow(/All tool-calling models failed/);
  });

  it("throws when OPENROUTER_API_KEY is not set", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");

    await expect(
      callLLMWithTools("You are LiTT.", [{ role: "user", content: "Hello" }], []),
    ).rejects.toThrow("OPENROUTER_API_KEY not set");
  });

  it("throws when OPENROUTER_API_KEY is empty string", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");

    await expect(
      callLLMWithTools("test", [{ role: "user", content: "hi" }], []),
    ).rejects.toThrow("OPENROUTER_API_KEY not set");
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

  it("does not retry non-retryable 400 errors — skips to next model", async () => {
    // 400 is non-retryable but we still try the next model in the chain
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(400, "Bad request — invalid model"),
    );
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse("google/gemini-2.5-flash", "Fallback after 400."),
    );

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "bad-model" },
    );

    expect(result.text).toBe("Fallback after 400.");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back when the primary fetch never settles (timeout backstop)", async () => {
    // A dangling or runaway HTTP request that ignores AbortSignal must not
    // hang the agent loop; the wall-clock timeout backstop forces a fallback.
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementationOnce(() => new Promise(() => {})); // hangs
      mockFetch.mockResolvedValueOnce(
        makeSuccessResponse("google/gemini-2.5-flash", "Timeout fallback."),
      );

      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "gemini-2.5-flash" },
      );

      // Advance past the 60s OpenRouter per-attempt timeout.
      await vi.advanceTimersByTimeAsync(60_000 + 1);
      const result = await promise;

      expect(result.text).toBe("Timeout fallback.");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws deterministically when every OpenRouter attempt times out", async () => {
    // If every model's HTTP request hangs, the agent loop must still reach a
    // final model_failed/finished/done event instead of silently stalling.
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementation(() => new Promise(() => {})); // all calls hang

      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "gemini-2.5-flash" },
      );

      await vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow(/All tool-calling models failed/);
      // Primary + 4 OpenRouter fallbacks each hit the 60s backstop.
      expect(mockFetch).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws deterministically when the Gemini direct HTTP request hangs", async () => {
    // All OpenRouter models fail, then the Gemini direct HTTP request never
    // settles. The fetch must be aborted by the per-attempt timeout and the
    // failure must surface, not leave an orphan SDK promise.
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
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

      await vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow(/Gemini direct request timed out/);
      // 5 OpenRouter attempts + 1 Gemini attempt (non-429 hangs do not retry).
      expect(mockFetch).toHaveBeenCalledTimes(6);
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
      { model: "gemini-2.5-flash", deadline: Date.now() - 1 },
    );

    await expect(promise).rejects.toThrow(/Agent runtime budget exhausted/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("cumulative OpenRouter fallback chain respects the single shared deadline", async () => {
    // All OpenRouter attempts hang. With a 200s budget, the first few attempts
    // use the full 60s timeout, but the chain must stop when the shared budget
    // would not allow another useful attempt.
    mockFetch.mockImplementation(() => new Promise(() => {}));

    vi.useFakeTimers();
    try {
      const budgetMs = 200_000;
      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "gemini-2.5-flash", deadline: Date.now() + budgetMs },
      );

      await vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow(/Agent runtime budget exhausted/);
      // It should not have attempted all 5 OpenRouter models; the budget killed
      // it before the chain completed.
      expect(mockFetch.mock.calls.length).toBeLessThan(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates the entire fallback chain before the configured overall budget", async () => {
    // If the caller passes a short hard deadline, the chain must stop early
    // instead of blindly running through all OpenRouter fallbacks and Gemini.
    mockFetch.mockImplementation(() => new Promise(() => {})); // hangs

    vi.useFakeTimers();
    try {
      const budgetMs = 5_000;
      const promise = callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [],
        { model: "gemini-2.5-flash", deadline: Date.now() + budgetMs },
      );

      await vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow(/Agent runtime budget exhausted/);
      // Only the first OpenRouter attempt should run; the budget is exhausted
      // before it can try all 5 OpenRouter fallbacks or Gemini.
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
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeGeminiErrorResponse(429, "Too Many Requests"));
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [{ id: "write_file", description: "Write a file", inputSchema: { type: "object", properties: {}, required: [] } }],
      { model: "gemini-2.5-flash", deadline: Date.now() + 70_000 },
    );

    await expect(promise).rejects.toThrow(/Agent runtime budget exhausted/);
    // 5 OpenRouter attempts + 1 Gemini attempt.
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });

  it("succeeds through the Gemini direct fallback after all OpenRouter models fail", async () => {
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
      .mockResolvedValueOnce(makeErrorResponse(402, "Payment required"))
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
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolId).toBe("write_file");
  });
});
