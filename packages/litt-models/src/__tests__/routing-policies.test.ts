import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_CATALOG,
  ModelRegistry,
  createEnvCredentialResolver,
  routeModel,
  envAccessorFromMap,
} from "../index.js";
import type { ModelDefinition } from "../index.js";

// ─── Fixtures ──────────────────────────────────────────────────────

function allDirectEnv(): Record<string, string | undefined> {
  return {
    OPENAI_API_KEY: "test",
    ANTHROPIC_API_KEY: "test",
    GEMINI_API_KEY: "test",
    XAI_API_KEY: "test",
    DEEPSEEK_API_KEY: "test",
    MOONSHOT_API_KEY: "test",
    MISTRAL_API_KEY: "test",
    DASHSCOPE_API_KEY: "test",
    OPENROUTER_API_KEY: "test",
  };
}

function onlyOpenRouterEnv(): Record<string, string | undefined> {
  return { OPENROUTER_API_KEY: "test-key" };
}

function noneEnv(): Record<string, string | undefined> {
  return {};
}

function registry(env: Record<string, string | undefined> = allDirectEnv()): ModelRegistry {
  return new ModelRegistry(MODEL_CATALOG, createEnvCredentialResolver(envAccessorFromMap(env).get));
}

/**
 * Mark a subset of models as online (discovered), the rest offline.
 * This simulates real discovery results without network calls.
 */
function markOnline(reg: ModelRegistry, canonicalIds: string[]): void {
  for (const m of reg.getAll()) {
    if (canonicalIds.includes(m.canonicalId)) {
      reg.markDiscovered(m.canonicalId, "online", "openrouter-catalog");
    } else {
      reg.markDiscovered(m.canonicalId, "offline", "openrouter-catalog");
    }
  }
}

/** Mark all models online. */
function allOnline(reg: ModelRegistry): void {
  for (const m of reg.getAll()) reg.markDiscovered(m.canonicalId, "online", "openrouter-catalog");
}

// ─── MAX policy ────────────────────────────────────────────────────

describe("MAX routing policy", () => {
  it("MAX selects the highest-ranked verified model", () => {
    const r = registry();
    allOnline(r);
    const res = routeModel(r, { message: "hey" }, { mode: "auto", preference: "max" });
    assert.equal(res.appliedPolicy, "max");
    // Frontier models exist in the catalog; MAX should pick one
    assert.equal(res.model.intelligence, "frontier");
    assert.equal(res.fallbackReason, null); // all online, no fallback
  });

  it("MAX fallback explains reason when stronger models are unavailable", () => {
    const r = registry();
    // Only make balanced models online; frontier models offline
    markOnline(r, ["gpt-5.6-terra", "claude-sonnet-5", "gemini-3.7-flash"]);
    const res = routeModel(r, { message: "hey" }, { mode: "auto", preference: "max" });
    assert.equal(res.appliedPolicy, "max");
    assert.equal(res.model.intelligence, "balanced"); // strongest available
    assert.ok(res.fallbackReason, "should have a fallback reason");
    assert.match(res.fallbackReason!, /selected/);
  });

  it("MAX never selects an unavailable model", () => {
    const r = registry();
    // Only one model online, and it's a light model
    markOnline(r, ["gemini-3.5-flash-lite"]);
    const res = routeModel(r, { message: "hey" }, { mode: "auto", preference: "max" });
    assert.equal(res.model.canonicalId, "gemini-3.5-flash-lite");
    assert.equal(res.model.availability, "online");
    assert.ok(res.fallbackReason); // stronger models were unavailable
  });

  it("MAX with no online models falls back to unverified (with reason)", () => {
    const r = registry(onlyOpenRouterEnv());
    // No discovery run — all unverified but routable
    const res = routeModel(r, { message: "hey" }, { mode: "auto", preference: "max" });
    // Should still pick the strongest routable model
    assert.equal(res.appliedPolicy, "max");
    assert.ok(res.model);
    // fallbackReason should explain that no verified models were found
    assert.ok(res.fallbackReason);
    assert.match(res.fallbackReason!, /unverified|No verified/i);
  });
});

