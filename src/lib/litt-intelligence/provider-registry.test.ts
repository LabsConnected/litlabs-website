import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  planBasicRoutes,
  recordProviderFailure,
  recordProviderSuccess,
  recordModelFailure,
  isModelCoolingDown,
  getProviderHealth,
  classifyHttpFailure,
  classifyThrownFailure,
  parseRetryAfterMs,
  providerDiagnostics,
  _resetProviderHealthForTests,
} from "./provider-registry";
import { validateEnvOverride, _resetModelRegistryForTests } from "./model-registry";

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
  "GROQ_REQUEST_TOKEN_CEILING",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "VERCEL",
];

const TOOL_REQ = { tools: true, coding: true };

beforeEach(() => {
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
  for (const key of PROVIDER_ENVS) vi.stubEnv(key, "");
});

afterEach(() => {
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
});

describe("provider registry — Basic cost policy", () => {
  it.each([undefined, "", "invalid", "-1", "0", "Infinity"])("uses a finite Gemini timeout for invalid override %s", (override) => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("GEMINI_TIMEOUT_MS", override);
    const gemini = planBasicRoutes(TOOL_REQ).providers.find(route => route.provider === "gemini");
    expect(gemini?.timeoutMs).toBe(60_000);
  });

  it("honors a positive Gemini timeout override", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("GEMINI_TIMEOUT_MS", "45000");
    const gemini = planBasicRoutes(TOOL_REQ).providers.find(route => route.provider === "gemini");
    expect(gemini?.timeoutMs).toBe(45_000);
  });

  it("includes FREE_MANAGED routes when credentials are present", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("GROQ_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ);
    const ids = plan.providers.map((p) => p.provider);
    expect(ids).toContain("gemini");
    expect(ids).toContain("openrouter");
    expect(ids).toContain("groq");
    for (const p of plan.providers) {
      expect(["FREE_MANAGED", "LOCAL"]).toContain(p.costClass);
    }
  });

  it("never includes USER_FUNDED routes without a user key", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ);
    expect(plan.providers.map((p) => p.provider)).not.toContain("byok");
    expect(
      plan.excluded.find((e) => e.provider === "byok")?.reason,
    ).toBe("user_funded_requires_user_key");
  });

  it("includes BYOK only when the user supplies a key", () => {
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ, {
      userApiKey: "sk-user-key",
      byokProvider: "openai",
    });
    const byok = plan.providers.find((p) => p.provider === "byok");
    expect(byok).toBeDefined();
    expect(byok!.costClass).toBe("USER_FUNDED");
  });

  it("excludes routes with missing credentials", () => {
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ);
    expect(plan.providers).toHaveLength(0);
    const reasons = plan.excluded.map((e) => `${e.provider}:${e.reason}`);
    expect(reasons).toContain("gemini:credential_missing");
    expect(reasons).toContain("openrouter:credential_missing");
    expect(reasons).toContain("groq:credential_missing");
    expect(reasons).toContain("mistral:credential_missing");
    expect(reasons).toContain("cloudflare:credential_missing");
  });

  it("includes LOCAL ollama when explicitly configured", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
    vi.stubEnv("RAILWAY_ENVIRONMENT", "production");
    const plan = planBasicRoutes(TOOL_REQ);
    const ollama = plan.providers.find((p) => p.provider === "ollama");
    expect(ollama).toBeDefined();
    expect(ollama!.costClass).toBe("LOCAL");
    expect(ollama!.credentialState).toBe("not_required");
  });

  it("excludes ollama on deployed runtimes when not explicitly configured", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("RAILWAY_ENVIRONMENT", "production");
    const plan = planBasicRoutes(TOOL_REQ);
    expect(plan.providers.map((p) => p.provider)).not.toContain("ollama");
  });

  it("gives OpenRouter a realistic per-route timeout — free models legitimately exceed 30s", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ);
    const or = plan.providers.find((p) => p.provider === "openrouter");
    expect(or?.timeoutMs).toBeGreaterThanOrEqual(60_000);
  });

  it("respects preference order: gemini → openrouter → groq → mistral → cloudflare → ollama", () => {
    for (const k of ["GEMINI_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY"]) {
      vi.stubEnv(k, "x");
    }
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "x");
    vi.stubEnv("CLOUDFLARE_AI_API_TOKEN", "x");
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
    const plan = planBasicRoutes(TOOL_REQ);
    expect(plan.providers.map((p) => p.provider)).toEqual([
      "gemini",
      "openrouter",
      "groq",
      "mistral",
      "cloudflare",
      "ollama",
    ]);
  });
});

