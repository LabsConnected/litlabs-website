import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_CATALOG,
  ModelRegistry,
  createEnvCredentialResolver,
  ProviderDiscoveryOrchestrator,
  HealthCache,
  envAccessorFromMap,
  parseOpenRouterModels,
  parseOpenAICompatibleModels,
  parseLocalModels,
  matchAgainstCatalog,
  applyDiscoveryToRegistry,
  type Fetcher,
  type FetchResponse,
  type DiscoveredModelEntry,
} from "../index.js";
import type { ProviderId } from "../index.js";

// ─── Fixtures ──────────────────────────────────────────────────────

/**
 * A scripted fetcher: maps URL → response. Lets tests simulate any
 * provider state (discovery ok, down, rate-limited, empty) deterministically.
 */
function scriptFetcher(scripts: Record<string, FetchResponse | (() => FetchResponse)>): Fetcher {
  return {
    async fetch(url: string): Promise<FetchResponse> {
      const s = scripts[url];
      if (!s) return { ok: false, status: 0, json: null, latencyMs: 10 };
      return typeof s === "function" ? s() : s;
    },
  };
}

function okResponse(json: unknown, latencyMs = 100): FetchResponse {
  return { ok: true, status: 200, json, latencyMs };
}

function downResponse(status = 0): FetchResponse {
  return { ok: false, status, json: null, latencyMs: 50 };
}

function rateLimitedResponse(): FetchResponse {
  return { ok: false, status: 429, json: null, latencyMs: 50 };
}

/** OpenRouter /models response shape with a subset of catalog slugs. */
function openRouterModelsBody(ids: string[]): unknown {
  return {
    data: ids.map((id) => ({
      id,
      name: id.split("/").pop(),
      context_length: 200_000,
      pricing: { prompt: "1", completion: "5" },
    })),
  };
}

/** OpenAI-compatible /v1/models response. */
function openAiCompatibleBody(ids: string[]): unknown {
  return { data: ids.map((id) => ({ id })) };
}

/** Ollama /api/tags response. */
function ollamaTagsBody(names: string[]): unknown {
  return { models: names.map((name) => ({ name })) };
}

const OR_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const OLLAMA_TAGS_URL = "http://localhost:11434/api/tags";
const LMSTUDIO_MODELS_URL = "http://localhost:1234/v1/models";

describe("installed custom Ollama models", () => {
  it("registers verified capabilities and marks a removed model offline", async () => {
    const r = registry({});
    const env = envAccessorFromMap({});
    const fetcher = scriptFetcher({
      [OLLAMA_TAGS_URL]: okResponse(ollamaTagsBody(["qwen3:4b-instruct"])),
      "http://localhost:11434/api/show": okResponse({
        capabilities: ["completion", "tools"],
        model_info: { "qwen3.context_length": 262144 },
      }),
    });
    await new ProviderDiscoveryOrchestrator(env, fetcher).refresh(r, { providers: ["ollama"] });
    const model = r.getById("ollama:qwen3:4b-instruct")!;
    assert.equal(model.providerModelId, "qwen3:4b-instruct");
    assert.equal(model.availability, "online");
    assert.equal(model.capabilities.tools, true);
    assert.equal(model.capabilities.coding, false);
    assert.ok(model.contextWindow <= 16384, "local context policy bounds advertised context");
    await new ProviderDiscoveryOrchestrator(env, scriptFetcher({
      [OLLAMA_TAGS_URL]: okResponse(ollamaTagsBody([])),
    })).refresh(r, { providers: ["ollama"] });
    assert.equal(r.getById(model.canonicalId)?.availability, "offline");
  });

  for (const details of [downResponse(), okResponse({ capabilities: ["embedding"] })]) {
    it(`does not advertise chat when details are ${details.ok ? "embedding-only" : "unavailable"}`, async () => {
      const r = registry({});
      const fetcher = scriptFetcher({
        [OLLAMA_TAGS_URL]: okResponse(ollamaTagsBody(["custom:model"])),
        "http://localhost:11434/api/show": details,
      });
      await new ProviderDiscoveryOrchestrator(envAccessorFromMap({}), fetcher).refresh(r, { providers: ["ollama"] });
      assert.equal(r.getById("ollama:custom:model"), undefined);
    });
  }
});