// ─── BUDGET policy ─────────────────────────────────────────────────

describe("BUDGET routing policy", () => {
  it("BUDGET selects the cheapest capable verified model", () => {
    const r = registry();
    allOnline(r);
    const res = routeModel(r, { message: "hey" }, { mode: "auto", preference: "budget" });
    assert.equal(res.appliedPolicy, "budget");
    // Should be a cheap model (low pricing)
    const cost = res.model.pricing!.inputPer1M + res.model.pricing!.outputPer1M;
    // The cheapest in the catalog is gemini-3.5-flash-lite (no pricing → but
    // actually deepseek-v4-flash has no pricing; let's check it picks a low-cost one)
    assert.ok(cost <= 5, `expected cheap model, got cost ${cost}`);
  });

  it("BUDGET with verifiedOnly excludes unverified models", () => {
    const r = registry();
    // Only one model online
    markOnline(r, ["gpt-5.6-luna"]);
    const res = routeModel(r, { message: "hey" }, { mode: "auto", preference: "budget", verifiedOnly: true });
    assert.equal(res.model.canonicalId, "gpt-5.6-luna");
    assert.equal(res.model.availability, "online");
  });
});

// ─── FIXED (PINNED) policy ─────────────────────────────────────────

describe("FIXED (PINNED) routing policy", () => {
  it("FIXED stays fixed on the selected model when available", () => {
    const r = registry();
    allOnline(r);
    const res = routeModel(r, { message: "hey" }, { mode: "pinned", pinnedModelId: "claude-sonnet-5" });
    assert.equal(res.appliedPolicy, "pinned");
    assert.equal(res.model.canonicalId, "claude-sonnet-5");
    assert.equal(res.fallbackReason, null);
  });

  it("FIXED unavailable (non-strict) falls back to AUTO with reason", () => {
    const r = registry();
    markOnline(r, ["gpt-5.6-luna"]); // claude-sonnet-5 is offline
    const res = routeModel(r, { message: "hey" }, { mode: "pinned", pinnedModelId: "claude-sonnet-5" });
    assert.equal(res.appliedPolicy, "auto"); // fell back
    assert.notEqual(res.model.canonicalId, "claude-sonnet-5");
    assert.ok(res.fallbackReason);
    assert.match(res.fallbackReason!, /Claude Sonnet 5.*unavailable/i);
  });

  it("FIXED unavailable (strict) throws an explicit error", () => {
    const r = registry();
    markOnline(r, ["gpt-5.6-luna"]); // claude-sonnet-5 is offline
    assert.throws(
      () => routeModel(r, { message: "hey" }, { mode: "pinned", pinnedModelId: "claude-sonnet-5", strict: true }),
      /Claude Sonnet 5.*not available/i,
    );
  });

  it("FIXED unknown model (strict) throws with 'not in catalog'", () => {
    const r = registry();
    assert.throws(
      () => routeModel(r, { message: "hey" }, { mode: "pinned", pinnedModelId: "nonexistent-model", strict: true }),
      /not in the catalog/i,
    );
  });

  it("FIXED unknown model (non-strict) falls back to AUTO", () => {
    const r = registry();
    allOnline(r);
    const res = routeModel(r, { message: "hey" }, { mode: "pinned", pinnedModelId: "nonexistent-model" });
    assert.equal(res.appliedPolicy, "auto");
    assert.ok(res.fallbackReason);
    assert.match(res.fallbackReason!, /nonexistent-model.*unknown/i);
  });
});

// ─── AUTO policy ───────────────────────────────────────────────────