describe("provider registry — capability filtering", () => {
  it("tool-required requests only select tool-capable providers", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes({ tools: true });
    for (const p of plan.providers) {
      expect(p.capabilities.tools).toBe(true);
    }
  });

  it("vision-required requests exclude non-vision providers", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("GROQ_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes({ tools: true, vision: true });
    expect(plan.providers.map((p) => p.provider)).toEqual(["gemini"]);
  });
});

describe("provider registry — health and cooldown", () => {
  it("skips providers in cooldown/disabled and keeps them out of the plan", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    recordProviderFailure("openrouter", {
      class: "billing",
      scope: "provider",
      httpStatus: 402,
      message: "credits exhausted",
    });
    const plan = planBasicRoutes(TOOL_REQ);
    expect(plan.providers.map((p) => p.provider)).toEqual(["gemini"]);
    expect(plan.excluded.find((e) => e.provider === "openrouter")?.reason).toContain("disabled");
  });

  it("degraded providers remain eligible but rank after healthy ones", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("GROQ_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    recordProviderFailure("gemini", {
      class: "timeout",
      scope: "provider",
      message: "timed out",
    });
    const plan = planBasicRoutes(TOOL_REQ);
    // groq (healthy) outranks gemini (degraded)
    expect(plan.providers.map((p) => p.provider)).toEqual(["groq", "gemini"]);
    expect(getProviderHealth("gemini").state).toBe("degraded");
  });

  it("two consecutive transient failures put the provider in cooldown", () => {
    recordProviderFailure("groq", { class: "server_error", scope: "provider", httpStatus: 500, message: "x" });
    recordProviderFailure("groq", { class: "server_error", scope: "provider", httpStatus: 500, message: "x" });
    const h = getProviderHealth("groq");
    expect(h.state).toBe("cooldown");
    expect(h.cooldownUntil).toBeGreaterThan(Date.now());
  });

  it("a provider recovers after its cooldown window expires", () => {
    vi.useFakeTimers();
    try {
      recordProviderFailure("groq", {
        class: "rate_limited",
        scope: "provider",
        httpStatus: 429,
        retryAfterMs: 30_000,
        message: "rate limited",
      });
      expect(getProviderHealth("groq").state).toBe("cooldown");
      vi.advanceTimersByTime(31_000);
      expect(getProviderHealth("groq").state).toBe("healthy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("success resets failure counters and restores healthy state", () => {
    recordProviderFailure("gemini", { class: "timeout", scope: "provider", message: "t" });
    recordProviderSuccess("gemini");
    const h = getProviderHealth("gemini");
    expect(h.state).toBe("healthy");
    expect(h.consecutiveFailures).toBe(0);
  });

  it("model-scope failures cool down only the model, not the provider", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    recordModelFailure("openrouter", "openrouter/free");
    expect(isModelCoolingDown("openrouter", "openrouter/free")).toBe(true);
    expect(getProviderHealth("openrouter").state).toBe("healthy");
    const plan = planBasicRoutes(TOOL_REQ);
    expect(plan.providers.map((p) => p.provider)).toContain("openrouter");
  });
});

