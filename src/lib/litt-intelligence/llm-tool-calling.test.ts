import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the provider-neutral Basic router in callLLMWithTools.
 *
 * The router plans eligible routes from the provider registry (cost policy,
 * capabilities, credentials, health) and fails over between independent
 * providers — OpenRouter is one branch, not the backbone.
 *
 * Failure contract under test:
 *   - provider-scope failures (401/402/provider-403/timeout/429/5xx/network)
 *     stop the WHOLE provider for this call — no more models behind the
 *     same account
 *   - model-scope failures (400/404/model-403) advance to the provider's
 *     next candidate model
 *   - every attempt shares the caller's absolute deadline
 *   - all-route exhaustion throws AllRoutesFailedError (truthful, sanitized)
 */

// Mock braintrust logging
vi.mock("@/lib/evals/braintrust", () => ({
  logLLMCall: vi.fn(),
}));

// Mock siteConfig
vi.mock("@/lib/siteConfig", () => ({
  SITE_URL: "https://test.example.com",
}));

// Mock fetch to simulate provider responses
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  callLLMWithTools,
  buildAssistantToolCallMessage,
  buildToolResultMessage,
  AgentBudgetExhaustedError,
  AllRoutesFailedError,
  _setOllamaProbeForTests,
  type GeminiPart,
} from "./llm-tool-calling";
import {
  _resetProviderHealthForTests,
  getProviderHealth,
} from "./provider-registry";

// ─── Helpers ──────────────────────────────────────────────────────

const PROVIDER_ENVS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_AI_API_TOKEN",
  "OLLAMA_BASE_URL",
  "OLLAMA_HOST",
  "OLLAMA_HOST_PC",
  "LITT_OLLAMA_URL",
  "OLLAMA_MODEL",
  "OPENROUTER_MODEL",
  "GROQ_MODEL",
  "MISTRAL_MODEL",
  "CLOUDFLARE_AI_MODEL",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "VERCEL",
];

function clearProviderEnvs() {
  for (const key of PROVIDER_ENVS) vi.stubEnv(key, "");
  // Ollama is opt-in per test — never probed by default.
  vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
}

/** All fetch calls whose URL contains the given fragment. */
function callsTo(fragment: string) {
  return mockFetch.mock.calls.filter(([url]) => String(url).includes(fragment));
}

function lastBodyFor(fragment: string): Record<string, unknown> {
  const calls = callsTo(fragment);
  const init = calls[calls.length - 1][1] as { body: string };
  return JSON.parse(init.body);
}

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

function makeErrorResponse(status: number, message: string, headers?: Record<string, string>) {
  return {
    ok: false,
    status,
    headers: new Headers(headers),
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
    json: async () => ({ candidates: [{ content: { parts } }] }),
    text: async () => "",
  };
}

function makeGeminiErrorResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    headers: new Headers(),
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

const WRITE_TOOL = {
  id: "write_file",
  description: "Write a file",
  inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: [] },
};

beforeEach(() => {
  mockFetch.mockReset();
  _resetProviderHealthForTests();
  _setOllamaProbeForTests(null);
  vi.unstubAllEnvs();
  clearProviderEnvs();
});

afterEach(() => {
  _resetProviderHealthForTests();
  _setOllamaProbeForTests(null);
  vi.unstubAllEnvs();
});

// ─── Tests ────────────────────────────────────────────────────────