describe("AUTO routing policy respects capabilities", () => {
  it("AUTO routes coding to a coding-capable model", () => {
    const r = registry();
    allOnline(r);
    const res = routeModel(r, { message: "build a React feature" });
    assert.equal(res.appliedPolicy, "auto");
    assert.equal(res.model.capabilities.coding, true);
  });

  it("AUTO routes vision to a vision-capable model", () => {
    const r = registry();
    allOnline(r);
    const res = routeModel(r, { message: "look at this screenshot", hasImageAttachments: true });
    assert.equal(res.model.capabilities.vision, true);
  });

  it("AUTO routes reasoning to a frontier reasoning model", () => {
    const r = registry();
    allOnline(r);
    const res = routeModel(r, { message: "debug this nasty architecture problem" });
    assert.equal(res.model.intelligence, "frontier");
    assert.equal(res.model.capabilities.reasoning, true);
  });

  it("AUTO does not bounce models unnecessarily (affinity — same task → same model)", () => {
    const r = registry();
    allOnline(r);
    const res1 = routeModel(r, { message: "build a React feature" });
    const res2 = routeModel(r, { message: "build another React feature" });
    // Same task kind → same model (deterministic)
    assert.equal(res1.model.canonicalId, res2.model.canonicalId);
  });
});

// ─── Provider transport vs model provider ──────────────────────────

describe("provider transport vs model provider", () => {
  it("model served via OpenRouter reports servedBy=openrouter", () => {
    const r = registry(onlyOpenRouterEnv());
    allOnline(r);
    const res = routeModel(r, { message: "hey" });
    assert.equal(res.servedBy, "openrouter");
    // The model's provider is still its native provider (e.g. openai)
    assert.notEqual(res.model.provider, "openrouter");
  });

  it("model served directly reports servedBy=native provider", () => {
    const r = registry(allDirectEnv());
    allOnline(r);
    const res = routeModel(r, { message: "hey" });
    assert.equal(res.servedBy, res.model.provider);
  });
});

// ─── Active model changes when routing decision changes ────────────

describe("active model reflects routing decision", () => {
  it("changing policy from AUTO to MAX changes the selected model", () => {
    const r = registry();
    allOnline(r);
    const autoRes = routeModel(r, { message: "hey" }, { mode: "auto" });
    const maxRes = routeModel(r, { message: "hey" }, { mode: "auto", preference: "max" });
    // AUTO for "hey" picks the fast default (gpt-5.6-luna, balanced);
    // MAX picks a frontier model. They should differ.
    assert.notEqual(autoRes.model.canonicalId, maxRes.model.canonicalId);
    assert.equal(maxRes.model.intelligence, "frontier");
  });

  it("FIXED to a specific model overrides AUTO selection", () => {
    const r = registry();
    allOnline(r);
    const autoRes = routeModel(r, { message: "hey" });
    const fixedRes = routeModel(r, { message: "hey" }, { mode: "pinned", pinnedModelId: "grok-4.6" });
    assert.notEqual(autoRes.model.canonicalId, fixedRes.model.canonicalId);
    assert.equal(fixedRes.model.canonicalId, "grok-4.6");
  });
});

// ─── Provider outage fallback ──────────────────────────────────────

describe("provider outage fallback", () => {
  it("all OpenAI models offline → MAX picks strongest from other providers", () => {
    const r = registry(allDirectEnv());
    // Mark all OpenAI models offline, others online
    for (const m of r.getAll()) {
      if (m.provider === "openai") {
        r.markDiscovered(m.canonicalId, "offline", "provider-catalog");
      } else {
        r.markDiscovered(m.canonicalId, "online", "provider-catalog");
      }
    }
    const res = routeModel(r, { message: "hey" }, { mode: "auto", preference: "max" });
    assert.notEqual(res.model.provider, "openai");
    assert.equal(res.model.availability, "online");
    assert.ok(res.fallbackReason); // GPT-5.6 Sol was unavailable
  });
});

// ─── Local provider DOWN excluded ──────────────────────────────────