describe("provider registry — model hints", () => {
  it("honours a free OpenRouter hint by moving it first within openrouter", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ, {
      model: "qwen/qwen-2.5-coder-32b-instruct:free",
    });
    const or = plan.providers.find((p) => p.provider === "openrouter");
    expect(or!.models[0]).toBe("qwen/qwen-2.5-coder-32b-instruct:free");
  });

  it("maps a google/gemini slug to the direct Gemini route", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ, { model: "google/gemini-2.5-flash" });
    expect(plan.providers[0].provider).toBe("gemini");
    expect(plan.providers[0].models[0]).toBe("gemini-2.5-flash");
  });

  it("drops paid OpenRouter slugs under the Basic cost policy", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ, { model: "openai/gpt-4o" });
    expect(plan.droppedModelHint).toBe("openai/gpt-4o");
    // gpt-4o must NOT appear as an OR model candidate
    const or = plan.providers.find((p) => p.provider === "openrouter");
    expect(or!.models).not.toContain("openai/gpt-4o");
  });

  it("ignores LiTT aliases and auto", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    for (const m of ["auto", "litt-auto", "litt-builder"]) {
      const plan = planBasicRoutes(TOOL_REQ, { model: m });
      expect(plan.droppedModelHint).toBeUndefined();
      expect(plan.providers[0].provider).toBe("gemini");
    }
  });

  it("routes an explicit ollama/<tag> hint to the local provider with the bare tag", () => {
    // Studio's picker emits "ollama/<tag>" for the Local section. The hint
    // must pin the local provider first with the bare tag Ollama expects.
    vi.stubEnv("GEMINI_API_KEY", "x");
    const plan = planBasicRoutes(TOOL_REQ, { model: "ollama/litt-hermes-fast:8k" });
    expect(plan.droppedModelHint).toBeUndefined();
    expect(plan.providers[0].provider).toBe("ollama");
    expect(plan.providers[0].models[0]).toBe("litt-hermes-fast:8k");
  });

  it("routes a vendor-prefixed Groq slug (openai/gpt-oss-*) to Groq, not BYOK", () => {
    // gpt-oss-120b is a Groq production model — the "openai/" prefix used
    // to fall through to the BYOK lane, where "gpt-oss-120b" 404s on the
    // user's OpenAI endpoint (or the hint dropped silently without a key).
    vi.stubEnv("GROQ_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ, { model: "openai/gpt-oss-120b" });
    expect(plan.droppedModelHint).toBeUndefined();
    expect(plan.providers[0].provider).toBe("groq");
    expect(plan.providers[0].models[0]).toBe("openai/gpt-oss-120b");
  });

  it("routes a qwen/* slug to Groq, not the OpenRouter paid lane", () => {
    // qwen/qwen3.8-27b is live on Groq (the openrouter :free variant was
    // delisted upstream). A generic vendor/model slug used to drop to the
    // OpenRouter paid lane under the Basic cost policy.
    vi.stubEnv("GROQ_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ, { model: "qwen/qwen3.8-27b" });
    expect(plan.droppedModelHint).toBeUndefined();
    expect(plan.providers[0].provider).toBe("groq");
    expect(plan.providers[0].models[0]).toBe("qwen/qwen3.8-27b");
  });

  it("offers qwen/qwen3.8-27b as a bounded third Groq fallback candidate", () => {
    vi.stubEnv("GROQ_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ);
    const groq = plan.providers.find((p) => p.provider === "groq");
    expect(groq).toBeDefined();
    expect(groq!.models).toEqual([
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
    ]);
  });

  it("keeps the ollama pin first even with cloud credentials present", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("GROQ_API_KEY", "x");
    const plan = planBasicRoutes(TOOL_REQ, { model: "ollama/litt-hermes-fast:8k" });
    expect(plan.providers[0].provider).toBe("ollama");
  });
});

describe("provider registry — openrouter auto-router tool exclusion", () => {
  it("excludes openrouter/free from tool-required plans", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ);
    const or = plan.providers.find((p) => p.provider === "openrouter");
    expect(or).toBeDefined();
    expect(or!.models).not.toContain("openrouter/free");
    // The explicitly-named free tool-callers remain as candidates.
    expect(or!.models.length).toBeGreaterThan(0);
    expect(or!.models).toContain("nvidia/nemotron-3.5-lightning:free");
  });

  it("keeps openrouter/free eligible when tools are not required", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes({ tools: false });
    const or = plan.providers.find((p) => p.provider === "openrouter");
    expect(or!.models).toContain("openrouter/free");
  });

  it("an explicit openrouter/free hint cannot resurrect the auto-router on tool-required requests", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ, { model: "openrouter/free" });
    const or = plan.providers.find((p) => p.provider === "openrouter");
    expect(or!.models).not.toContain("openrouter/free");
    // The drop is surfaced, not silent — the caller logs model_hint_dropped.
    expect(plan.droppedModelHint).toBe("openrouter/free");
  });

  it("honours an explicit openrouter/free hint when tools are not required", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes({ tools: false }, { model: "openrouter/free" });
    const or = plan.providers.find((p) => p.provider === "openrouter");
    expect(or!.models[0]).toBe("openrouter/free");
    expect(plan.droppedModelHint).toBeUndefined();
  });

  it("OPENROUTER_MODEL=openrouter/free override cannot force the auto-router into a tool-required plan", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ);
    const or = plan.providers.find((p) => p.provider === "openrouter");
    expect(or!.models).not.toContain("openrouter/free");
  });

  it("fails truthfully at the plan level when no tool-capable provider remains", () => {
    // No credentials anywhere — every provider is excluded with an honest
    // reason rather than the plan pretending a route exists. The launch
    // flow turns this empty plan into TOOL_EXECUTION_UNAVAILABLE upstream.
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ);
    expect(plan.providers).toHaveLength(0);
    expect(plan.excluded.length).toBeGreaterThan(0);
    for (const e of plan.excluded) {
      expect(e.reason).toBeTruthy();
    }
  });
});

