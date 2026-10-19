import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  planBasicRoutes,
  recordProviderFailure,
  recordProviderSuccess,
  getProviderHealth,
  classifyHttpFailure,
  classifyThrownFailure,
  providerDiagnostics,
  createRunRouteBudget,
  _resetProviderHealthForTests,
} from "./provider-registry";
import { _resetModelRegistryForTests } from "./model-registry";

/**
 * Revenue-repair coverage (PR #685 delta, Part A):
 *  A1 — a billing-exhausted provider is skipped for BUILD runs and is
 *       never reported healthy again on a timer alone; depleted-credit
 *       responses classify as billing whatever status wraps them.
 *  A2 — BUILD plans rank Groq ahead of OpenRouter; other run types keep
 *       the base preference order.
 *  A3 — the per-run OpenRouter budget (unit level; executor behavior
 *       is covered in llm-tool-calling.run-budget.test.ts).
 */

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
  "LITT_DISABLE_OLLAMA",
  "OPENROUTER_MODEL",
  "GEMINI_DISABLED",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "VERCEL",
];

const TOOL_REQ = { tools: true, coding: true };
const BUILD_REQ = { tools: true, coding: true, reliableFileWriting: true };

beforeEach(() => {
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
  for (const key of PROVIDER_ENVS) vi.stubEnv(key, "");
  vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
});

afterEach(() => {
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
});

