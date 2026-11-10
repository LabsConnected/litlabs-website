import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Long-context routing regressions — reproduces staging acceptance
 * iteration 3 (run 42751987160, 2026-11-10) where a ~21K-token
 * post-build follow-up exhausted every route:
 *
 *   - gemini-2.5-flash: HTTP 503 "high demand" (provider scope)
 *   - openrouter: HTTP 401 "User not found" (dead credential)
 *   - groq: skipped — request exceeds the 8K per-request ceiling
 *   - cloudflare llama-3.3-70b: HTTP 400 context overflow (24,001 > 24,000)
 *   - cloudflare mistral-small: HTTP 400 tool-call id format rejection
 *
 * The fixes under test:
 *   - per-model context windows skip routes that cannot fit the request
 *     BEFORE burning a guaranteed-400 attempt (and before that 400 poisons
 *     the model's 10-minute cooldown)
 *   - Cloudflare's strict tool_call_id format ([A-Za-z0-9], length 9) is
 *     normalized at the serialization boundary
 *   - the bounded whole-plan retry treats deterministic request/route
 *     rejections (model_unavailable) as neutral — a transient failure plus
 *     capacity rejections still earns one retry — while auth/billing stay
 *     blocking
 *   - a plan with zero ATTEMPTABLE routes (all models cooling or
 *     ceiling-skipped) waits out a short provider cooldown and re-plans,
 *     instead of failing instantly
 */

vi.mock("@/lib/evals/braintrust", () => ({
  logLLMCall: vi.fn(),
}));

vi.mock("@/lib/siteConfig", () => ({
  SITE_URL: "https://test.example.com",
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("undici", async (importOriginal) => {
  const original = await importOriginal<typeof import("undici")>();
  return {
    ...original,
    fetch: (...args: Parameters<typeof original.fetch>) => mockFetch(...args),
  };
});

import { callLLMWithTools, type LLMMessage } from "./llm-tool-calling";
import {
  _resetProviderHealthForTests,
  recordModelFailure,
  recordProviderFailure,
} from "./provider-registry";
import { _resetModelRegistryForTests } from "./model-registry";

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
  "GROQ_REQUEST_TOKEN_CEILING",
  "MISTRAL_MODEL",
  "CLOUDFLARE_AI_MODEL",
  "GEMINI_TIMEOUT_MS",
  "OPENROUTER_TIMEOUT_MS",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "VERCEL",
];

function clearProviderEnvs() {
  for (const key of PROVIDER_ENVS) vi.stubEnv(key, "");
  vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
}

function callsTo(fragment: string) {
  return mockFetch.mock.calls.filter(([url]) => String(url).includes(fragment));
}

function makeSuccessResponse(model: string, text: string) {
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

function makeErrorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => ({}),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function makeGeminiSuccessResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    text: async () => "",
  };
}

const WRITE_TOOL = {
  id: "files.write",
  description: "Write a file",
  inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: [] },
};

/** Prior-turn tool-call ids exactly as observed on staging ("44-mcs4r1") —
 *  hyphenated ids that Cloudflare Workers AI rejects. */
function historyWithToolCalls(): LLMMessage[] {
  return [
    { role: "user", content: "build the site" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "44-mcs4r1", type: "function", function: { name: "files_write", arguments: "{\"path\":\"a.html\"}" } },
        { id: "call_9xQz-2", type: "function", function: { name: "files_read", arguments: "{\"path\":\"b.html\"}" } },
      ],
    },
    { role: "tool", content: "{}", tool_call_id: "44-mcs4r1" },
    { role: "tool", content: "{}", tool_call_id: "call_9xQz-2" },
  ];
}

function cloudflareOk(model = "@cf/mistralai/mistral-small-3.1-24b-instruct") {
  return makeSuccessResponse(model, "cloudflare completed the turn");
}

beforeEach(() => {
  mockFetch.mockReset();
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
  clearProviderEnvs();
});

afterEach(() => {
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
});