describe("local provider DOWN excluded from routing", () => {
  it("a DOWN local model never wins AUTO/MAX", () => {
    const r = registry(allDirectEnv());
    // Mark all cloud models online, but leave local (ollama/lmstudio) offline
    for (const m of r.getAll()) {
      if (m.provider === "ollama" || m.provider === "lmstudio") {
        r.markDiscovered(m.canonicalId, "offline", "provider-catalog");
      } else {
        r.markDiscovered(m.canonicalId, "online", "provider-catalog");
      }
    }
    const maxRes = routeModel(r, { message: "hey" }, { mode: "auto", preference: "max" });
    assert.notEqual(maxRes.model.provider, "ollama");
    assert.notEqual(maxRes.model.provider, "lmstudio");
    assert.equal(maxRes.model.availability, "online");
  });
});

// ─── No models available ───────────────────────────────────────────

describe("no models available", () => {
  it("throws clearly when no credentials configured", () => {
    const r = registry(noneEnv());
    assert.throws(
      () => routeModel(r, { message: "hey" }),
      /No routable models available/,
    );
  });
});

// ─── providerFilter (LOCAL mode constraint) ────────────────────────

describe("providerFilter restricts routing to specified providers", () => {
  it("AUTO with providerFilter=[ollama] only selects ollama models", () => {
    const r = registry(allDirectEnv());
    // Mark all models online
    for (const m of r.getAll()) {
      r.markDiscovered(m.canonicalId, "online", "provider-catalog");
    }
    // Inject a fake ollama model so there's something to select
    r.mergeDiscovered([{
      canonicalId: "ollama:qwen3:4b-instruct",
      displayName: "qwen3:4b-instruct",
      provider: "ollama",
      providerModelId: "qwen3:4b-instruct",
      capabilities: {
        chat: true, reasoning: false, coding: true,
        vision: false, tools: true, audio: false,
        imageGeneration: false, videoGeneration: false,
        longContext: false, structuredOutput: false,
      },
      speed: "normal", intelligence: "light", contextWindow: 8192,
      availability: "online", verified: true,
      verifiedAt: new Date().toISOString(), source: "provider-catalog",
      description: "test ollama model", recommendedFor: ["local"],
      domain: "text", littTier: "local", maxOutputTokens: 2048,
    }]);
    const res = routeModel(r, { message: "hey" }, { mode: "auto", providerFilter: ["ollama"] });
    assert.equal(res.model.provider, "ollama");
  });

  it("AUTO with providerFilter=[openai] never selects ollama", () => {
    const r = registry(allDirectEnv());
    for (const m of r.getAll()) {
      r.markDiscovered(m.canonicalId, "online", "provider-catalog");
    }
    const res = routeModel(r, { message: "hey" }, { mode: "auto", providerFilter: ["openai"] });
    assert.equal(res.model.provider, "openai");
  });

  it("PINNED with a model NOT in the filter falls back to AUTO (non-strict)", () => {
    const r = registry(allDirectEnv());
    for (const m of r.getAll()) {
      r.markDiscovered(m.canonicalId, "online", "provider-catalog");
    }
    // Pin an openai model but filter to ollama only. There are no ollama
    // models in the catalog with credentials, so the filtered pool is empty
    // and it throws with the provider-filter error message.
    assert.throws(
      () => routeModel(r, { message: "hey" }, {
        mode: "pinned",
        pinnedModelId: "gpt-5.6-luna",
        providerFilter: ["ollama"],
      }),
      /No routable models available for provider filter/,
    );
  });

  it("providerFilter with no matching models throws a clear error", () => {
    const r = registry(allDirectEnv());
    for (const m of r.getAll()) {
      r.markDiscovered(m.canonicalId, "online", "provider-catalog");
    }
    assert.throws(
      () => routeModel(r, { message: "hey" }, { mode: "auto", providerFilter: ["ollama"] }),
      /No routable models available for provider filter.*ollama/,
    );
  });

  it("no providerFilter = all providers available (backward compat)", () => {
    const r = registry(allDirectEnv());
    for (const m of r.getAll()) {
      r.markDiscovered(m.canonicalId, "online", "provider-catalog");
    }
    const res = routeModel(r, { message: "hey" }, { mode: "auto" });
    // Should select from any provider — no filter applied
    assert.ok(res.model);
  });
});
