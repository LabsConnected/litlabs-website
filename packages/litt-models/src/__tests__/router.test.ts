import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_CATALOG,
  ModelRegistry,
  createEnvCredentialResolver,
  classifyTask,
  routeModel,
  brainLabel,
  cockpitStatusLine,
  shouldFallback,
} from "../index.js";
import type { ModelDefinition, ProviderId } from "../index.js";

// ─── Fixtures ──────────────────────────────────────────────────────
/** A resolver where every provider is credentialed directly (servedBy = self). */
function allDirect(): ReturnType<typeof createEnvCredentialResolver> {
  return createEnvCredentialResolver((key) => (key ? "set" : undefined));
}

/** A resolver where only OpenRouter is set (everything servedBy openrouter). */
function onlyOpenRouter(): ReturnType<typeof createEnvCredentialResolver> {
  return createEnvCredentialResolver((key) =>
    key === "OPENROUTER_API_KEY" ? "set" : undefined,
  );
}

/** A resolver where nothing is set. */
function none() {
  return createEnvCredentialResolver(() => undefined);
}

function registry(resolver = allDirect()): ModelRegistry {
  return new ModelRegistry(MODEL_CATALOG, resolver);
}

// ─── Tests ─────────────────────────────────────────────────────────
describe("ModelRegistry", () => {
  it("loads the V1 catalog", () => {
    const r = registry();
    const ids = r.getAll().map((m) => m.canonicalId);
    assert.ok(ids.includes("gpt-5.6-luna"));
    assert.ok(ids.includes("gpt-5.6-terra"));
    assert.ok(ids.includes("gpt-5.6-sol"));
    assert.ok(ids.includes("claude-sonnet-5"));
    assert.ok(ids.includes("claude-fable-5"));
    assert.ok(ids.includes("gemini-3.7-flash"));
    assert.ok(ids.includes("grok-4.6"));
    assert.ok(ids.includes("deepseek-v4-pro"));
    assert.ok(ids.includes("kimi-k3"));
    assert.ok(ids.includes("kimi-k2.7-code-highspeed"));
  });

  it("getAvailable filters by credential", () => {
    const r = registry(none());
    assert.equal(r.getAvailable().length, 0, "no credentials → no available models");
  });

  it("source truth: direct key serves directly, OpenRouter serves via openrouter", () => {
    const direct = registry(allDirect());
    const luna = direct.getById("gpt-5.6-luna")!;
    assert.equal(direct.servedBy(luna), "openai");
    assert.equal(direct.apiIdFor(luna), "gpt-5.6-luna");

    const orr = registry(onlyOpenRouter());
    const sonnet = orr.getById("claude-sonnet-5")!;
    assert.equal(orr.servedBy(sonnet), "openrouter");
    assert.equal(orr.apiIdFor(sonnet), "anthropic/claude-sonnet-5");
  });

  it("markProven flips availability to online", () => {
    const r = registry();
    const m = r.getById("gpt-5.6-luna")!;
    assert.notEqual(m.availability, "online");
    r.markProven("gpt-5.6-luna");
    assert.equal(r.getById("gpt-5.6-luna")!.availability, "online");
  });

  it("mergeDiscovered adds new models without overwriting catalog", () => {
    const r = registry();
    const future: ModelDefinition = {
      canonicalId: "gpt-5.7-luna",
      displayName: "GPT-5.7 Luna",
      provider: "openai" as ProviderId,
      providerModelId: "gpt-5.7-luna",
      openRouterModelId: "openai/gpt-5.7-luna",
      capabilities: {
        chat: true, reasoning: true, coding: true, vision: true, tools: true,
        audio: false, imageGeneration: false, videoGeneration: false,
        longContext: true, structuredOutput: true,
      },
      speed: "fast",
      intelligence: "frontier",
      contextWindow: 2_000_000,
      availability: "unverified",
      verified: false,
      verifiedAt: null,
      source: "unverified",
      description: "Future model",
      recommendedFor: ["fast"],
      domain: "text",
    };
    r.mergeDiscovered([future]);
    assert.ok(r.getById("gpt-5.7-luna"), "discovered model added");
    // Existing catalog entry not overwritten by a merge with same canonicalId
    r.mergeDiscovered([{ ...r.getById("gpt-5.6-luna")!, displayName: "OVERWRITE" }]);
    assert.equal(r.getById("gpt-5.6-luna")!.displayName, "GPT-5.6 Luna");
  });
});

describe("classifyTask", () => {
  it("classifies casual chat as fast", () => {
    assert.equal(classifyTask({ message: "hey what's up?" }), "fast");
  });

  it("classifies coding tasks", () => {
    assert.equal(classifyTask({ message: "build this React feature" }), "coding");
    assert.equal(classifyTask({ message: "fix the bug in auth.ts" }), "coding");
  });

  it("classifies deep reasoning", () => {
    assert.equal(classifyTask({ message: "debug this nasty architecture problem" }), "reasoning");
  });

  it("classifies large context", () => {
    assert.equal(
      classifyTask({ message: "analyze this entire repo for issues" }),
      "large-context",
    );
    assert.equal(
      classifyTask({ message: "summarize", estimatedContextTokens: 300_000 }),
      "large-context",
    );
  });

  it("classifies vision from attachments", () => {
    assert.equal(
      classifyTask({ message: "what is this", hasImageAttachments: true }),
      "vision",
    );
    assert.equal(classifyTask({ message: "look at this screenshot" }), "vision");
  });

  it("classifies agent workflows", () => {
    assert.equal(classifyTask({ message: "run the agent workflow to deploy" }), "agent");
  });
});