describe("provider registry — BUILD initial selection requires proven writers", () => {
  const BUILD_REQ = { tools: true, coding: true, reliableFileWriting: true };

  it("excludes chat-only and unproven models from the openrouter BUILD attempt list", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(BUILD_REQ);
    const or = plan.providers.find((p) => p.provider === "openrouter");
    expect(or).toBeDefined();
    // cohere/north-mini-code:free is proven read-only; qwen3.8-27b:free is
    // not yet run-proven — neither may lead a BUILD.
    expect(or!.models).not.toContain("cohere/north-mini-code:free");
    expect(or!.models).not.toContain("qwen/qwen3.8-27b:free");
    // Proven writers remain: gemma-4-31b-it:free via OpenRouter.
    expect(or!.models).toContain("google/gemma-4-31b-it:free");
  });

  it("drops a chat-only model hint on BUILD requests instead of resurrecting it", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(BUILD_REQ, { model: "cohere/north-mini-code:free" });
    const or = plan.providers.find((p) => p.provider === "openrouter");
    expect(or!.models).not.toContain("cohere/north-mini-code:free");
    // Surfaced, not silent — the caller logs model_hint_dropped.
    expect(plan.droppedModelHint).toBe("cohere/north-mini-code:free");
  });

  it("still honours a proven-writer hint on BUILD requests", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(BUILD_REQ, { model: "google/gemma-4-31b-it:free" });
    const or = plan.providers.find((p) => p.provider === "openrouter");
    expect(or!.models[0]).toBe("google/gemma-4-31b-it:free");
    expect(plan.droppedModelHint).toBeUndefined();
  });

  it("keeps chat-only models eligible for plain tool-chat (no writer requirement)", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ);
    const or = plan.providers.find((p) => p.provider === "openrouter");
    expect(or!.models).toContain("cohere/north-mini-code:free");
  });
});