describe("callLLMWithTools — provider selection", () => {
  it("uses Gemini direct first when its credential is present", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch.mockResolvedValueOnce(makeGeminiSuccessResponse("Hello from Gemini."));

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
    );

    expect(result.text).toBe("Hello from Gemini.");
    expect(result.provider).toBe("gemini");
    expect(callsTo("generativelanguage")).toHaveLength(1);
    expect(callsTo("openrouter")).toHaveLength(0);
  });

  it("falls back from Gemini to OpenRouter free on a provider failure", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch
      .mockResolvedValueOnce(makeGeminiErrorResponse(500, "Internal error"))
      .mockResolvedValueOnce(makeSuccessResponse("openrouter/free", "OR free response."));

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
    );

    expect(result.text).toBe("OR free response.");
    expect(result.provider).toBe("openrouter");
    // The Basic route uses only the free router/model list — never a paid slug.
    expect(lastBodyFor("openrouter").model).toMatch(/:free$|^openrouter\/free$/);
  });

  it("skips providers with missing credentials entirely", async () => {
    // Only Groq configured — Gemini/OR/Mistral must not be attempted at all.
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    mockFetch.mockResolvedValueOnce(makeSuccessResponse("llama-3.3-70b-versatile", "Groq says hi."));

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
    );

    expect(result.provider).toBe("groq");
    expect(callsTo("generativelanguage")).toHaveLength(0);
    expect(callsTo("openrouter")).toHaveLength(0);
    expect(callsTo("groq")).toHaveLength(1);
  });

  it("never calls OpenRouter at all when no OpenRouter key exists", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    mockFetch.mockResolvedValueOnce(makeGeminiSuccessResponse("Gemini only."));

    await callLLMWithTools("sys", [{ role: "user", content: "hi" }], []);
    expect(callsTo("openrouter")).toHaveLength(0);
  });
});

describe("callLLMWithTools — pseudo-tool text is never executable", () => {
  it("keeps inline function-looking text as text and produces no tool call", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse(
        "llama-3.3-70b-versatile",
        '##[1/1] inspect_project_files(project_id="project-1")',
      ),
    );

    const result = await callLLMWithTools("system", [{ role: "user", content: "inspect the project" }], [WRITE_TOOL]);

    expect(result.text).toContain("inspect_project_files");
    expect(result.toolCalls).toHaveLength(0);
  });
});