function onlyOpenRouterEnv(): Record<string, string | undefined> {
  return { OPENROUTER_API_KEY: "test-key" };
}

function allDirectEnv(): Record<string, string | undefined> {
  return {
    OPENAI_API_KEY: "test",
    ANTHROPIC_API_KEY: "test",
    GEMINI_API_KEY: "test",
    OPENROUTER_API_KEY: "test",
  };
}

function registry(env: Record<string, string | undefined> = onlyOpenRouterEnv()): ModelRegistry {
  return new ModelRegistry(MODEL_CATALOG, createEnvCredentialResolver(envAccessorFromMap(env).get));
}

// ─── Parser tests ──────────────────────────────────────────────────

describe("parseOpenRouterModels", () => {
  it("parses a standard OpenRouter /models response", () => {
    const body = openRouterModelsBody(["openai/gpt-5.6-luna", "anthropic/claude-sonnet-5"]);
    const entries = parseOpenRouterModels(body);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].id, "openai/gpt-5.6-luna");
    assert.equal(entries[0].name, "gpt-5.6-luna");
    assert.equal(entries[0].contextLength, 200_000);
    assert.equal(entries[0].pricing?.prompt, 1);
    assert.equal(entries[0].pricing?.completion, 5);
  });

  it("handles empty data array", () => {
    assert.equal(parseOpenRouterModels({ data: [] }).length, 0);
  });

  it("handles missing data field", () => {
    assert.equal(parseOpenRouterModels({}).length, 0);
    assert.equal(parseOpenRouterModels(null).length, 0);
    assert.equal(parseOpenRouterModels("not an object").length, 0);
  });

  it("skips entries without a string id", () => {
    const body = { data: [{ id: "ok" }, { id: 123 }, { noId: true }, { id: "also-ok" }] };
    const entries = parseOpenRouterModels(body);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].id, "ok");
    assert.equal(entries[1].id, "also-ok");
  });
});

describe("parseOpenAICompatibleModels", () => {
  it("parses OpenAI /v1/models shape", () => {
    const entries = parseOpenAICompatibleModels(openAiCompatibleBody(["gpt-5.6-luna", "gpt-5.6-sol"]), "openai");
    assert.equal(entries.length, 2);
    assert.equal(entries[0].id, "gpt-5.6-luna");
  });

  it("handles empty/missing data", () => {
    assert.equal(parseOpenAICompatibleModels({ data: [] }, "openai").length, 0);
    assert.equal(parseOpenAICompatibleModels({}, "openai").length, 0);
  });
});

describe("parseLocalModels", () => {
  it("parses Ollama /api/tags shape", () => {
    const entries = parseLocalModels(ollamaTagsBody(["qwen3-coder:latest", "llama3:8b"]), "ollama");
    assert.equal(entries.length, 2);
    assert.equal(entries[0].id, "qwen3-coder:latest");
    assert.equal(entries[0].name, "qwen3-coder:latest");
  });

  it("handles empty/missing models", () => {
    assert.equal(parseLocalModels({ models: [] }, "ollama").length, 0);
    assert.equal(parseLocalModels({}, "ollama").length, 0);
  });
});

// ─── Catalog matching ──────────────────────────────────────────────