describe("A1 — billing-exhausted providers: health honesty", () => {
  it("a billing disable never recovers into a 'healthy' report on a timer alone", () => {
    vi.useFakeTimers();
    try {
      recordProviderFailure("gemini", {
        class: "billing",
        scope: "provider",
        httpStatus: 402,
        message: "credits exhausted",
      });
      expect(getProviderHealth("gemini").state).toBe("disabled");
      // Past the 30-minute disable window: the old code resurrected the
      // provider as state "healthy" while reason stayed "billing" — the
      // exact dishonesty the live /api/llm/health payload showed.
      vi.advanceTimersByTime(31 * 60_000);
      const h = getProviderHealth("gemini");
      expect(h.state).toBe("degraded");
      expect(h.reason).toBe("billing");
      expect(providerDiagnostics().gemini.state).toBe("degraded");
      expect(providerDiagnostics().gemini.reason).toBe("billing");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a rate-limit cooldown still recovers to healthy (no overreach)", () => {
    vi.useFakeTimers();
    try {
      recordProviderFailure("groq", {
        class: "rate_limited",
        scope: "provider",
        httpStatus: 429,
        retryAfterMs: 30_000,
        message: "rate limited",
      });
      vi.advanceTimersByTime(31_000);
      expect(getProviderHealth("groq").state).toBe("healthy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a real success rehabilitates a billing-flagged provider completely", () => {
    vi.useFakeTimers();
    try {
      recordProviderFailure("gemini", {
        class: "billing",
        scope: "provider",
        httpStatus: 402,
        message: "credits exhausted",
      });
      vi.advanceTimersByTime(31 * 60_000);
      expect(getProviderHealth("gemini").state).toBe("degraded");
      recordProviderSuccess("gemini");
      const h = getProviderHealth("gemini");
      expect(h.state).toBe("healthy");
      expect(h.reason).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("A1 — billing-exhausted providers: BUILD routing skip", () => {
  it("BUILD plans exclude a billing-flagged provider even after its disable lapses; non-build plans may re-probe it", () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("GEMINI_API_KEY", "x");
      vi.stubEnv("OPENROUTER_API_KEY", "x");
      recordProviderFailure("gemini", {
        class: "billing",
        scope: "provider",
        httpStatus: 402,
        message: "credits exhausted",
      });
      vi.advanceTimersByTime(31 * 60_000);

      const buildPlan = planBasicRoutes(BUILD_REQ);
      expect(buildPlan.providers.map((p) => p.provider)).not.toContain("gemini");
      expect(buildPlan.excluded.find((e) => e.provider === "gemini")?.reason).toBe(
        "billing_exhausted",
      );

      // Ordinary traffic keeps the re-probe path: degraded, still listed.
      const chatPlan = planBasicRoutes(TOOL_REQ);
      const gemini = chatPlan.providers.find((p) => p.provider === "gemini");
      expect(gemini).toBeDefined();
      expect(gemini!.health).toBe("degraded");
    } finally {
      vi.useRealTimers();
    }
  });

  it("BUILD plans exclude a provider inside its active billing disable window too", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("GROQ_API_KEY", "x");
    recordProviderFailure("gemini", {
      class: "billing",
      scope: "provider",
      httpStatus: 402,
      message: "credits exhausted",
    });
    const plan = planBasicRoutes(BUILD_REQ);
    expect(plan.providers.map((p) => p.provider)).toEqual(["groq"]);
    expect(plan.excluded.find((e) => e.provider === "gemini")?.reason).toContain("disabled");
  });
});

describe("A1 — depleted-credit classification", () => {
  it("a 429 carrying depleted-prepayment wording is billing, not a transient rate limit", () => {
    const f = classifyHttpFailure(
      429,
      '{"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.","status":"RESOURCE_EXHAUSTED"}}',
    );
    expect(f.class).toBe("billing");
    expect(f.scope).toBe("provider");
  });

  it("a plain 429 stays rate_limited", () => {
    const f = classifyHttpFailure(429, '{"error":"rate limit exceeded, retry in 30s"}');
    expect(f.class).toBe("rate_limited");
  });

  it("a 403 carrying depleted-credit wording is billing", () => {
    const f = classifyHttpFailure(403, '{"error":"prepayment credits are depleted for this project"}');
    expect(f.class).toBe("billing");
    expect(f.scope).toBe("provider");
  });

  it("a thrown SDK error embedding the depleted-prepayment message is billing", () => {
    const f = classifyThrownFailure(
      new Error("429 Too Many Requests — your prepayment credits are depleted"),
    );
    expect(f.class).toBe("billing");
    expect(f.scope).toBe("provider");
  });

  it("a thrown plain 429 stays rate_limited", () => {
    expect(classifyThrownFailure(new Error("429 Too Many Requests")).class).toBe("rate_limited");
  });
});

describe("A2 — BUILD route order: Groq ahead of OpenRouter", () => {
  it("BUILD plans order gemini → groq → openrouter", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("GROQ_API_KEY", "x");
    const plan = planBasicRoutes(BUILD_REQ);
    expect(plan.providers.map((p) => p.provider)).toEqual(["gemini", "groq", "openrouter"]);
    // The Groq route carries the proven builder writers, in order.
    const groq = plan.providers.find((p) => p.provider === "groq");
    expect(groq!.models.slice(0, 2)).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  });

  it("non-BUILD plans keep the base preference order (openrouter before groq)", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("GROQ_API_KEY", "x");
    const plan = planBasicRoutes(TOOL_REQ);
    expect(plan.providers.map((p) => p.provider)).toEqual(["gemini", "openrouter", "groq"]);
  });

  it("an honoured proven-writer hint still leads a BUILD plan", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("GROQ_API_KEY", "x");
    const plan = planBasicRoutes(BUILD_REQ, { model: "google/gemma-4-31b-it:free" });
    expect(plan.providers[0].provider).toBe("openrouter");
    expect(plan.providers[0].models[0]).toBe("google/gemma-4-31b-it:free");
  });
});

describe("A1 — sticky billing/auth blocks", () => {
  it("a billing block survives interleaved timeout and rate-limit failures until a real success", () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("GEMINI_API_KEY", "x");
      vi.stubEnv("OPENROUTER_API_KEY", "x");
      vi.stubEnv("GROQ_API_KEY", "x");

      const buildExclusion = () =>
        planBasicRoutes(BUILD_REQ).excluded.find((e) => e.provider === "gemini")?.reason;

      recordProviderFailure("gemini", {
        class: "billing",
        scope: "provider",
        httpStatus: 402,
        message: "credits exhausted",
      });
      expect(getProviderHealth("gemini")).toMatchObject({ state: "disabled", reason: "billing" });
      expect(buildExclusion()).toContain("disabled");

      // The billing disable window lapses: degraded, never healthy.
      vi.advanceTimersByTime(30 * 60_000 + 1);
      expect(getProviderHealth("gemini")).toMatchObject({ state: "degraded", reason: "billing" });
      expect(buildExclusion()).toBe("billing_exhausted");

      // An interleaved failure of another class must not overwrite the block.
      recordProviderFailure("gemini", {
        class: "timeout",
        scope: "provider",
        message: "timed out",
      });
      expect(getProviderHealth("gemini")).toMatchObject({ state: "degraded", reason: "billing" });
      expect(buildExclusion()).toBe("billing_exhausted");

      // A plain rate-limit failure sets the shorter cooldown...
      recordProviderFailure("gemini", {
        class: "rate_limited",
        scope: "provider",
        httpStatus: 429,
        retryAfterMs: 30_000,
        message: "rate limited",
      });
      expect(getProviderHealth("gemini")).toMatchObject({ state: "cooldown", reason: "billing" });
      expect(buildExclusion()).toContain("cooldown");

      // ...and its lapse still cannot resurrect the billing-blocked route.
      vi.advanceTimersByTime(31_000);
      expect(getProviderHealth("gemini")).toMatchObject({ state: "degraded", reason: "billing" });
      expect(buildExclusion()).toBe("billing_exhausted");

      // Only a genuine success rehabilitates it.
      recordProviderSuccess("gemini");
      const h = getProviderHealth("gemini");
      expect(h.state).toBe("healthy");
      expect(h.reason).toBeUndefined();
      expect(planBasicRoutes(BUILD_REQ).providers.map((p) => p.provider)).toContain("gemini");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an auth_invalid provider stays excluded from BUILD plans after cooldown recovery", () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("GEMINI_API_KEY", "x");
      vi.stubEnv("GROQ_API_KEY", "x");
      recordProviderFailure("gemini", {
        class: "auth_invalid",
        scope: "provider",
        httpStatus: 401,
        message: "invalid key",
      });
      vi.advanceTimersByTime(30 * 60_000 + 1);

      expect(getProviderHealth("gemini")).toMatchObject({
        state: "degraded",
        reason: "auth_invalid",
      });
      const plan = planBasicRoutes(BUILD_REQ);
      expect(plan.providers.map((p) => p.provider)).not.toContain("gemini");
      expect(plan.excluded.find((e) => e.provider === "gemini")?.reason).toBe(
        "auth_invalid_blocked",
      );

      recordProviderSuccess("gemini");
      expect(planBasicRoutes(BUILD_REQ).providers.map((p) => p.provider)).toContain("gemini");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("A2 — BUILD ordering sweep", () => {
  it("keeps Groq before OpenRouter and healthy providers before degraded ones across health assignments", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("GROQ_API_KEY", "x");
    vi.stubEnv("MISTRAL_API_KEY", "x");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "x");
    vi.stubEnv("CLOUDFLARE_AI_API_TOKEN", "x");

    const providers = ["gemini", "openrouter", "groq", "mistral", "cloudflare"] as const;
    for (let mask = 0; mask < 1 << providers.length; mask++) {
      _resetProviderHealthForTests();
      const degraded = providers.filter((_, i) => (mask & (1 << i)) !== 0);
      for (const provider of degraded) {
        recordProviderFailure(provider, {
          class: "timeout",
          scope: "provider",
          message: "timed out",
        });
      }

      const order = planBasicRoutes(BUILD_REQ).providers.map((p) => p.provider);
      expect(order).toHaveLength(providers.length);
      expect(order.indexOf("groq")).toBeLessThan(order.indexOf("openrouter"));

      for (const degradedProvider of degraded) {
        for (const healthyProvider of providers) {
          if (degraded.includes(healthyProvider)) continue;
          // Groq-before-OpenRouter is the sole permitted inversion.
          if (degradedProvider === "groq" && healthyProvider === "openrouter") continue;
          expect(order.indexOf(healthyProvider)).toBeLessThan(order.indexOf(degradedProvider));
        }
      }
    }
  });
});

describe("A3 — RunRouteBudget (unit)", () => {
  it("exhausts on attempt count", () => {
    const b = createRunRouteBudget({ maxOpenRouterAttempts: 2, maxOpenRouterMs: 600_000 });
    expect(b.openRouterExhausted()).toBe(false);
    b.recordOpenRouterAttempt(10);
    expect(b.openRouterExhausted()).toBe(false);
    b.recordOpenRouterAttempt(10);
    expect(b.openRouterExhausted()).toBe(true);
    expect(b.snapshot()).toEqual({ openRouterAttempts: 2, openRouterMs: 20 });
  });

  it("exhausts on accumulated wall time", () => {
    const b = createRunRouteBudget({ maxOpenRouterAttempts: 100, maxOpenRouterMs: 1_000 });
    b.recordOpenRouterAttempt(600);
    expect(b.openRouterExhausted()).toBe(false);
    b.recordOpenRouterAttempt(500);
    expect(b.openRouterExhausted()).toBe(true);
  });

  it("defaults bound a run to a finite OpenRouter allowance", () => {
    const b = createRunRouteBudget();
    expect(b.maxOpenRouterAttempts).toBeGreaterThan(0);
    expect(b.maxOpenRouterMs).toBeGreaterThan(0);
    expect(b.openRouterExhausted()).toBe(false);
  });
});