describe("callLLMWithTools — failure classification and failover", () => {
  it("402 on OpenRouter disables the provider — no second OR model is attempted", async () => {
    // This is the golden-run-34720866763 regression: an account-level 402
    // must NOT fan out across five more OpenRouter models.
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Insufficient credits"))
      .mockResolvedValueOnce(makeSuccessResponse("llama-3.3-70b-versatile", "Groq handled it."));

    const result = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [],
    );

    expect(result.text).toBe("Groq handled it.");
    expect(result.provider).toBe("groq");
    // Exactly ONE OpenRouter call — provider stopped at account level.
    expect(callsTo("openrouter")).toHaveLength(1);
    expect(getProviderHealth("openrouter").state).toBe("disabled");
  });

  it("401 marks the credential invalid and moves to another provider", async () => {
    vi.stubEnv("GEMINI_API_KEY", "bad-gemini-key");
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    mockFetch
      .mockResolvedValueOnce(makeGeminiErrorResponse(401, "Invalid API key"))
      .mockResolvedValueOnce(makeSuccessResponse("llama-3.3-70b-versatile", "Groq took over."));

    const result = await callLLMWithTools("sys", [{ role: "user", content: "hi" }], []);

    expect(result.provider).toBe("groq");
    expect(callsTo("generativelanguage")).toHaveLength(1);
    expect(getProviderHealth("gemini").state).toBe("disabled");
  });

  it("provider-level 403 disables the provider; model-level 403 tries the next model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    vi.stubEnv("MISTRAL_API_KEY", "test-mistral-key");
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(403, "This model is not allowed"))
      .mockResolvedValueOnce(makeSuccessResponse("meta-llama/llama-3.3-70b-instruct:free", "Second OR model."));

    const result = await callLLMWithTools("sys", [{ role: "user", content: "hi" }], []);

    // Model-scoped 403 → second OR model attempted and succeeded.
    expect(result.provider).toBe("openrouter");
    expect(callsTo("openrouter")).toHaveLength(2);
    expect(getProviderHealth("openrouter").state).toBe("healthy");
  });

  it("429 applies a cooldown and routes around without sleeping", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("MISTRAL_API_KEY", "test-mistral-key");
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(429, "Rate limited", { "retry-after": "30" }))
      .mockResolvedValueOnce(makeErrorResponse(429, "Rate limited", { "retry-after": "30" }))
      .mockResolvedValueOnce(makeSuccessResponse("mistral-small-latest", "Mistral handled it."));

    const result = await callLLMWithTools("sys", [{ role: "user", content: "hi" }], []);

    expect(result.provider).toBe("mistral");
    const health = getProviderHealth("groq");
    expect(health.state).toBe("cooldown");
    expect(health.cooldownUntil).toBeGreaterThan(Date.now() + 25_000);
    // Both Groq models were tried (per-model limits don't poison siblings),
    // then the provider stopped — no third call.
    expect(callsTo("groq")).toHaveLength(2);
  });

  it("a per-model 429 fails over to the provider's next candidate model", async () => {
    // OpenRouter :free limits are per-model — a 429 on nemotron must not
    // poison the other five free candidates behind the same key.
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(429, "Rate limit exceeded: free-models-per-day"))
      .mockResolvedValueOnce(makeSuccessResponse("nvidia/nemotron-3-super-120b-a12b:free", "Second OR model handled it."));

    const result = await callLLMWithTools("sys", [{ role: "user", content: "hi" }], []);

    expect(result.provider).toBe("openrouter");
    expect(callsTo("openrouter")).toHaveLength(2);
    // The successful sibling clears the provider cooldown.
    expect(getProviderHealth("openrouter").state).toBe("healthy");
  });

  it("a rate-limited model is cooled individually so the next call skips it", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch
      // Call 1: first model 429s, second succeeds.
      .mockResolvedValueOnce(makeErrorResponse(429, "Rate limit exceeded"))
      .mockResolvedValueOnce(makeSuccessResponse("nvidia/nemotron-3-super-120b-a12b:free", "one"))
      // Call 2: the cooled first model is skipped — second model serves again.
      .mockResolvedValueOnce(makeSuccessResponse("nvidia/nemotron-3-super-120b-a12b:free", "two"));

    await callLLMWithTools("sys", [{ role: "user", content: "hi" }], []);
    const second = await callLLMWithTools("sys", [{ role: "user", content: "hi again" }], []);

    expect(second.provider).toBe("openrouter");
    // 2 calls in run 1 (429 + success) + 1 call in run 2 (first model
    // skipped via model cooldown — NOT retried into the same limit).
    expect(callsTo("openrouter")).toHaveLength(3);
  });

  it("a cooled-down provider is skipped entirely on the next call", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("MISTRAL_API_KEY", "test-mistral-key");
    mockFetch
      // Both Groq candidates 429 (account-level limit) → provider cooldown.
      .mockResolvedValueOnce(makeErrorResponse(429, "Rate limited", { "retry-after": "30" }))
      .mockResolvedValueOnce(makeErrorResponse(429, "Rate limited", { "retry-after": "30" }))
      .mockResolvedValueOnce(makeSuccessResponse("mistral-small-latest", "one"))
      .mockResolvedValueOnce(makeSuccessResponse("mistral-small-latest", "two"));

    await callLLMWithTools("sys", [{ role: "user", content: "hi" }], []);
    const second = await callLLMWithTools("sys", [{ role: "user", content: "hi again" }], []);

    expect(second.provider).toBe("mistral");
    // Still only the two first-call Groq attempts — cooldown persisted.
    expect(callsTo("groq")).toHaveLength(2);
  });

  it("a hanging provider attempt times out and the next provider continues", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch
      .mockImplementationOnce(() => new Promise(() => {})) // Gemini hangs
      .mockResolvedValueOnce(makeSuccessResponse("openrouter/free", "OR picked it up."));

    vi.useFakeTimers();
    try {
      const promise = callLLMWithTools("sys", [{ role: "user", content: "hi" }], []);
      await vi.advanceTimersByTimeAsync(30_000 + 1);
      const result = await promise;

      expect(result.provider).toBe("openrouter");
      expect(callsTo("generativelanguage")).toHaveLength(1);
      expect(getProviderHealth("gemini").state).toBe("degraded");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a thrown network error falls through to the next provider", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch
      .mockRejectedValueOnce(new Error("fetch failed: connection refused"))
      .mockResolvedValueOnce(makeSuccessResponse("openrouter/free", "Network fallback."));

    const result = await callLLMWithTools("sys", [{ role: "user", content: "hi" }], []);
    expect(result.text).toBe("Network fallback.");
  });

  it("a provider-scope failure never retries more models behind the same provider", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch.mockResolvedValue(makeErrorResponse(500, "Server error"));

    await expect(callLLMWithTools("sys", [{ role: "user", content: "hi" }], []))
      .rejects.toThrow(AllRoutesFailedError);
    // One OR attempt only — a 500 is provider-scope.
    expect(callsTo("openrouter")).toHaveLength(1);
  });
});