describe("long-context routing — staging iter-3 reproduction", () => {
  it("skips the 24K-context model for an over-window request and serves it on the 128K model with sanitized tool-call ids", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_AI_API_TOKEN", "tok");

    // ~90KB transcript → ~27K estimated tokens: over Groq's 8K ceiling and
    // over llama-3.3-70b's 24K window, well inside mistral-small's 128K.
    const bigTranscript: LLMMessage[] = [
      ...historyWithToolCalls(),
      { role: "user", content: `continue the build ${"x".repeat(90_000)}` },
    ];

    mockFetch.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("generativelanguage")) {
        return Promise.resolve(makeErrorResponse(503, { error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" } }));
      }
      if (u.includes("openrouter.ai")) {
        return Promise.resolve(makeErrorResponse(401, { error: { message: "User not found.", code: 401 } }));
      }
      if (u.includes("api.groq.com")) {
        return Promise.resolve(makeErrorResponse(413, "Request too large"));
      }
      if (u.includes("api.cloudflare.com")) {
        return Promise.resolve(cloudflareOk());
      }
      return Promise.resolve(makeErrorResponse(404, "unexpected url"));
    });

    const result = await callLLMWithTools(
      "You are LiTT.",
      bigTranscript,
      [WRITE_TOOL],
      { maxTokens: 4096, allowTransientPlanRetry: true, deadlineMs: Date.now() + 300_000 },
    );

    expect(result.provider).toBe("cloudflare");
    expect(result.model).toContain("mistral-small");

    // The 24K-window model must never be attempted for this request —
    // pre-fix it burned a guaranteed 400 AND a 10-minute model cooldown.
    expect(callsTo("llama-3.3-70b")).toHaveLength(0);

    // Groq's 8K ceiling skips without a fetch.
    expect(callsTo("api.groq.com")).toHaveLength(0);

    // Cloudflare received exactly one call — to the 128K model.
    const cfCalls = callsTo("api.cloudflare.com");
    expect(cfCalls).toHaveLength(1);
    const cfBody = JSON.parse((cfCalls[0][1] as { body: string }).body);
    expect(cfBody.model).toBe("@cf/mistralai/mistral-small-3.1-24b-instruct");

    // Every tool_call id and tool_call_id in the serialized request obeys
    // Cloudflare's [A-Za-z0-9] × 9 constraint, and assistant/tool sides agree.
    const assistantToolCallIds = new Set<string>();
    const toolResultIds: string[] = [];
    for (const m of cfBody.messages as Array<{
      role?: string;
      tool_call_id?: string;
      tool_calls?: Array<{ id?: string }>;
    }>) {
      for (const tc of m.tool_calls ?? []) {
        if (tc.id) assistantToolCallIds.add(tc.id);
      }
      if (m.role === "tool" && typeof m.tool_call_id === "string") toolResultIds.push(m.tool_call_id);
      for (const id of [...assistantToolCallIds]) {
        expect(id).toMatch(/^[A-Za-z0-9]{9}$/);
      }
    }
    expect(assistantToolCallIds.size).toBe(2);
    expect(new Set(toolResultIds)).toEqual(assistantToolCallIds);
    for (const id of toolResultIds) expect(id).toMatch(/^[A-Za-z0-9]{9}$/);
  });

  it("reproduces iter-3 call-B: transient 503 + capacity rejections earns the bounded whole-plan retry", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_AI_API_TOKEN", "tok");

    // ~55KB → ~18K estimated tokens: over Groq's ceiling, inside llama's
    // 24K window (so it is genuinely attempted) — but both CF models 400.
    const transcript: LLMMessage[] = [
      ...historyWithToolCalls(),
      { role: "user", content: `next step ${"y".repeat(55_000)}` },
    ];

    let geminiCalls = 0;
    mockFetch.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("generativelanguage")) {
        geminiCalls++;
        // Pass 1: 503 high-demand. Pass 2 (whole-plan retry): recovered.
        return Promise.resolve(
          geminiCalls === 1
            ? makeErrorResponse(503, { error: { code: 503, message: "high demand", status: "UNAVAILABLE" } })
            : makeGeminiSuccessResponse("gemini recovered on retry"),
        );
      }
      if (u.includes("api.cloudflare.com")) {
        // Deterministic request-shape rejections — the same class the
        // router recorded in prod (model_unavailable, scope=model).
        return Promise.resolve(makeErrorResponse(400, { error: { message: "request rejected for this model" } }));
      }
      return Promise.resolve(makeErrorResponse(404, "unexpected url"));
    });

    const result = await callLLMWithTools(
      "You are LiTT.",
      transcript,
      [WRITE_TOOL],
      { maxTokens: 4096, allowTransientPlanRetry: true, deadlineMs: Date.now() + 300_000 },
    );

    expect(result.provider).toBe("gemini");
    expect(result.text).toBe("gemini recovered on retry");
    // Pass 1 gemini 503 + pass 2 gemini success.
    expect(geminiCalls).toBe(2);
  });

  it("still refuses the whole-plan retry when a permanent auth failure is present", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");

    mockFetch.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("generativelanguage")) {
        return Promise.resolve(makeErrorResponse(503, { error: { code: 503, message: "high demand" } }));
      }
      if (u.includes("openrouter.ai")) {
        return Promise.resolve(makeErrorResponse(401, { error: { message: "User not found.", code: 401 } }));
      }
      return Promise.resolve(makeErrorResponse(404, "unexpected url"));
    });

    await expect(
      callLLMWithTools("sys", [{ role: "user", content: "hi" }], [WRITE_TOOL], {
        allowTransientPlanRetry: true,
        deadlineMs: Date.now() + 300_000,
      }),
    ).rejects.toThrow(/All tool-calling models failed/);

    // auth_invalid must not burn a second pass.
    expect(callsTo("generativelanguage")).toHaveLength(1);
    expect(callsTo("openrouter.ai")).toHaveLength(1);
  });

  it("does not retry when failures are ONLY deterministic rejections (no transient failure)", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_AI_API_TOKEN", "tok");
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");

    // ~55KB → Groq ceiling-skips; both CF models return deterministic 400s.
    const transcript: LLMMessage[] = [
      { role: "user", content: `only deterministic failures ${"z".repeat(55_000)}` },
    ];

    mockFetch.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("api.cloudflare.com")) {
        return Promise.resolve(makeErrorResponse(400, { error: { message: "request rejected" } }));
      }
      return Promise.resolve(makeErrorResponse(404, "unexpected url"));
    });

    await expect(
      callLLMWithTools("sys", transcript, [WRITE_TOOL], {
        allowTransientPlanRetry: true,
        deadlineMs: Date.now() + 300_000,
      }),
    ).rejects.toThrow(/All tool-calling models failed/);

    // Two CF models × one attempt each — no second pass without a transient.
    expect(callsTo("api.cloudflare.com")).toHaveLength(2);
  });

  it("waits out a short provider cooldown when zero routes are attemptable, then re-plans", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_AI_API_TOKEN", "tok");

    // Big request → Groq ceiling-skips. Both CF models cooling. Gemini in a
    // short provider cooldown → plan has providers but ZERO attemptable
    // routes; the router must wait out the cooldown instead of failing.
    recordProviderFailure("gemini", {
      class: "rate_limited",
      scope: "provider",
      retryAfterMs: 2_000,
      message: "slow down",
    });
    recordModelFailure("cloudflare", "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    recordModelFailure("cloudflare", "@cf/mistralai/mistral-small-3.1-24b-instruct");

    const transcript: LLMMessage[] = [
      { role: "user", content: `big ${"w".repeat(60_000)}` },
    ];

    mockFetch.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("generativelanguage")) {
        return Promise.resolve(makeGeminiSuccessResponse("gemini after cooldown"));
      }
      return Promise.resolve(makeErrorResponse(404, "unexpected url"));
    });

    const result = await callLLMWithTools(
      "sys",
      transcript,
      [WRITE_TOOL],
      { maxTokens: 4096, deadlineMs: Date.now() + 300_000 },
    );

    expect(result.provider).toBe("gemini");
    expect(result.text).toBe("gemini after cooldown");
    expect(callsTo("generativelanguage")).toHaveLength(1);
  }, 15_000);
});
