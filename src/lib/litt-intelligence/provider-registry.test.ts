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
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "VERCEL",
];

const TOOL_REQ = { tools: true, coding: true };

beforeEach(() => {
  _resetProviderHealthForTests();
  vi.unstubAllEnvs();
  for (const key of PROVIDER_ENVS) vi.stubEnv(key, "");
});

afterEach(() => {
  _resetProviderHealthForTests();
  vi.unstubAllEnvs();
});

describe("provider registry — Basic cost policy", () => {
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

  it("classifies 404 and 400 as model-scope", () => {
    expect(classifyHttpFailure(404, "model not found").scope).toBe("model");
    expect(classifyHttpFailure(400, "bad request").scope).toBe("model");
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