describe("callLLMWithTools — empty provider payloads", () => {
  it("a well-formed empty completion is a bad_response model failure that fails over", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch
      // Both Gemini models return candidates with no text and no calls.
      .mockResolvedValueOnce(makeGeminiRawResponse([]))
      .mockResolvedValueOnce(makeGeminiRawResponse([]))
      .mockResolvedValueOnce(makeSuccessResponse("openrouter/free", "Recovered."));

    const result = await callLLMWithTools(
      "sys",
      [{ role: "user", content: "hi" }],
      [],
    );

    expect(result.text).toBe("Recovered.");
    expect(result.provider).toBe("openrouter");
    expect(callsTo("generativelanguage")).toHaveLength(2);
  });

  it("an OpenAI-compatible empty completion (no content, no tool_calls) advances to the next model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch
      .mockResolvedValueOnce(makeSuccessResponse("openrouter/free", ""))
      .mockResolvedValueOnce(makeSuccessResponse("openrouter/free", "Second model answered."));

    const result = await callLLMWithTools(
      "sys",
      [{ role: "user", content: "hi" }],
      [],
    );

    expect(result.text).toBe("Second model answered.");
    expect(callsTo("openrouter")).toHaveLength(2);
  });

  it("when every route returns empty payloads the call throws AllRoutesFailedError classified bad_response", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    // Groq has two candidate models — both return empty completions.
    mockFetch.mockResolvedValue(makeSuccessResponse("openai/gpt-oss-120b", ""));

    const err = await callLLMWithTools(
      "sys",
      [{ role: "user", content: "hi" }],
      [],
    ).catch((e) => e);

    expect(err).toBeInstanceOf(AllRoutesFailedError);
    expect(err.failures.length).toBeGreaterThan(0);
    expect(err.failures.every((f: { class: string }) => f.class === "bad_response")).toBe(true);
    expect(err.userMessage).toMatch(/all currently available AI routes/i);
    // Nothing reported success — no fake text.
    expect(err.failures.every((f: { message: string }) => /empty completion/.test(f.message))).toBe(true);
  });
});