describe("provider registry — failure classification", () => {
  it("classifies 401 as provider-scope auth_invalid", () => {
    const f = classifyHttpFailure(401, '{"error":"invalid key"}');
    expect(f.class).toBe("auth_invalid");
    expect(f.scope).toBe("provider");
    expect(f.httpStatus).toBe(401);
  });

  it("classifies 402 as provider-scope billing — no retry behind the same account", () => {
    const f = classifyHttpFailure(402, '{"error":"insufficient credits"}');
    expect(f.class).toBe("billing");
    expect(f.scope).toBe("provider");
  });

  it("classifies provider-level 403 vs model-level 403", () => {
    const account = classifyHttpFailure(403, '{"error":"key not permitted for this account"}');
    expect(account.scope).toBe("provider");
    const model = classifyHttpFailure(403, '{"error":"model access not allowed"}');
    expect(model.scope).toBe("model");
  });

  it("classifies 404 as model_unavailable (not auth_invalid)", () => {
    const f = classifyHttpFailure(404, "model not found");
    expect(f.class).toBe("model_unavailable");
    expect(f.scope).toBe("model");
    expect(f.class).not.toBe("auth_invalid");
  });

  it("classifies 503 as provider-scope server_error", () => {
    const f = classifyHttpFailure(503, "Service unavailable");
    expect(f.class).toBe("server_error");
    expect(f.scope).toBe("provider");
  });

  it("classifies 404 and 400 as model-scope", () => {
    expect(classifyHttpFailure(404, "model not found").scope).toBe("model");
    expect(classifyHttpFailure(400, "bad request").scope).toBe("model");
  });

  it("classifies Google 400 'API key not valid' as provider-scope auth_invalid (dead key, not dead model)", () => {
    const f = classifyHttpFailure(
      400,
      '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
    );
    expect(f.class).toBe("auth_invalid");
    expect(f.scope).toBe("provider");
  });

  it("classifies 403 with auth-shaped body as auth_invalid", () => {
    const f = classifyHttpFailure(403, '{"error":"API key not valid"}');
    expect(f.class).toBe("auth_invalid");
    expect(f.scope).toBe("provider");
  });

  it("classifies 408/429/5xx correctly", () => {
    expect(classifyHttpFailure(408, "").class).toBe("timeout");
    const rl = classifyHttpFailure(429, "rate limited", 12_000);
    expect(rl.class).toBe("rate_limited");
    expect(rl.retryAfterMs).toBe(12_000);
    expect(classifyHttpFailure(500, "oops").class).toBe("server_error");
    expect(classifyHttpFailure(503, "unavailable").scope).toBe("provider");
  });

  it("parses Retry-After from headers and bodies", () => {
    const headers = new Headers({ "retry-after": "7" });
    expect(parseRetryAfterMs(headers, "")).toBe(7_000);
    expect(parseRetryAfterMs(null, '{"retryDelay":"12s"}')).toBe(12_000);
  });

  it("parses Google's compound 'retry in XhYmZs' quota hint", () => {
    const body =
      '{"error":{"code":429,"message":"Quota exceeded ... Please retry in 9h48m52.106458201s."}}';
    const parsed = parseRetryAfterMs(null, body);
    expect(parsed).toBeCloseTo((9 * 3600 + 48 * 60 + 52.106458) * 1000, 0);
    // Single-unit forms also parse.
    expect(parseRetryAfterMs(null, "Please retry in 45.5s")).toBeCloseTo(45_500, -2);
  });

  it("honours a provider-stated multi-hour 429 delay instead of the 10-minute cap", () => {
    const statedMs = (9 * 3600 + 48 * 60) * 1000;
    recordProviderFailure("gemini", {
      class: "rate_limited",
      scope: "provider",
      retryAfterMs: statedMs,
      message: "quota",
    });
    const h = getProviderHealth("gemini");
    expect(h.state).toBe("cooldown");
    expect(h.cooldownUntil).toBeGreaterThan(Date.now() + statedMs - 5_000);
    // …but an absurd stated delay is still bounded at one day.
    recordProviderFailure("gemini", {
      class: "rate_limited",
      scope: "provider",
      retryAfterMs: 7 * 24 * 60 * 60_000,
      message: "quota",
    });
    expect(getProviderHealth("gemini").cooldownUntil).toBeLessThanOrEqual(
      Date.now() + 24 * 60 * 60_000 + 1_000,
    );
  });

  it("extracts the multi-hour retry hint from thrown 429 errors", () => {
    const f = classifyThrownFailure(
      new Error("HTTP 429: quota exceeded. Please retry in 9h48m52.106458201s"),
    );
    expect(f.class).toBe("rate_limited");
    expect(f.retryAfterMs).toBeGreaterThan(35_000_000);
  });

  it("classifies thrown errors: timeout, 429-in-message, 5xx-in-message, network", () => {
    expect(classifyThrownFailure(new Error("Gemini direct request timed out after 30000ms")).class).toBe("timeout");
    expect(classifyThrownFailure(new Error("429 Too Many Requests")).class).toBe("rate_limited");
    expect(classifyThrownFailure(new Error("500 Internal Server Error")).class).toBe("server_error");
    expect(classifyThrownFailure(new Error("fetch failed")).class).toBe("network");
  });

  it("sanitizes secrets out of failure messages", () => {
    const f = classifyHttpFailure(401, 'bad key sk-abc123def456 Bearer tok_secret');
    expect(f.message).not.toContain("sk-abc123def456");
    expect(f.message).not.toContain("tok_secret");
  });
});

describe("providerDiagnostics", () => {
  it("reports state and credential presence without secret values", () => {
    vi.stubEnv("GEMINI_API_KEY", "super-secret-key-value");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const diag = providerDiagnostics();
    expect(diag.gemini.credential).toBe("available");
    expect(JSON.stringify(diag)).not.toContain("super-secret-key-value");
  });
});

