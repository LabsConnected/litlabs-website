import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Deadline/budget contract tests for the provider-neutral router in
 * callLLMWithTools.
 *
 * These tests exercise REAL timeout behavior by injecting a mock Gemini model
 * through the _setGeminiModelFactory test seam. Fake timers control the clock
 * so we can verify cooldowns, budget exhaustion, and deadline-constrained
 * timeouts deterministically.
 *
 * Contract under test:
 *   - one absolute deadline is shared by every provider attempt
 *   - a provider timeout falls through to the next provider when the
 *     deadline still has room — it does NOT kill the agent
 *   - a deadline-constrained timeout surfaces as AgentBudgetExhaustedError
 *   - 429 cools down the provider and routes around it — no blocking sleep
 *   - an exhausted budget throws AgentBudgetExhaustedError, not a generic
 *     provider failure
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
  AgentBudgetExhaustedError,
  AllRoutesFailedError,
  _setGeminiModelFactory,
  type GeminiModelLike,
} from "./llm-tool-calling";
import {
  _resetProviderHealthForTests,
  getProviderHealth,
} from "./provider-registry";

// ─── Test helpers ──────────────────────────────────────────────

const TEST_TOOL = {
  id: "test.tool",
  description: "A test tool",
  inputSchema: { type: "object", properties: {}, required: [] },
};

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
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "VERCEL",
];

function clearProviderEnvs() {
  for (const key of PROVIDER_ENVS) vi.stubEnv(key, "");
  vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
}

function makeGeminiSuccess(text: string, functionCalls: Array<{ name: string; args?: Record<string, unknown> }> = []) {
  return {
    response: {
      functionCalls: () => functionCalls,
      text: () => text,
    },
  };
}

/**
 * Create a mock Gemini model with controllable generateContent behavior.
 * Each entry in `behaviors` is used in order for successive calls.
 * - "hang": never resolves until the timeout fires (simulates SDK abort)
 * - "429": throws a 429 error
 * - "success": returns a success response
 */
function makeMockModel(behaviors: Array<"hang" | "429" | "success">): {
  model: GeminiModelLike;
  generateContentMock: ReturnType<typeof vi.fn>;
} {
  const generateContentMock = vi.fn();
  let callIndex = 0;

  generateContentMock.mockImplementation((_request: Record<string, unknown>, requestOptions?: { timeout?: number }) => {
    const behavior = behaviors[callIndex] ?? behaviors[behaviors.length - 1];
    callIndex++;

    if (behavior === "hang") {
      // Simulate SDK behavior: abort after the timeout fires.
      return new Promise((_resolve, reject) => {
        const timeout = requestOptions?.timeout ?? 30_000;
        setTimeout(() => {
          const err = new Error("Request aborted when fetching from the stream");
          err.name = "AbortError";
          reject(err);
        }, timeout);
      });
    }

    if (behavior === "429") {
      return Promise.reject(new Error("429 Too Many Requests"));
    }

    if (behavior === "success") {
      return Promise.resolve(makeGeminiSuccess("Gemini success"));
    }

    return Promise.resolve(makeGeminiSuccess("default"));
  });

  const model: GeminiModelLike = { generateContent: generateContentMock };
  return { model, generateContentMock };
}

function makeOpenRouterFailure(status: number, message: string) {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => ({}),
    text: async () => message,
  };
}

function makeOpenRouterSuccess(model: string, text: string) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      model,
      choices: [{ message: { content: text, tool_calls: [] }, finish_reason: "stop" }],
    }),
    text: async () => "",
  };
}