describe("callLLMWithTools — text-format tool-call markup (P0-B)", () => {
  // Production evidence: a model answered with literal
  //   <tool_call>terminal<arg_key>command</arg_key>…</tool_call>
  // which was persisted as assistant prose while the run reported
  // `completed` — no tool executed. Invocation-intent markup is a
  // model-level protocol failure: fail over, or fail truthfully.

  const PRODUCTION_MARKUP =
    "I need to read the current `index.html` to find the exact `</title>` line. Let me inspect the file first.\n" +
    "<tool_call>terminal\n<arg_key>command</arg_key>\n<arg_value>cat -n index.html</arg_value>" +
    "<arg_key>project_id</arg_key>\n<arg_value>f79fae8d-62f5-405d-b933-3d49a58acc61</arg_value>\n</tool_call>";

  it("fails over to a sibling model when the first model emits <tool_call> markup", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    // First OpenRouter model returns text-format markup; the sibling model
    // returns a proper structured tool call.
    mockFetch
      .mockResolvedValueOnce(makeSuccessResponse("m1", PRODUCTION_MARKUP))
      .mockResolvedValueOnce(
        makeSuccessResponse("m2", "", [
          { id: "call_1", type: "function", function: { name: "write_file", arguments: '{"path":"a.txt","content":"x"}' } },
        ]),
      );

    const result = await callLLMWithTools(
      "sys",
      [{ role: "user", content: "read the file" }],
      [WRITE_TOOL],
    );

    // The structured call from the SECOND model wins — markup never
    // becomes the response text.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolId).toBe("write_file");
    expect(result.text).not.toContain("<tool_call>");
    expect(callsTo("openrouter").length).toBe(2);
  });

  it("throws AllRoutesFailedError classified tool_call_parse_failed when every route emits markup", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    mockFetch.mockResolvedValue(makeSuccessResponse("any", PRODUCTION_MARKUP));

    const err = await callLLMWithTools(
      "sys",
      [{ role: "user", content: "hi" }],
      [WRITE_TOOL],
    ).catch((e) => e);

    expect(err).toBeInstanceOf(AllRoutesFailedError);
    expect(err.failures.length).toBeGreaterThan(0);
    expect(err.failures.every((f: { class: string }) => f.class === "tool_call_parse_failed")).toBe(true);
    // No tool executed and no markup was returned as text — the error is
    // the truthful terminal state, not a fake completion.
    expect(err.userMessage).toMatch(/all currently available AI routes/i);
  });

  it("classifies markup on the Gemini adapter the same way", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    mockFetch.mockResolvedValue(makeGeminiSuccessResponse(PRODUCTION_MARKUP));

    const err = await callLLMWithTools(
      "sys",
      [{ role: "user", content: "hi" }],
      [WRITE_TOOL],
    ).catch((e) => e);

    expect(err).toBeInstanceOf(AllRoutesFailedError);
    expect(err.failures[0].class).toBe("tool_call_parse_failed");
  });

  it("does not flag prose that merely quotes tool markup", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    mockFetch.mockResolvedValue(
      makeSuccessResponse(
        "any",
        "Models sometimes emit `<tool_call>example</tool_call>` instead of structured calls — yours is fine.",
      ),
    );

    const result = await callLLMWithTools("sys", [{ role: "user", content: "hi" }], [WRITE_TOOL]);
    expect(result.text).toContain("<tool_call>");
    expect(result.toolCalls).toHaveLength(0);
  });
});

