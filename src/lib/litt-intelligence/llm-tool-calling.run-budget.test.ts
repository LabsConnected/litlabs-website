import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Per-run OpenRouter budget — executor integration (PR #685 delta, A3).
 *
 * The agent loop re-plans routes on EVERY step, so a per-call cap can
 * never bound a run: on staging, builds burned their whole budget
 * inside OpenRouter's long free-model list (60s per-attempt caps,
 * model-scope failures advancing model by model) and never reached
 * the healthy Groq route. The budget is created once per run and
 * shared across calls; these tests pin its executor behavior:
 *
 *   - within a call, OpenRouter attempts stop at the budget and the
 *     executor moves on to the next provider (Groq succeeds);
 *   - on the next call of the same run, OpenRouter is out of the plan
 *     entirely (excluded with reason "run_budget_exhausted");
 *   - when OpenRouter was the only route, exhaustion fails the call
 *     truthfully via AllRoutesFailedError instead of retrying forever.
 *
 * OpenRouter is made to fail with EMPTY completions (model-scope), so
 * provider circuit-breaker state never confounds the budget signal.
 */

vi.mock("@/lib/evals/braintrust", () => ({
  logLLMCall: vi.fn(),
}));

vi.mock("@/lib/siteConfig", () => ({
  SITE_URL: "https://test.example.com",
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  callLLMWithTools,
  AllRoutesFailedError,
} from "./llm-tool-calling";
import {
  createRunRouteBudget,
  _resetProviderHealthForTests,
} from "./provider-registry";
import { _resetModelRegistryForTests } from "./model-registry";

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
  "OPENROUTER_MODEL",
  "GROQ_MODEL",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "VERCEL",
];

const fetchedUrls: string[] = [];

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function openRouterFetchCount(): number {
  return fetchedUrls.filter((u) => u.includes("openrouter.ai")).length;
}

beforeEach(() => {
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
  for (const key of PROVIDER_ENVS) vi.stubEnv(key, "");
  vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
  fetchedUrls.length = 0;
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    fetchedUrls.push(url);
    if (url.includes("openrouter.ai")) {
      // Well-formed but empty completion → model-scope bad_response:
      // the executor advances to the next candidate model.
      return jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "stop" }] });
    }
    if (url.includes("api.groq.com")) {
      return jsonResponse({
        model: "openai/gpt-oss-120b",
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                { id: "call-1", function: { name: "test_tool", arguments: "{}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
});

afterEach(() => {
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
});

describe("callLLMWithTools — per-run OpenRouter budget", () => {
  it("stops feeding OpenRouter at the run budget and fails over to Groq", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("GROQ_API_KEY", "x");
    const budget = createRunRouteBudget({ maxOpenRouterAttempts: 3, maxOpenRouterMs: 600_000 });

    const res = await callLLMWithTools("sys", [{ role: "user", content: "hi" }], [TEST_TOOL], {
      runRouteBudget: budget,
    });

    expect(res.provider).toBe("groq");
    expect(res.toolCalls).toHaveLength(1);
    // Without the budget this call would have walked the whole
    // OpenRouter candidate list (registry models + legacy tail).
    expect(openRouterFetchCount()).toBe(3);
    expect(budget.snapshot().openRouterAttempts).toBe(3);
    expect(budget.openRouterExhausted()).toBe(true);
  });

  it("the next call of the same run excludes OpenRouter at plan time", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("GROQ_API_KEY", "x");
    const budget = createRunRouteBudget({ maxOpenRouterAttempts: 2, maxOpenRouterMs: 600_000 });

    const first = await callLLMWithTools("sys", [{ role: "user", content: "hi" }], [TEST_TOOL], {
      runRouteBudget: budget,
    });
    expect(first.provider).toBe("groq");
    const afterFirst = openRouterFetchCount();
    expect(afterFirst).toBe(2);

    const second = await callLLMWithTools("sys", [{ role: "user", content: "again" }], [TEST_TOOL], {
      runRouteBudget: budget,
    });
    expect(second.provider).toBe("groq");
    // Zero new OpenRouter requests — the route is out of the plan.
    expect(openRouterFetchCount()).toBe(afterFirst);
  });

  it("when OpenRouter was the only route, exhaustion fails truthfully instead of retrying", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    // No GROQ_API_KEY — OpenRouter is the only eligible route.
    const budget = createRunRouteBudget({ maxOpenRouterAttempts: 2, maxOpenRouterMs: 600_000 });
    budget.recordOpenRouterAttempt(1);
    budget.recordOpenRouterAttempt(1);
    expect(budget.openRouterExhausted()).toBe(true);

    const err = await callLLMWithTools("sys", [{ role: "user", content: "hi" }], [TEST_TOOL], {
      runRouteBudget: budget,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AllRoutesFailedError);
    const excluded = (err as AllRoutesFailedError).excluded;
    expect(excluded).toContainEqual({ provider: "openrouter", reason: "run_budget_exhausted" });
    // Nothing was attempted on this call — no silent retry loop.
    expect(openRouterFetchCount()).toBe(0);
  });
});
