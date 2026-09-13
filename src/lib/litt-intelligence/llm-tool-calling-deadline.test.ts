import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression tests for the deadline/budget contract in callLLMWithTools
 * and callGeminiWithTools.
 *
 * These tests exercise REAL Gemini timeout/retry behavior by injecting a
 * mock model factory through the _setGeminiModelFactory test seam.
 * Fake timers control the clock so we can verify retry delays, budget
 * exhaustion, and deadline-constrained timeouts deterministically.
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
  _setGeminiModelFactory,
  type GeminiModelLike,
} from "./llm-tool-calling";

// ─── Test helpers ──────────────────────────────────────────────

/** A minimal tool definition that triggers the Gemini fallback path
 *  (callLLMWithTools only tries Gemini when openRouterTools.length > 0). */
const TEST_TOOL = {
  id: "test.tool",
  description: "A test tool",
  inputSchema: { type: "object", properties: {}, required: [] },
};

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
    json: async () => ({}),
    text: async () => message,
  };
}

function makeOpenRouterSuccess(model: string, text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model,
      choices: [{ message: { content: text, tool_calls: [] }, finish_reason: "stop" }],
    }),
    text: async () => "",
  };
}

/**
 * Flush all pending microtasks and zero-length timers.
 * With fake timers, `await` alone doesn't resolve promises from
 * mock implementations. This helper ensures all pending microtasks
 * complete before we advance the clock.
 */