describe("callLLMWithTools — deadline and abort", () => {
  it("does not start any provider call when the shared deadline is already exhausted", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    mockFetch.mockResolvedValue(makeGeminiSuccessResponse("Never used."));

    await expect(
      callLLMWithTools("sys", [{ role: "user", content: "hi" }], [], { deadlineMs: Date.now() - 1 }),
    ).rejects.toThrow(AgentBudgetExhaustedError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("the whole chain shares one absolute deadline — a short budget stops it early", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch.mockImplementation(() => new Promise(() => {})); // every call hangs

    vi.useFakeTimers();
    try {
      const promise = callLLMWithTools(
        "sys",
        [{ role: "user", content: "hi" }],
        [],
        { deadlineMs: Date.now() + 5_000 },
      );
      const assertion = expect(promise).rejects.toThrow(AgentBudgetExhaustedError);
      await vi.runAllTimersAsync();
      await assertion;
      // Only the first attempt ran — the budget died before any fallback.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects immediately when the upstream signal is already aborted", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    const controller = new AbortController();
    controller.abort();

    await expect(
      callLLMWithTools("sys", [{ role: "user", content: "hi" }], [], { signal: controller.signal }),
    ).rejects.toThrow(/aborted by upstream/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("an upstream abort mid-request stops the entire chain", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const promise = callLLMWithTools(
        "sys",
        [{ role: "user", content: "hi" }],
        [],
        { signal: controller.signal },
      );
      const assertion = expect(promise).rejects.toThrow(/aborted by upstream/);

      await vi.advanceTimersByTimeAsync(5_000);
      controller.abort();
      await vi.advanceTimersByTimeAsync(5_000);

      await assertion;
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("callLLMWithTools — Ollama local route", () => {
  it("completes via Ollama when every cloud provider is unavailable", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "");
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
    _setOllamaProbeForTests(async () => ["llama3.1:8b", "phi3:mini"]);

    mockFetch
      .mockResolvedValueOnce(makeGeminiErrorResponse(500, "Gemini down"))
      .mockResolvedValueOnce(makeErrorResponse(402, "OpenRouter out of credits"))
      .mockResolvedValueOnce(makeSuccessResponse("llama3.1:8b", "Local model handled it."));

    const result = await callLLMWithTools("sys", [{ role: "user", content: "hi" }], [WRITE_TOOL]);

    expect(result.provider).toBe("ollama");
    expect(result.text).toBe("Local model handled it.");
    // The Ollama call went to the OpenAI-compatible local endpoint with the
    // tool-capable model picked from the probe.
    const ollamaCalls = callsTo("localhost:11434/v1/chat/completions");
    expect(ollamaCalls).toHaveLength(1);
    expect(lastBodyFor("localhost:11434").model).toBe("llama3.1:8b");
  });

  it("skips Ollama when no tool-capable local model is loaded", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "");
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
    _setOllamaProbeForTests(async () => ["gemma2:2b"]); // not tool-capable

    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "Groq credits"))
      .mockResolvedValueOnce(makeSuccessResponse("x", "unreachable"));

    await expect(
      callLLMWithTools("sys", [{ role: "user", content: "hi" }], [WRITE_TOOL]),
    ).rejects.toThrow(AllRoutesFailedError);
    // Ollama never got a chat call — probe found no tool-capable model.
    expect(callsTo("localhost:11434/v1")).toHaveLength(0);
  });
});

describe("callLLMWithTools — BYOK", () => {
  it("uses a user-supplied OpenAI key only when explicitly provided", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "credits"))
      .mockResolvedValueOnce(makeSuccessResponse("gpt-4o", "BYOK handled it."));

    const result = await callLLMWithTools(
      "sys",
      [{ role: "user", content: "hi" }],
      [],
      { userApiKey: "sk-user-provided-key", byokProvider: "openai" },
    );

    expect(result.provider).toBe("byok");
    const byokCall = callsTo("api.openai.com")[0];
    expect(byokCall).toBeDefined();
    const headers = (byokCall[1] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe("Bearer sk-user-provided-key");
  });

  it("never touches a paid user route without a user key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch.mockResolvedValue(makeErrorResponse(402, "credits"));

    await expect(callLLMWithTools("sys", [{ role: "user", content: "hi" }], []))
      .rejects.toThrow(AllRoutesFailedError);
    expect(callsTo("api.openai.com")).toHaveLength(0);
  });
});