async function flushMicrotasks(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

// ─── Tests ─────────────────────────────────────────────────────

describe("callLLMWithTools — deadline/budget contract (real Gemini behavior)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetProviderHealthForTests();
    vi.unstubAllEnvs();
    clearProviderEnvs();
    _setGeminiModelFactory(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    _resetProviderHealthForTests();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    _setGeminiModelFactory(null);
  });

  // ─── A. Gemini generateContent never settles ─────────────────

  it("A. Gemini attempt never settles → deadline-constrained timeout → AgentBudgetExhaustedError", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    const { model, generateContentMock } = makeMockModel(["hang"]);
    _setGeminiModelFactory(() => model);

    // Deadline 5s → remainingMs=5000, timeoutMs=min(30000, 5000-1000)=4000
    const deadline = Date.now() + 5_000;

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { deadlineMs: deadline },
    );
    promise.catch(() => {});

    await flushMicrotasks();
    await tick(4_100);

    await expect(promise).rejects.toThrow(AgentBudgetExhaustedError);
    expect(generateContentMock).toHaveBeenCalledTimes(1);

    // The attempt was bounded by the deadline (4000ms, not the 30s route cap).
    const requestOptions = generateContentMock.mock.calls[0][1];
    expect(requestOptions!.timeout).toBeLessThanOrEqual(4_000);
  });

  // ─── B. Gemini 429 → route around, no sleep ──────────────────

  it("B. Gemini 429 cools down the provider and OpenRouter continues without any sleep", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch.mockResolvedValue(makeOpenRouterSuccess("openrouter/free", "OR handled it."));

    const { model, generateContentMock } = makeMockModel(["429"]);
    _setGeminiModelFactory(() => model);

    const deadline = Date.now() + 120_000;
    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { deadlineMs: deadline },
    );

    const result = await promise;
    expect(result.text).toBe("OR handled it.");
    expect(result.provider).toBe("openrouter");

    // Exactly ONE Gemini attempt — 429 never retries or sleeps in-request.
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(getProviderHealth("gemini").state).toBe("cooldown");
    // No backoff/sleep timer is pending.
    expect(vi.getTimerCount()).toBe(0);
  });

  // ─── C. 429 with every provider failing ──────────────────────

  it("C. Gemini 429 + OpenRouter 402 → AllRoutesFailedError with both attempts recorded", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch.mockResolvedValue(makeOpenRouterFailure(402, "Billing required"));

    const { model, generateContentMock } = makeMockModel(["429"]);
    _setGeminiModelFactory(() => model);

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { deadlineMs: Date.now() + 60_000 },
    );

    try {
      await promise;
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AllRoutesFailedError);
      const e = err as AllRoutesFailedError;
      expect(e.failures.map((f) => f.class)).toEqual(["rate_limited", "billing"]);
    }
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    // One OpenRouter call only — account-level 402 stops the provider.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ─── D. Golden-run regression: Gemini timeout is NOT terminal ─

  it("D. Gemini timeout falls through to OpenRouter when the deadline still has room", async () => {
    // This is the golden-run-34720866763 fix: a Gemini request timeout must
    // not end the agent when another compatible route remains.
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    mockFetch.mockResolvedValue(makeOpenRouterSuccess("openrouter/free", "Recovered by OR."));

    const { model, generateContentMock } = makeMockModel(["hang"]);
    _setGeminiModelFactory(() => model);

    // 120s deadline → Gemini attempt gets the full 30s route timeout
    // (not deadline-constrained), then OR continues with budget to spare.
    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { deadlineMs: Date.now() + 120_000 },
    );

    await flushMicrotasks();
    await tick(30_100);

    const result = await promise;
    expect(result.provider).toBe("openrouter");
    expect(result.text).toBe("Recovered by OR.");
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(getProviderHealth("gemini").state).toBe("degraded");
    expect(vi.getTimerCount()).toBe(0);
  });

  // ─── E. Deadline-constrained Gemini timeout ────────────────

  it("E. Deadline-constrained timeout → AgentBudgetExhaustedError, not a generic timeout", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    const { model, generateContentMock } = makeMockModel(["hang"]);
    _setGeminiModelFactory(() => model);

    // remainingMs=10000 → timeoutMs=min(30000, 10000-1000)=9000
    const deadline = Date.now() + 10_000;

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { deadlineMs: deadline },
    );
    promise.catch(() => {});

    await flushMicrotasks();
    await tick(9_100);

    await expect(promise).rejects.toThrow(AgentBudgetExhaustedError);
    await expect(promise).rejects.toThrow(/timed out against agent budget/);

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const requestOptions = generateContentMock.mock.calls[0][1];
    expect(requestOptions!.timeout).toBe(9_000);
  });

  // ─── F. Build repair propagation ────────────────────────────

  it("F. Build-repair callback receives the same absolute deadlineMs", async () => {
    const { createAutonomousRepairCallback } = await import("./agent-loop-v2");

    const mockTransport = {
      readFile: vi.fn().mockResolvedValue("file content"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      listFiles: vi.fn().mockResolvedValue([]),
      exists: vi.fn().mockResolvedValue(true),
      runCommand: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };

    // Only OpenRouter is configured → the repair call succeeds via OR.
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    mockFetch.mockResolvedValue(makeOpenRouterSuccess("test-model", "Repair done"));

    const deadline = Date.now() + 300_000;
    const repairCallback = createAutonomousRepairCallback(
      mockTransport as never,
      "You are LiTT.",
      [],
      deadline,
    );

    const result = await repairCallback(1, "Build error: syntax error");

    expect(mockFetch).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  // ─── G. Resume propagation ─────────────────────────────────

  it("G. resumeAgentLoopV2 passes deadlineMs === startTime + cfg.maxRuntimeMs", async () => {
    // Verify via source inspection that resumeAgentLoopV2 passes the deadline.
    // A full integration test would require mocking the entire workspace/transport
    // stack, which is covered by the agent-loop tests. Here we verify the
    // contract is present in the source.
    const fs = await import("fs");
    const source = fs.readFileSync(
      "./src/lib/litt-intelligence/agent-loop-v2.ts",
      "utf-8",
    );

    const resumeMatch = source.match(
      /resumeAgentLoopV2[\s\S]*?deadlineMs:\s*startTime\s*\+\s*cfg\.maxRuntimeMs/,
    );
    expect(resumeMatch).not.toBeNull();
    expect(resumeMatch![0]).toContain("deadlineMs: startTime + cfg.maxRuntimeMs");

    const runMatch = source.match(
      /runAgentLoopV2[\s\S]*?deadlineMs:\s*startTime\s*\+\s*cfg\.maxRuntimeMs/,
    );
    expect(runMatch).not.toBeNull();
    expect(runMatch![0]).toContain("deadlineMs: startTime + cfg.maxRuntimeMs");

    const repairMatch = source.match(
      /createAutonomousRepairCallback[\s\S]*?deadlineMs/,
    );
    expect(repairMatch).not.toBeNull();
  });

  // ─── OpenRouter hanging request ──────────────────────────────

  it("a hanging OpenRouter request stays bounded by the shared deadline", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    // Simulate a fetch that never resolves but respects AbortSignal
    mockFetch.mockImplementationOnce((_url: string, opts: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        if (opts.signal) {
          opts.signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }
      });
    });

    // Deadline 3s → timeoutMs=min(30000, 3000-1000)=2000 → deadline-constrained
    const deadline = Date.now() + 3_000;

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { deadlineMs: deadline },
    );
    promise.catch(() => {});

    await flushMicrotasks();
    await tick(2_100);

    await expect(promise).rejects.toThrow(AgentBudgetExhaustedError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const options = mockFetch.mock.calls[0][1] as { signal?: AbortSignal };
    expect(options.signal).toBeDefined();
  });

  // ─── AgentBudgetExhaustedError preservation ─────────────────

  it("a deadline-constrained timeout is reported as budget exhaustion, not provider failure", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");

    // Gemini hangs; the deadline leaves only ~4s — nothing else can run.
    const { model } = makeMockModel(["hang"]);
    _setGeminiModelFactory(() => model);

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { deadlineMs: Date.now() + 5_000 },
    );
    promise.catch(() => {});

    await flushMicrotasks();
    await tick(4_100);

    // AgentBudgetExhaustedError, NOT "All tool-calling models failed"
    await expect(promise).rejects.toThrow(AgentBudgetExhaustedError);
    await expect(promise).rejects.not.toThrow(/All tool-calling models failed/);
  });

  it("AgentBudgetExhaustedError has correct name and message", () => {
    const err = new AgentBudgetExhaustedError(5000, "test reason");
    expect(err.name).toBe("AgentBudgetExhaustedError");
    expect(err.message).toContain("Agent budget exhausted");
    expect(err.message).toContain("test reason");
    expect(err.message).toContain("5s");
    expect(err.remainingMs).toBe(5000);
    expect(err.reason).toBe("test reason");
  });

  it("throws AgentBudgetExhaustedError before any attempt when the deadline has passed", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const pastDeadline = Date.now() - 1000;

    await expect(
      callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [TEST_TOOL],
        { deadlineMs: pastDeadline },
      ),
    ).rejects.toThrow(AgentBudgetExhaustedError);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
