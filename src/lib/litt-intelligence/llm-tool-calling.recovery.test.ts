import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Sticky billing block — END-TO-END recovery (PR #685 delta, A1 close-out).
 *
 * The delta re-review graded end-to-end recovery UNVERIFIED: every
 * rehabilitation in the committed suites was injected by calling
 * recordProviderSuccess directly, so nothing proved the sticky block
 * clears through the machinery that actually runs in production.
 * This test closes that gap:
 *
 *   1. Gemini takes a provider-scope billing failure and the clock
 *      advances past the 30-minute disable window (fake timers, the
 *      pattern the registry repair tests use): the block is sticky —
 *      health reads degraded/billing, never healthy.
 *   2. A BUILD-requirements plan excludes Gemini with reason
 *      "billing_exhausted".
 *   3. A NON-BUILD callLLMWithTools call — the degraded re-probe
 *      channel ordinary traffic keeps — drives the real Gemini route
 *      over a mocked transport that succeeds. The success flows
 *      through the production caller in llm-tool-calling.ts, which
 *      calls recordProviderSuccess(route.provider) after the
 *      normalized non-empty completion. No test code touches
 *      recordProviderSuccess.
 *   4. Health is healthy with no reason, and a fresh BUILD plan
 *      includes Gemini again: restored billing recovers the provider
 *      with no permanent lockout.
 */

vi.mock("@/lib/evals/braintrust", () => ({
  logLLMCall: vi.fn(),
}));

vi.mock("@/lib/siteConfig", () => ({
  SITE_URL: "https://test.example.com",
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { callLLMWithTools } from "./llm-tool-calling";
import {
  planBasicRoutes,
  recordProviderFailure,
  getProviderHealth,
  _resetProviderHealthForTests,
} from "./provider-registry";
import { _resetModelRegistryForTests } from "./model-registry";

const TEST_TOOL = {
  id: "test.tool",
  description: "A test tool",
  inputSchema: { type: "object", properties: {}, required: [] },
};

const BUILD_REQ = { tools: true, coding: true, reliableFileWriting: true };

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
  "GEMINI_DISABLED",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "VERCEL",
];

const fetchedUrls: string[] = [];

function geminiSuccessResponse(text: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      candidates: [
        { content: { parts: [{ text }] }, finishReason: "STOP" },
      ],
    }),
    text: async () => "",
  } as unknown as Response;
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
    if (url.includes("generativelanguage.googleapis.com")) {
      return geminiSuccessResponse("Gemini is back.");
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
});

afterEach(() => {
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
});

describe("callLLMWithTools — sticky billing block recovery (end-to-end)", () => {
  it("a degraded re-probe success through the production caller clears the block and restores BUILD eligibility", async () => {
    // Gemini is the ONLY configured provider: it is the sole route in
    // every plan below, so the re-probe in step 3 cannot land elsewhere.
    vi.stubEnv("GEMINI_API_KEY", "x");

    vi.useFakeTimers();
    try {
      // 1. Billing block, then let the 30-minute disable window lapse.
      recordProviderFailure("gemini", {
        class: "billing",
        scope: "provider",
        message: "credits exhausted",
      });
      expect(getProviderHealth("gemini").state).toBe("disabled");
      vi.advanceTimersByTime(30 * 60_000 + 1);
      const blocked = getProviderHealth("gemini");
      expect(blocked.state).toBe("degraded");
      expect(blocked.reason).toBe("billing");

      // 2. BUILD plans exclude the billing-blocked provider.
      const buildBefore = planBasicRoutes(BUILD_REQ);
      expect(buildBefore.providers.map((p) => p.provider)).not.toContain("gemini");
      expect(buildBefore.excluded.find((e) => e.provider === "gemini")?.reason).toBe(
        "billing_exhausted",
      );

      // 3. Non-BUILD call through the production caller: the plan
      // keeps Gemini as a degraded re-probe route, the mocked
      // transport succeeds, and the caller's own success path —
      // recordProviderSuccess after the normalized completion —
      // is what rehabilitates the provider.
      const res = await callLLMWithTools(
        "sys",
        [{ role: "user", content: "hi" }],
        [TEST_TOOL],
      );
      expect(res.provider).toBe("gemini");
      expect(res.text).toBe("Gemini is back.");
      expect(
        fetchedUrls.some((u) => u.includes("generativelanguage.googleapis.com")),
      ).toBe(true);

      // 4. The sticky block is gone and BUILD eligibility is back.
      const health = getProviderHealth("gemini");
      expect(health.state).toBe("healthy");
      expect(health.reason).toBeUndefined();
      const buildAfter = planBasicRoutes(BUILD_REQ);
      expect(buildAfter.providers.map((p) => p.provider)).toContain("gemini");
    } finally {
      vi.useRealTimers();
    }
  });
});