describe("callLLMWithTools — exhaustion and privacy", () => {
  it("throws AllRoutesFailedError with structured per-attempt failures", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch.mockResolvedValue(makeErrorResponse(500, "down"));

    try {
      await callLLMWithTools("sys", [{ role: "user", content: "hi" }], []);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AllRoutesFailedError);
      const e = err as AllRoutesFailedError;
      expect(e.message).toMatch(/All tool-calling models failed/);
      expect(e.failures.length).toBeGreaterThanOrEqual(2);
      expect(e.failures.map((f) => f.provider)).toContain("gemini");
      expect(e.failures.map((f) => f.provider)).toContain("openrouter");
      expect(e.userMessage).toMatch(/AI routes/i);
    }
  });

  it("throws AllRoutesFailedError without any fetch when no provider is eligible", async () => {
    // No keys at all, ollama disabled.
    try {
      await callLLMWithTools("sys", [{ role: "user", content: "hi" }], []);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AllRoutesFailedError);
      const e = err as AllRoutesFailedError;
      expect(e.failures).toHaveLength(0);
      expect(e.excluded.length).toBeGreaterThan(0);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never leaks secret values into thrown errors", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-SECRET-9f8e7d");
    vi.stubEnv("OPENROUTER_API_KEY", "or-SECRET-a1b2c3");
    vi.stubEnv("GROQ_API_KEY", "groq-SECRET-z9y8");
    mockFetch.mockResolvedValue(
      makeErrorResponse(401, "invalid credential sk-leaked123 Bearer abc"),
    );

    try {
      await callLLMWithTools("sys", [{ role: "user", content: "hi" }], []);
      expect.unreachable("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain("gemini-SECRET-9f8e7d");
      expect(msg).not.toContain("or-SECRET-a1b2c3");
      expect(msg).not.toContain("groq-SECRET-z9y8");
      expect(msg).not.toContain("sk-leaked123");
      expect(msg).not.toContain("Bearer abc");
    }
  });

  it("parses tool calls from an OpenAI-compatible response", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    mockFetch.mockResolvedValueOnce(
      makeSuccessResponse("llama-3.3-70b-versatile", "Let me write that.", [
        {
          id: "call_123",
          type: "function",
          function: {
            name: "write_file",
            arguments: JSON.stringify({ path: "test.txt", content: "hello" }),
          },
        },
      ]),
    );

    const result = await callLLMWithTools(
      "sys",
      [{ role: "user", content: "Write test.txt" }],
      [WRITE_TOOL],
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolCallId).toBe("call_123");
    expect(result.toolCalls[0].toolId).toBe("write_file");
    expect(result.toolCalls[0].inputs).toEqual({ path: "test.txt", content: "hello" });
  });
});

describe("cross-provider transcript round-trip", () => {
  it("a tool call from Gemini and its result feed correctly into OpenRouter", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");

    // Turn 1: Gemini emits a functionCall.
    mockFetch.mockResolvedValueOnce(
      makeGeminiSuccessResponse("I will write the file.", [
        { name: "write_file", args: { path: "test.txt", content: "hi" } },
      ]),
    );
    const first = await callLLMWithTools(
      "sys",
      [{ role: "user", content: "write test.txt" }],
      [WRITE_TOOL],
    );
    expect(first.provider).toBe("gemini");
    expect(first.toolCalls[0].toolId).toBe("write_file");
    const toolCallId = first.toolCalls[0].toolCallId;

    // Agent executes the tool, records the result in the shared transcript.
    const transcript = [
      { role: "user" as const, content: "write test.txt" },
      buildAssistantToolCallMessage(first.toolCalls, first.text, first.rawParts),
      buildToolResultMessage({
        toolCallId,
        toolId: "write_file",
        result: { path: "test.txt", written: true },
        success: true,
      }),
    ];

    // Turn 2: Gemini is now down (degraded/disabled) → OpenRouter continues
    // with the SAME transcript including the completed tool result.
    mockFetch
      .mockResolvedValueOnce(makeGeminiErrorResponse(500, "Gemini exploded"))
      .mockResolvedValueOnce(makeSuccessResponse("openrouter/free", "File written."));

    const second = await callLLMWithTools("sys", transcript, [WRITE_TOOL]);
    expect(second.provider).toBe("openrouter");

    // The OpenRouter request must carry the assistant tool_calls and the
    // tool result with the same correlation id.
    const body = lastBodyFor("openrouter");
    const messages = body.messages as Array<Record<string, unknown>>;
    const assistantMsg = messages.find((m) => m.role === "assistant");
    const toolMsg = messages.find((m) => m.role === "tool");
    expect(assistantMsg!.tool_calls).toEqual([
      {
        id: toolCallId,
        type: "function",
        function: { name: "write_file", arguments: JSON.stringify({ path: "test.txt", content: "hi" }) },
      },
    ]);
    expect(toolMsg!.tool_call_id).toBe(toolCallId);
    expect(toolMsg!.content).toContain("test.txt");
    // No Gemini-specific parts leak into the OpenRouter wire payload.
    for (const m of messages) expect(m.parts).toBeUndefined();
  });
});