describe("matchAgainstCatalog", () => {
  it("confirms catalog models whose openRouterModelId appears in discovered list", () => {
    const r = registry();
    const entries: DiscoveredModelEntry[] = [
      { id: "openai/gpt-5.6-luna" },
      { id: "anthropic/claude-sonnet-5" },
      { id: "some-other-model" },
    ];
    const result = matchAgainstCatalog(r, "openrouter", entries);
    assert.ok(result.confirmedCanonicalIds.includes("gpt-5.6-luna"));
    assert.ok(result.confirmedCanonicalIds.includes("claude-sonnet-5"));
    // Models not in the discovered list are missing
    assert.ok(result.missingCanonicalIds.includes("gpt-5.6-sol"));
  });

  it("for direct providers, matches on providerModelId", () => {
    const r = registry(allDirectEnv());
    const entries: DiscoveredModelEntry[] = [{ id: "gpt-5.6-luna" }, { id: "gpt-5.6-sol" }];
    const result = matchAgainstCatalog(r, "openai", entries);
    assert.ok(result.confirmedCanonicalIds.includes("gpt-5.6-luna"));
    assert.ok(result.confirmedCanonicalIds.includes("gpt-5.6-sol"));
    assert.ok(result.missingCanonicalIds.includes("gpt-5.6-terra"));
  });

  // Regression: cross-provider discovery clobber.
  // A dynamically discovered Ollama model has no openRouterModelId, so an
  // OpenRouter refresh has no identifier to look it up by. It must be skipped,
  // never reported missing — otherwise OpenRouter marks a live local model offline.
  it("does not mark a local-only Ollama model missing during OpenRouter discovery", async () => {
    const r = registry(onlyOpenRouterEnv());

    // 1. Bring the dynamic local model online through the real Ollama lane.
    await new ProviderDiscoveryOrchestrator(
      envAccessorFromMap({}),
      scriptFetcher({
        [OLLAMA_TAGS_URL]: okResponse(ollamaTagsBody(["qwen3:4b-instruct"])),
        "http://localhost:11434/api/show": okResponse({
          capabilities: ["completion", "tools"],
          model_info: { "qwen3.context_length": 262144 },
        }),
      }),
    ).refresh(r, { providers: ["ollama"] });

    const local = r.getById("ollama:qwen3:4b-instruct")!;
    assert.equal(local.provider, "ollama");
    assert.equal(local.providerModelId, "qwen3:4b-instruct");
    assert.equal(local.openRouterModelId, undefined);
    assert.equal(local.availability, "online");

    // 2. Run OpenRouter discovery, which considers registry.getAll().
    const orDiscovery = matchAgainstCatalog(r, "openrouter", [
      { id: "openai/gpt-5.6-luna" },
    ]);

    // 3. The local model has no OpenRouter identifier — it is neither confirmed
    //    nor missing for OpenRouter.
    assert.ok(!orDiscovery.missingCanonicalIds.includes("ollama:qwen3:4b-instruct"));
    assert.ok(!orDiscovery.confirmedCanonicalIds.includes("ollama:qwen3:4b-instruct"));
    // Real OpenRouter models absent from the live catalog are still missing.
    assert.ok(orDiscovery.missingCanonicalIds.includes("gpt-5.6-sol"));

    // 4. Availability survives the OpenRouter pass.
    applyDiscoveryToRegistry(r, orDiscovery);
    assert.equal(r.getById("ollama:qwen3:4b-instruct")!.availability, "online");
    assert.equal(r.getById("ollama:qwen3:4b-instruct")!.verified, true);
    assert.equal(r.getById("gpt-5.6-sol")!.availability, "offline");
  });

  it("still marks an Ollama model offline when it is absent from Ollama tags", () => {
    const r = registry({});
    const result = matchAgainstCatalog(r, "ollama", [{ id: "some-other-local-model" }]);
    for (const m of r.getByProvider("ollama")) {
      assert.ok(
        result.missingCanonicalIds.includes(m.canonicalId),
        `${m.canonicalId} should be missing from Ollama discovery`,
      );
    }
  });
});

// ─── applyDiscoveryToRegistry ──────────────────────────────────────

