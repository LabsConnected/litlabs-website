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

// Mock fetch to simulate provider failures
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
    // Fallback succeeds
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse("anthropic/claude-3.5-sonnet", "Fallback response."),
    );

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
      { model: "gpt-4o-nonexistent" },
    );

    expect(result.text).toBe("Fallback response.");
    expect(result.model).toBe("anthropic/claude-3.5-sonnet");
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
});