describe("Gemini conversation history round-trip", () => {
  it("preserves thoughtSignature from one Gemini turn to the next", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    const firstParts: GeminiPart[] = [
      { text: "I will create the file." },
      { functionCall: { id: "call_abc", name: "write_file", args: { path: "test.txt" } }, thoughtSignature: "sig_model_1" },
    ];
    const tools = [WRITE_TOOL];

    mockFetch.mockResolvedValueOnce(makeGeminiRawResponse(firstParts));
    const firstResult = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      tools,
    );
    expect(firstResult.rawParts).toEqual(firstParts);

    const assistantMessage = buildAssistantToolCallMessage(firstResult.toolCalls, firstResult.text, firstResult.rawParts);
    const toolResult = buildToolResultMessage({ toolCallId: firstResult.toolCalls[0].toolCallId, toolId: firstResult.toolCalls[0].toolId, result: { ok: true }, success: true });
    const nextMessages = [
      { role: "user" as const, content: "Now commit that file" },
      { role: "assistant" as const, content: assistantMessage.content, parts: assistantMessage.parts },
      toolResult,
    ];

    const secondParts: GeminiPart[] = [{ text: "Done." }];
    mockFetch.mockResolvedValueOnce(makeGeminiRawResponse(secondParts));
    await callLLMWithTools("You are LiTT.", nextMessages, tools);

    const body = lastBodyFor("generativelanguage");
    type GeminiContent = { role: string; parts?: GeminiPart[] };
    const assistantContent = (body.contents as GeminiContent[]).find((c) => c.role === "model");
    const toolResultContent = (body.contents as GeminiContent[]).find((c) => c.role === "user" && c.parts?.some((p: GeminiPart) => p.functionResponse));

    expect(assistantContent?.parts).toEqual(firstParts);
    expect(toolResultContent?.parts).toEqual([
      { functionResponse: { name: "write_file", response: { ok: true } } },
    ]);
    for (const c of body.contents as GeminiContent[]) {
      expect((c as Record<string, unknown>).tool_calls).toBeUndefined();
      expect((c as Record<string, unknown>).tool_call_id).toBeUndefined();
    }
  });
});

describe("OpenRouter conversation history round-trip", () => {
  it("preserves assistant tool_calls and tool result tool_call_id in the next request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const toolCallId = "call_test_123";
    const toolInputs = { path: "test.txt", content: "hello" };
    mockFetch.mockResolvedValueOnce(makeSuccessResponse("openrouter/free", "I will write the file.", [
      { id: toolCallId, type: "function", function: { name: "write_file", arguments: JSON.stringify(toolInputs) } },
    ]));

    const firstResult = await callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Write a file" }],
      [WRITE_TOOL],
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

    mockFetch.mockResolvedValueOnce(makeSuccessResponse("openrouter/free", "Done."));
    await callLLMWithTools("You are LiTT.", nextMessages, []);

    const body = lastBodyFor("openrouter");
    const messages = body.messages as Array<Record<string, unknown>>;
    const assistantMsg = messages.find((m) => m.role === "assistant");
    const toolMsg = messages.find((m) => m.role === "tool");

    expect(assistantMsg!.tool_calls).toEqual([
      { id: toolCallId, type: "function", function: { name: "write_file", arguments: JSON.stringify(toolInputs) } },
    ]);
    expect(toolMsg!.tool_call_id).toBe(toolCallId);
    expect(toolMsg!.content).toBe(JSON.stringify({ ok: true }));
    for (const m of messages) {
      expect(m.parts).toBeUndefined();
    }
  });
});

describe("buildToolResultMessage", () => {
  it("produces an OpenAI-compatible tool message and a Gemini functionResponse part", () => {
    const result = buildToolResultMessage({ toolCallId: "call_1", toolId: "project.scan", result: { found: 1 }, success: true });
    expect(result.role).toBe("tool");
    expect(result.tool_call_id).toBe("call_1");
    expect(result.content).toBe(JSON.stringify({ found: 1 }));
    expect(result.parts).toEqual([
      { functionResponse: { name: "project_scan", response: { found: 1 } } },
    ]);
  });
});