describe("applyDiscoveryToRegistry", () => {
  it("flips confirmed models to online + verified, missing to offline", () => {
    const r = registry();
    const luna = r.getById("gpt-5.6-luna")!;
    assert.equal(luna.availability, "unverified");
    assert.equal(luna.verified, false);

    applyDiscoveryToRegistry(r, {
      providerId: "openrouter",
      models: [],
      confirmedCanonicalIds: ["gpt-5.6-luna", "claude-sonnet-5"],
      missingCanonicalIds: ["gpt-5.6-sol"],
    });

    assert.equal(r.getById("gpt-5.6-luna")!.availability, "online");
    assert.equal(r.getById("gpt-5.6-luna")!.verified, true);
    assert.equal(r.getById("gpt-5.6-luna")!.source, "openrouter-catalog");
    assert.ok(r.getById("gpt-5.6-luna")!.verifiedAt);

    assert.equal(r.getById("gpt-5.6-sol")!.availability, "offline");
    assert.equal(r.getById("gpt-5.6-sol")!.verified, false);
  });

  it("does not overwrite catalog metadata (capabilities, pricing)", () => {
    const r = registry();
    const originalPricing = r.getById("gpt-5.6-luna")!.pricing;
    applyDiscoveryToRegistry(r, {
      providerId: "openrouter",
      models: [],
      confirmedCanonicalIds: ["gpt-5.6-luna"],
      missingCanonicalIds: [],
    });
    assert.deepEqual(r.getById("gpt-5.6-luna")!.pricing, originalPricing);
  });
});

// ─── ProviderDiscoveryOrchestrator ─────────────────────────────────