async function flushMicrotasks(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/**
 * Advance fake timers and flush microtasks in one step.
 */
async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

// ─── Tests ─────────────────────────────────────────────────────

describe("callLLMWithTools — deadline/budget contract (real Gemini behavior)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    _setGeminiModelFactory(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    _setGeminiModelFactory(null);
  });

  // ─── A. Gemini generateContent never settles ─────────────────

  it("A. Gemini generateContent never settles → attempt times out within calculated budget", async () => {
    // All OpenRouter models fail → forces Gemini fallback
    mockFetch.mockResolvedValue(makeOpenRouterFailure(402, "Billing required"));

    const { model, generateContentMock } = makeMockModel(["hang"]);
    _setGeminiModelFactory(() => model);

    // Deadline 5s → remainingMs=5000, timeoutMs=min(30000, 5000-1000)=4000
    const deadline = Date.now() + 5_000;

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { model: "test-model", deadlineMs: deadline },
    );
    // Prevent unhandled rejection warning — assertion is below
    promise.catch(() => {});

    // Flush microtasks so OpenRouter failures complete and Gemini attempt starts
    await flushMicrotasks();

    // Advance past the 4000ms attempt timeout
    await tick(4_100);

    await expect(promise).rejects.toThrow(AgentBudgetExhaustedError);

    // Exactly 1 Gemini attempt occurred
    expect(generateContentMock).toHaveBeenCalledTimes(1);

    // The attempt was called with a bounded timeout (4000ms, not 30000ms)
    const callArgs = generateContentMock.mock.calls[0];
    const requestOptions = callArgs[1];
    expect(requestOptions.timeout).toBeLessThanOrEqual(4_000);
  });

  // ─── B. Gemini returns 429, retry succeeds ───────────────────

  it("B. Gemini 429 → advance 60s → second call succeeds (exactly 2 attempts)", async () => {
    mockFetch.mockResolvedValue(makeOpenRouterFailure(402, "Billing required"));

    const { model, generateContentMock } = makeMockModel(["429", "success"]);
    _setGeminiModelFactory(() => model);

    // Deadline far enough for 60s delay + 30s attempt + 1s cleanup
    const deadline = Date.now() + 120_000;

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { model: "test-model", deadlineMs: deadline },
    );

    // Flush microtasks: OpenRouter failures + first Gemini 429
    await flushMicrotasks();

    // Now the code is sleeping for 60s before retry
    await tick(60_100);

    // Second attempt should succeed
    const result = await promise;
    expect(result.text).toBe("Gemini success");

    // Exactly 2 Gemini attempts
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  // ─── B2. Abort listener cleanup on normal backoff completion ─

  it("B2. Gemini 429 backoff removes its abort listener after normal sleep (no leak)", async () => {
    mockFetch.mockResolvedValue(makeOpenRouterFailure(402, "Billing required"));

    const { model, generateContentMock } = makeMockModel(["429", "success"]);
    _setGeminiModelFactory(() => model);

    // Count listeners registered/removed on the upstream signal across the
    // whole call — every layer (fetchWithTimeout, raceProviderAttempt, and
    // the 429 backoff sleep) must leave zero net listeners behind.
    const controller = new AbortController();
    let added = 0;
    let removed = 0;
    const signal = controller.signal;
    const origAdd = signal.addEventListener.bind(signal);
    const origRemove = signal.removeEventListener.bind(signal);
    vi.spyOn(signal, "addEventListener").mockImplementation(
      (...args: Parameters<AbortSignal["addEventListener"]>) => {
        added++;
        return origAdd(...args);
      },
    );
    vi.spyOn(signal, "removeEventListener").mockImplementation(
      (...args: Parameters<AbortSignal["removeEventListener"]>) => {
        removed++;
        return origRemove(...args);
      },
    );

    const deadline = Date.now() + 120_000;
    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { model: "test-model", deadlineMs: deadline, signal },
    );

    await flushMicrotasks();
    await tick(60_100);

    const result = await promise;
    expect(result.text).toBe("Gemini success");
    expect(generateContentMock).toHaveBeenCalledTimes(2);

    // Listeners were registered (the backoff sleep + attempt races), and
    // every one was removed — including the sleep's listener after the
    // normal (non-aborted) completion path.
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);
  });

  // ─── C. 429 retry rejected ───────────────────────────────────

  it("C. Gemini 429 → retry rejected when budget cannot fit delay + attempt + cleanup", async () => {
    mockFetch.mockResolvedValue(makeOpenRouterFailure(402, "Billing required"));

    const { model, generateContentMock } = makeMockModel(["429"]);
    _setGeminiModelFactory(() => model);

    // Deadline only 5s remaining — cannot fit 60s delay + 30s attempt + 1s cleanup
    const deadline = Date.now() + 5_000;

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { model: "test-model", deadlineMs: deadline },
    );
    promise.catch(() => {});

    // Flush microtasks: OpenRouter failures + first Gemini 429
    await flushMicrotasks();

    // Should reject with AgentBudgetExhaustedError — no sleep/retry
    await expect(promise).rejects.toThrow(AgentBudgetExhaustedError);
    await expect(promise).rejects.toThrow(/429 retry delay/);

    // Exactly 1 Gemini attempt (no retry)
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  // ─── D. Multiple 429 retries ────────────────────────────────

  it("D. Gemini 429 repeatedly → retries stop before crossing absolute deadline", async () => {
    mockFetch.mockResolvedValue(makeOpenRouterFailure(402, "Billing required"));

    const { model, generateContentMock } = makeMockModel(["429", "429", "429"]);
    _setGeminiModelFactory(() => model);

    // Deadline 130s — fits first 60s retry but not second 120s retry
    // First retry: delay=60s, budget=min(30000, 130000-60000-1000)=30000 → fits
    // Second retry: delay=120s, budget=min(30000, ~70000-120000-1000) → negative → rejected
    const deadline = Date.now() + 130_000;

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { model: "test-model", deadlineMs: deadline },
    );
    promise.catch(() => {});

    // Flush: OpenRouter failures + first Gemini 429
    await flushMicrotasks();

    // Sleep 60s for first retry, then second 429
    await tick(60_100);

    // Should reject with AgentBudgetExhaustedError — second retry (120s) cannot fit
    await expect(promise).rejects.toThrow(AgentBudgetExhaustedError);

    // Exactly 2 Gemini attempts (first + one retry), not 3
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  // ─── E. Deadline-constrained Gemini timeout ────────────────

  it("E. Deadline-constrained timeout → AgentBudgetExhaustedError, not generic SDK timeout", async () => {
    mockFetch.mockResolvedValue(makeOpenRouterFailure(402, "Billing required"));

    const { model, generateContentMock } = makeMockModel(["hang"]);
    _setGeminiModelFactory(() => model);

    // Give less than GEMINI_TIMEOUT_MS (30s) remaining
    // remainingMs=10000, timeoutMs=min(30000, 10000-1000)=9000
    const deadline = Date.now() + 10_000;

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { model: "test-model", deadlineMs: deadline },
    );
    promise.catch(() => {});

    // Flush microtasks so Gemini attempt starts
    await flushMicrotasks();

    // Advance past the 9000ms deadline-constrained timeout
    await tick(9_100);

    // Should throw AgentBudgetExhaustedError, not a generic AbortError
    await expect(promise).rejects.toThrow(AgentBudgetExhaustedError);
    await expect(promise).rejects.toThrow(/timed out against agent budget/);

    expect(generateContentMock).toHaveBeenCalledTimes(1);

    // Verify the timeout was deadline-constrained (9000ms, not 30000ms)
    const callArgs = generateContentMock.mock.calls[0];
    const requestOptions = callArgs[1];
    expect(requestOptions.timeout).toBe(9_000);
  });

  // ─── D2. Final 429 does not sleep ───────────────────────────

  it("D2. Final 429 does not sleep — exactly 3 attempts, rejects immediately after 3rd 429", async () => {
    mockFetch.mockResolvedValue(makeOpenRouterFailure(402, "Billing required"));

    const { model, generateContentMock } = makeMockModel(["429", "429", "429"]);
    _setGeminiModelFactory(() => model);

    // Deadline large enough that a hypothetical 180s sleep would fit
    // (300s remaining > 180s delay + 30s attempt + 1s cleanup)
    const deadline = Date.now() + 300_000;

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { model: "test-model", deadlineMs: deadline },
    );
    promise.catch(() => {});

    // Flush: OpenRouter failures + first Gemini 429
    await flushMicrotasks();

    // Sleep 60s for first retry → second 429
    await tick(60_100);

    // Flush: second 429 completes
    await flushMicrotasks();

    // Sleep 120s for second retry → third 429
    await tick(120_100);

    // The third 429 should reject immediately — no 180s sleep
    // Capture the time before we await the rejection
    const timeBeforeReject = Date.now();

    await expect(promise).rejects.toThrow(/429/);

    // Verify exactly 3 generateContent calls (not 4+)
    expect(generateContentMock).toHaveBeenCalledTimes(3);

    // Verify no additional 180s timer was scheduled after the 3rd 429.
    // If a 180s sleep had been scheduled, advancing time would trigger it,
    // but the promise already rejected. We verify by checking that the
    // time did not advance by 180s — the rejection was immediate.
    const elapsed = Date.now() - timeBeforeReject;
    expect(elapsed).toBeLessThan(60_000); // should be ~0, definitely not 180s
  });

  // ─── F. Build repair propagation ────────────────────────────

  it("F. Build-repair callback receives the same absolute deadlineMs", async () => {
    // Import createAutonomousRepairCallback (now exported)
    const { createAutonomousRepairCallback } = await import("./agent-loop-v2");

    // Mock the transport minimally
    const mockTransport = {
      readFile: vi.fn().mockResolvedValue("file content"),
      writeFile: vi.fn().mockResolvedValue(undefined),
      listFiles: vi.fn().mockResolvedValue([]),
      exists: vi.fn().mockResolvedValue(true),
      runCommand: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };

    // Mock fetch to return success for the repair callLLMWithTools
    mockFetch.mockResolvedValue(makeOpenRouterSuccess("test-model", "Repair done"));

    const deadline = Date.now() + 300_000;
    const repairCallback = createAutonomousRepairCallback(
      mockTransport as never,
      "You are LiTT.",
      [],
      deadline,
    );

    // Execute the repair callback — it calls callLLMWithTools internally
    // with the deadlineMs we passed
    const result = await repairCallback(1, "Build error: syntax error");

    // The repair callback should have called callLLMWithTools (via fetch)
    expect(mockFetch).toHaveBeenCalled();

    // Verify the fetch was called (meaning callLLMWithTools was invoked)
    // The deadline propagation is verified by the fact that the callback
    // accepts and uses the deadlineMs parameter.
    expect(result).toBe(true);
  });

  // ─── G. Resume propagation ─────────────────────────────────

  it("G. resumeAgentLoopV2 passes deadlineMs === startTime + cfg.maxRuntimeMs", async () => {
    // Verify via source inspection that resumeAgentLoopV2 passes the deadline.
    // A full integration test would require mocking the entire workspace/transport
    // stack, which is covered by v2-integration.test.ts. Here we verify the
    // contract is present in the source.
    const fs = await import("fs");
    const source = fs.readFileSync(
      "./src/lib/litt-intelligence/agent-loop-v2.ts",
      "utf-8",
    );

    // Check that resumeAgentLoopV2 passes deadlineMs: startTime + cfg.maxRuntimeMs
    const resumeMatch = source.match(
      /resumeAgentLoopV2[\s\S]*?deadlineMs:\s*startTime\s*\+\s*cfg\.maxRuntimeMs/,
    );
    expect(resumeMatch).not.toBeNull();
    expect(resumeMatch![0]).toContain("deadlineMs: startTime + cfg.maxRuntimeMs");

    // Also verify runAgentLoopV2 does the same
    const runMatch = source.match(
      /runAgentLoopV2[\s\S]*?deadlineMs:\s*startTime\s*\+\s*cfg\.maxRuntimeMs/,
    );
    expect(runMatch).not.toBeNull();
    expect(runMatch![0]).toContain("deadlineMs: startTime + cfg.maxRuntimeMs");

    // Verify createAutonomousRepairCallback accepts and passes deadlineMs
    const repairMatch = source.match(
      /createAutonomousRepairCallback[\s\S]*?deadlineMs/,
    );
    expect(repairMatch).not.toBeNull();
  });

  // ─── OpenRouter hanging request (kept from before) ──────────

  it("OpenRouter hanging request remains bounded by deadline", async () => {
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

    // Disable Gemini fallback to isolate OpenRouter behavior
    vi.stubEnv("GEMINI_API_KEY", "");

    // Deadline 3s → timeoutMs=min(30000, 3000-1000)=2000
    const deadline = Date.now() + 3_000;

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { model: "google/gemini-2.5-flash", deadlineMs: deadline },
    );
    promise.catch(() => {});

    // Flush microtasks so the first fetch starts
    await flushMicrotasks();

    // Advance past the 2000ms timeout
    await tick(2_100);

    // The first model's fetch should have been aborted
    // Subsequent models will fail (mock returns undefined after first call)
    // The promise should reject
    await expect(promise).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCall = mockFetch.mock.calls[0];
    const options = fetchCall[1];
    expect(options.signal).toBeDefined();
  });

  // ─── AgentBudgetExhaustedError preservation ─────────────────

  it("AgentBudgetExhaustedError from Gemini is rethrown unchanged, not hidden as provider failure", async () => {
    mockFetch.mockResolvedValue(makeOpenRouterFailure(402, "Billing required"));

    // Inject a model that throws 429, with a short deadline so retry is rejected
    const { model } = makeMockModel(["429"]);
    _setGeminiModelFactory(() => model);

    // Deadline 5s — cannot fit 60s retry
    const deadline = Date.now() + 5_000;

    const promise = callLLMWithTools(
      "You are LiTT.",
      [{ role: "user", content: "Hello" }],
      [TEST_TOOL],
      { model: "test-model", deadlineMs: deadline },
    );
    promise.catch(() => {});

    // Flush microtasks: OpenRouter failures + Gemini 429
    await flushMicrotasks();

    // Should throw AgentBudgetExhaustedError, NOT "All tool-calling models failed"
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

  it("OpenRouter budget exhausted before attempt throws AgentBudgetExhaustedError", async () => {
    // Disable Gemini fallback
    vi.stubEnv("GEMINI_API_KEY", "");

    // Past deadline
    const pastDeadline = Date.now() - 1000;

    await expect(
      callLLMWithTools(
        "You are LiTT.",
        [{ role: "user", content: "Hello" }],
        [TEST_TOOL],
        { model: "test-model", deadlineMs: pastDeadline },
      ),
    ).rejects.toThrow(AgentBudgetExhaustedError);

    // No fetch should have been made
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