describe("routeModel", () => {
  it("AUTO routes fast chat to the fast default (gpt-5.6-luna)", () => {
    const r = registry();
    const res = routeModel(r, { message: "hey what's up?" });
    assert.equal(res.model.canonicalId, "gpt-5.6-luna");
    assert.equal(res.servedBy, "openai");
  });

  it("AUTO routes reasoning to the max default (gpt-5.6-sol)", () => {
    const r = registry();
    const res = routeModel(r, { message: "debug this nasty architecture problem" });
    assert.equal(res.model.canonicalId, "gpt-5.6-sol");
  });

  it("AUTO routes large context to kimi-k3", () => {
    const r = registry();
    const res = routeModel(r, { message: "analyze this entire repo" });
    assert.equal(res.model.canonicalId, "kimi-k3");
  });

  it("AUTO routes vision to a gemini model", () => {
    const r = registry();
    const res = routeModel(r, { message: "look at this screenshot", hasImageAttachments: true });
    assert.equal(res.model.provider, "google");
    assert.equal(res.model.littTier, "gemini");
  });

  it("PINNED respects a routable pinned model", () => {
    const r = registry();
    const res = routeModel(r, { message: "hey" }, { mode: "pinned", pinnedModelId: "claude-sonnet-5" });
    assert.equal(res.model.canonicalId, "claude-sonnet-5");
  });

  it("PINNED falls back to AUTO when the pinned model is not routable", () => {
    const r = registry(onlyOpenRouter()); // claude servedBy openrouter, still routable
    const res = routeModel(r, { message: "hey" }, { mode: "pinned", pinnedModelId: "claude-opus-5" });
    assert.equal(res.model.canonicalId, "claude-opus-5");
  });

  it("ASK respects a routable user choice", () => {
    const r = registry();
    const res = routeModel(r, { message: "hey" }, { mode: "ask", askChoice: "grok-4.6" });
    assert.equal(res.model.canonicalId, "grok-4.6");
  });

  it("throws when no models are routable", () => {
    const r = registry(none());
    assert.throws(() => routeModel(r, { message: "hey" }), /No routable models/);
  });

  it("never presents LiTT as equal to a single model (brain label)", () => {
    const r = registry();
    const res = routeModel(r, { message: "hey" });
    assert.equal(brainLabel("auto", res.model), "LiTT Auto");
    assert.equal(brainLabel("pinned", res.model), res.model.displayName);
  });

  it("cockpit status line includes mode + source + model + servedBy", () => {
    const r = registry();
    const res = routeModel(r, { message: "hey" });
    const line = cockpitStatusLine("auto", res.model, res.servedBy, res.credentialSource);
    assert.match(line, /LiTT READY/);
    assert.match(line, /AUTO/);
    assert.match(line, /GPT-5.6 Luna/);
  });
});

// ─── Fallback chain + shouldFallback ───────────────────────────────

describe("Fallback chain", () => {
  it("getFallbackChain puts the primary first", () => {
    const r = registry();
    const chain = r.getFallbackChain("gpt-5.6-sol", "coding");
    assert.equal(chain.length > 0, true);
    assert.equal(chain[0].canonicalId, "gpt-5.6-sol");
  });

  it("getFallbackChain includes other coding-capable models", () => {
    const r = registry();
    const chain = r.getFallbackChain("gpt-5.6-sol", "coding");
    const hasOther = chain.some(
      (m) => m.canonicalId !== "gpt-5.6-sol" && m.capabilities.coding,
    );
    assert.equal(hasOther, true);
  });

  it("getNextFallback skips tried models", () => {
    const r = registry();
    const first = r.getNextFallback("gpt-5.6-sol", "coding", []);
    assert.ok(first);
    const second = r.getNextFallback("gpt-5.6-sol", "coding", [first!.canonicalId]);
    assert.ok(second);
    assert.notEqual(second!.canonicalId, first!.canonicalId);
  });

  it("shouldFallback triggers on rate limit errors", () => {
    assert.equal(shouldFallback(new Error("OpenRouter API error 429: rate limited")), true);
  });

  it("shouldFallback triggers on server errors", () => {
    assert.equal(shouldFallback(new Error("503 service unavailable")), true);
  });

  it("shouldFallback triggers on network errors", () => {
    assert.equal(shouldFallback(new Error("network error: ECONNRESET")), true);
  });

  it("shouldFallback does NOT trigger on content errors", () => {
    assert.equal(shouldFallback(new Error("Invalid JSON response")), false);
  });

  it("estimateRunCost uses catalog pricing", () => {
    const r = registry();
    const cost = r.estimateRunCost("gpt-5.6-sol", 100_000, 10_000);
    assert.ok(cost > 0);
  });

  it("estimateRunCost returns 0 for models without pricing", () => {
    const r = registry();
    // Models without pricing metadata return 0
    const cost = r.estimateRunCost("nonexistent-model", 100_000, 10_000);
    assert.equal(cost, 0);
  });
});