describe("ProviderDiscoveryOrchestrator", () => {
  it("OpenRouter discovery populates models and flips availability", async () => {
    const r = registry(onlyOpenRouterEnv());
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap(onlyOpenRouterEnv()),
      scriptFetcher({
        [OR_MODELS_URL]: okResponse(openRouterModelsBody([
          "openai/gpt-5.6-luna",
          "openai/gpt-5.6-terra",
          "anthropic/claude-sonnet-5",
          "google/gemini-3.7-flash",
        ])),
      }),
    );

    const report = await orchestrator.refresh(r, { providers: ["openrouter"] });

    assert.equal(report.totalConfirmed, 4);
    assert.equal(r.getById("gpt-5.6-luna")!.availability, "online");
    assert.equal(r.getById("gpt-5.6-terra")!.availability, "online");
    assert.equal(r.getById("gpt-5.6-sol")!.availability, "offline"); // not in discovered list
    assert.equal(r.getById("claude-sonnet-5")!.availability, "online");

    const orHealth = orchestrator.healthCache.get("openrouter")!;
    assert.equal(orHealth.tier, "discovery-ok");
    assert.equal(orHealth.discoveredCount, 4);
    assert.equal(orHealth.hasCredential, true);
    assert.equal(orHealth.servedBy, "openrouter");
  });

  it("OpenRouter down → all its models stay unverified, health tier down", async () => {
    const r = registry(onlyOpenRouterEnv());
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap(onlyOpenRouterEnv()),
      scriptFetcher({ [OR_MODELS_URL]: downResponse() }),
    );

    const report = await orchestrator.refresh(r, { providers: ["openrouter"] });

    assert.equal(report.totalConfirmed, 0);
    // Models stay unverified (not flipped to offline — discovery failed, not "model missing")
    assert.equal(r.getById("gpt-5.6-luna")!.availability, "unverified");

    const orHealth = orchestrator.healthCache.get("openrouter")!;
    assert.equal(orHealth.tier, "down");
  });

  it("OpenRouter rate-limited → degraded tier", async () => {
    const r = registry(onlyOpenRouterEnv());
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap(onlyOpenRouterEnv()),
      scriptFetcher({ [OR_MODELS_URL]: rateLimitedResponse() }),
    );

    await orchestrator.refresh(r, { providers: ["openrouter"] });
    assert.equal(orchestrator.healthCache.get("openrouter")!.tier, "degraded");
  });

  it("no credential → configured tier, no discovery", async () => {
    const r = registry({});
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap({}),
      scriptFetcher({}),
    );

    await orchestrator.refresh(r, { providers: ["openrouter"] });
    const health = orchestrator.healthCache.get("openrouter")!;
    assert.equal(health.tier, "configured");
    assert.equal(health.hasCredential, false);
  });

  it("direct provider (OpenAI) with direct key does its own discovery", async () => {
    const r = registry(allDirectEnv());
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap(allDirectEnv()),
      scriptFetcher({
        [OPENAI_MODELS_URL]: okResponse(openAiCompatibleBody(["gpt-5.6-luna", "gpt-5.6-sol"])),
      }),
    );

    await orchestrator.refresh(r, { providers: ["openai"] });
    assert.equal(r.getById("gpt-5.6-luna")!.availability, "online");
    assert.equal(r.getById("gpt-5.6-sol")!.availability, "online");
    assert.equal(r.getById("gpt-5.6-terra")!.availability, "offline"); // missing from discovery
    assert.equal(orchestrator.healthCache.get("openai")!.tier, "discovery-ok");
  });

  it("direct provider served via OpenRouter skips native check", async () => {
    // Only OpenRouter key set → OpenAI is servedBy openrouter, so the
    // orchestrator should NOT check OpenAI's native endpoint.
    const r = registry(onlyOpenRouterEnv());
    let openaiCalled = false;
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap(onlyOpenRouterEnv()),
      {
        async fetch(url: string): Promise<FetchResponse> {
          if (url === OPENAI_MODELS_URL) { openaiCalled = true; return okResponse({ data: [] }); }
          if (url === OR_MODELS_URL) return okResponse(openRouterModelsBody(["openai/gpt-5.6-luna"]));
          return downResponse();
        },
      },
    );

    await orchestrator.refresh(r, { providers: ["openai", "openrouter"] });
    assert.equal(openaiCalled, false, "OpenAI native endpoint should NOT be called when served via OpenRouter");
    assert.equal(orchestrator.healthCache.get("openai")!.tier, "configured");
    assert.equal(orchestrator.healthCache.get("openai")!.reason, "Served via OpenRouter");
  });

  it("local provider DOWN → offline models, down tier", async () => {
    const r = registry({ OLLAMA_HOST: "localhost" });
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap({}),
      scriptFetcher({ [OLLAMA_TAGS_URL]: downResponse() }),
    );

    await orchestrator.refresh(r, { providers: ["ollama"] });
    const health = orchestrator.healthCache.get("ollama")!;
    assert.equal(health.tier, "down");
    assert.equal(health.reason, "Local server not running");
  });

  it("local provider UP with models → discovery-ok", async () => {
    const r = registry({});
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap({}),
      scriptFetcher({ [OLLAMA_TAGS_URL]: okResponse(ollamaTagsBody(["qwen3-coder:latest"])) }),
    );

    await orchestrator.refresh(r, { providers: ["ollama"] });
    assert.equal(orchestrator.healthCache.get("ollama")!.tier, "discovery-ok");
    assert.equal(orchestrator.healthCache.get("ollama")!.discoveredCount, 1);
  });

  it("local provider UP via LITT_OLLAMA_URL (LAN endpoint) → discovery-ok", async () => {
    const LAN_OLLAMA_TAGS_URL = "http://192.168.0.77:11434/api/tags";
    const r = registry({});
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap({ LITT_OLLAMA_URL: "http://192.168.0.77:11434" }),
      scriptFetcher({ [LAN_OLLAMA_TAGS_URL]: okResponse(ollamaTagsBody(["qwen3-coder:latest"])) }),
    );

    await orchestrator.refresh(r, { providers: ["ollama"] });
    const health = orchestrator.healthCache.get("ollama")!;
    assert.equal(health.tier, "discovery-ok");
    assert.equal(health.discoveredCount, 1);
  });

  it("local provider DOWN via LITT_OLLAMA_URL (unreachable LAN) → down tier", async () => {
    const r = registry({});
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap({ LITT_OLLAMA_URL: "http://192.168.99.99:11434" }),
      scriptFetcher({}), // no URLs registered → all fetches return down
    );

    await orchestrator.refresh(r, { providers: ["ollama"] });
    const health = orchestrator.healthCache.get("ollama")!;
    assert.equal(health.tier, "down");
  });

  it("skipDiscovery option → health check only, no model mutation", async () => {
    const r = registry(onlyOpenRouterEnv());
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap(onlyOpenRouterEnv()),
      scriptFetcher({ [OR_MODELS_URL]: okResponse(openRouterModelsBody(["openai/gpt-5.6-luna"])) }),
    );

    await orchestrator.refresh(r, { providers: ["openrouter"], skipDiscovery: true });
    // skipDiscovery → only health check, models NOT flipped
    assert.equal(r.getById("gpt-5.6-luna")!.availability, "unverified");
    assert.equal(orchestrator.healthCache.get("openrouter")!.tier, "authenticated");
  });

  it("HealthCache TTL — isFresh after refresh, stale after TTL", async () => {
    const cache = new HealthCache(50); // 50ms TTL
    assert.equal(cache.isFresh(), false);
    cache.set({ providerId: "openrouter", tier: "discovery-ok", hasCredential: true, servedBy: "openrouter", latencyMs: 10, discoveredCount: 5, reason: "ok", checkedAt: Date.now(), error: null });
    cache.markRefreshed();
    assert.equal(cache.isFresh(), true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(cache.isFresh(), false);
  });

  it("refreshAsync does not block and updates cache in background", async () => {
    const r = registry(onlyOpenRouterEnv());
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap(onlyOpenRouterEnv()),
      scriptFetcher({ [OR_MODELS_URL]: okResponse(openRouterModelsBody(["openai/gpt-5.6-luna"])) }),
    );
    // Should return immediately
    orchestrator.refreshAsync(r, { providers: ["openrouter"] });
    // Wait for background refresh
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(orchestrator.healthCache.get("openrouter"));
    assert.equal(orchestrator.healthCache.get("openrouter")!.tier, "discovery-ok");
  });

  it("refreshAsync is a no-op when cache is fresh", async () => {
    const r = registry(onlyOpenRouterEnv());
    let fetchCount = 0;
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap(onlyOpenRouterEnv()),
      {
        async fetch(url: string): Promise<FetchResponse> {
          if (url === OR_MODELS_URL) { fetchCount++; return okResponse(openRouterModelsBody([])); }
          return downResponse();
        },
      },
    );
    await orchestrator.refresh(r, { providers: ["openrouter"] });
    const firstCount = fetchCount;
    orchestrator.refreshAsync(r, { providers: ["openrouter"] }); // should be no-op (fresh)
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(fetchCount, firstCount, "refreshAsync should not fetch when cache is fresh");
  });

  it("unknown model handled safely (not in catalog, not confirmed)", async () => {
    const r = registry(onlyOpenRouterEnv());
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap(onlyOpenRouterEnv()),
      scriptFetcher({
        [OR_MODELS_URL]: okResponse(openRouterModelsBody([
          "openai/gpt-5.6-luna",
          "totally-unknown/future-model",
        ])),
      }),
    );

    const report = await orchestrator.refresh(r, { providers: ["openrouter"] });
    // Only catalog models are confirmed; unknown model is ignored
    assert.ok(report.confirmedCanonicalIds.includes("gpt-5.6-luna"));
    assert.ok(!report.confirmedCanonicalIds.includes("totally-unknown/future-model"));
  });

  it("LM Studio discovery works", async () => {
    const r = registry({});
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap({}),
      scriptFetcher({ [LMSTUDIO_MODELS_URL]: okResponse(openAiCompatibleBody(["qwen3-coder"])) }),
    );
    await orchestrator.refresh(r, { providers: ["lmstudio"] });
    assert.equal(orchestrator.healthCache.get("lmstudio")!.tier, "discovery-ok");
  });

  it("getDiscoveredCount reflects confirmed models", async () => {
    const r = registry(onlyOpenRouterEnv());
    const orchestrator = new ProviderDiscoveryOrchestrator(
      envAccessorFromMap(onlyOpenRouterEnv()),
      scriptFetcher({
        [OR_MODELS_URL]: okResponse(openRouterModelsBody([
          "openai/gpt-5.6-luna",
          "openai/gpt-5.6-terra",
          "anthropic/claude-sonnet-5",
        ])),
      }),
    );
    await orchestrator.refresh(r, { providers: ["openrouter"] });
    assert.equal(r.getDiscoveredCount(), 3);
    assert.equal(r.getDiscoveredCountByProvider("openai"), 2);
    assert.equal(r.getDiscoveredCountByProvider("anthropic"), 1);
  });
});