describe("provider registry — env override safety (no silent unknown-model fallback)", () => {
  it("an unknown OPENROUTER_MODEL string never enters the route plan", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    for (const bad of ["fake-model-xyz", "unknown/fake-model:free"]) {
      // The registry itself rejects the string…
      const check = validateEnvOverride("OPENROUTER_MODEL", bad, { tools: true });
      expect(check.valid).toBe(false);
      // …and the planner never hands it to the OpenRouter adapter.
      vi.stubEnv("OPENROUTER_MODEL", bad);
      const plan = planBasicRoutes(TOOL_REQ, {});
      const or = plan.providers.find((p) => p.provider === "openrouter");
      expect(or).toBeDefined();
      expect(or!.models).not.toContain(bad);
      // Registry defaults are used instead: the plan still has models.
      expect(or!.models.length).toBeGreaterThan(0);
      expect(or!.models).toContain("cohere/north-mini-code:free");
    }
  });

  it("an unknown GEMINI_PRIMARY_MODEL never reaches the Gemini adapter", () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("GEMINI_PRIMARY_MODEL", "gemini-9.9-ultra");
    const plan = planBasicRoutes(TOOL_REQ, {});
    const gemini = plan.providers.find((p) => p.provider === "gemini");
    expect(gemini).toBeDefined();
    expect(gemini!.models).not.toContain("gemini-9.9-ultra");
    expect(gemini!.models[0]).toBe("gemini-flash-latest");
  });
});

describe("provider registry — per-model quota routing", () => {
  it("the Gemini ladder carries the lite rung between primary and fallback", () => {
    vi.stubEnv("GEMINI_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ);
    const gemini = plan.providers.find((p) => p.provider === "gemini");
    expect(gemini).toBeDefined();
    expect(gemini!.models).toEqual([
      "gemini-flash-latest",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
    ]);
    expect(gemini!.perModelRateLimits).toBe(true);
  });

  it("per-model-quota providers are flagged; per-account providers are not", () => {
    for (const k of ["GEMINI_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY"]) {
      vi.stubEnv(k, "x");
    }
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const plan = planBasicRoutes(TOOL_REQ);
    const flags = Object.fromEntries(
      plan.providers.map((p) => [p.provider, p.perModelRateLimits === true]),
    );
    expect(flags.gemini).toBe(true);
    expect(flags.openrouter).toBe(true);
    expect(flags.groq).toBe(true);
    expect(flags.mistral).toBe(true);
  });

  it("Groq carries the free-tier 8k per-request ceiling, env-overridable for paid tiers", () => {
    vi.stubEnv("GROQ_API_KEY", "x");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    const groq = planBasicRoutes(TOOL_REQ).providers.find((p) => p.provider === "groq");
    expect(groq?.requestTokenCeiling).toBe(8_000);
    vi.stubEnv("GROQ_REQUEST_TOKEN_CEILING", "100000");
    const raised = planBasicRoutes(TOOL_REQ).providers.find((p) => p.provider === "groq");
    expect(raised?.requestTokenCeiling).toBe(100_000);
  });

  it("recordModelFailure honours a provider-stated retry delay", () => {
    vi.useFakeTimers();
    try {
      recordModelFailure("gemini", "gemini-2.5-flash", 20_000);
      expect(isModelCoolingDown("gemini", "gemini-2.5-flash")).toBe(true);
      // Still cooling past the old unconditional window is wrong for a
      // 20s stated wait — but inside it the model must stay out.
      vi.advanceTimersByTime(21_000);
      expect(isModelCoolingDown("gemini", "gemini-2.5-flash")).toBe(false);
      // A multi-hour stated wait keeps the model out well past the old
      // flat 10-minute cap.
      recordModelFailure("gemini", "gemini-2.5-pro", 2 * 60 * 60_000);
      vi.advanceTimersByTime(11 * 60_000);
      expect(isModelCoolingDown("gemini", "gemini-2.5-pro")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recordModelFailure without a stated wait keeps the default cooldown", () => {
    vi.useFakeTimers();
    try {
      recordModelFailure("gemini", "gemini-2.5-flash");
      vi.advanceTimersByTime(9 * 60_000);
      expect(isModelCoolingDown("gemini", "gemini-2.5-flash")).toBe(true);
      vi.advanceTimersByTime(2 * 60_000);
      expect(isModelCoolingDown("gemini", "gemini-2.5-flash")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
