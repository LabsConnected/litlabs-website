import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_CATALOG,
  ModelRegistry,
  createEnvCredentialResolver,
  routeModel,
  getProvider,
  PROVIDERS,
} from "../index.js";

// ─── Unverified-provider discipline ───────────────────────────────
// The openagents gateway (api-gateway.openagents.org) is a third-party
// provider whose endpoint and model lineup are NOT independently
// verified. Its models must never be auto-selected, never appear as a
// silent fallback, and never be presented as LiTT Recommended — explicit
// selection only, until the provider is verified end-to-end.

function allDirect() {
  return createEnvCredentialResolver((key) => (key ? "set" : undefined));
}
function onlyOpenAgents() {
  return createEnvCredentialResolver((key) =>
    key === "OPENAGENTS_API_KEY" ? "set" : undefined,
  );
}
function onlyOpenRouter() {
  return createEnvCredentialResolver((key) =>
    key === "OPENROUTER_API_KEY" ? "set" : undefined,
  );
}
function registry(resolver = allDirect()) {
  return new ModelRegistry(MODEL_CATALOG, resolver);
}

const OA_ID = "openagents-deepseek-4-flash";

describe("openagents provider definition", () => {
  it("is explicitly marked unverified", () => {
    const def = getProvider("openagents");
    assert.ok(def, "openagents provider must exist");
    assert.equal(def.unverified, true);
  });

  it("requires OPENAGENTS_API_KEY — no alt keys, never OpenRouter", () => {
    const def = getProvider("openagents")!;
    assert.equal(def.envKey, "OPENAGENTS_API_KEY");
    assert.deepEqual(def.altEnvKeys ?? [], [], "no altEnvKeys — especially not OPENROUTER_API_KEY");
    assert.ok(def.chatUrl?.startsWith("https://api-gateway.openagents.org/"));
    assert.ok(def.modelsUrl?.startsWith("https://api-gateway.openagents.org/"));
  });
});

describe("openagents catalog entry", () => {
  const entry = MODEL_CATALOG.find((m) => m.canonicalId === OA_ID);

  it("exists but is explicitly unverified", () => {
    assert.ok(entry);
    assert.equal(entry.verified, false);
    assert.equal(entry.verifiedAt, null);
    assert.equal(entry.source, "unverified");
    assert.equal(entry.availability, "unverified");
  });

  it("is manualOnly with no recommendation metadata", () => {
    assert.equal(entry!.manualOnly, true);
    assert.ok(!entry!.littRecommended, "must not be LiTT Recommended");
    assert.equal(entry!.littTier, undefined, "must not hold a LiTT tier");
    assert.deepEqual(entry!.recommendedFor, [], "must not claim task recommendations");
  });
});

describe("catalog invariant — unverified providers are never recommended", () => {
  it("no model on an unverified provider carries recommendation metadata", () => {
    const unverifiedProviders = new Set(
      PROVIDERS.filter((p) => p.unverified).map((p) => p.id),
    );
    assert.ok(unverifiedProviders.has("openagents"));
    const violations = MODEL_CATALOG.filter(
      (m) =>
        unverifiedProviders.has(m.provider) &&
        (!m.manualOnly || m.littRecommended === true || m.littTier !== undefined),
    );
    assert.deepEqual(
      violations.map((m) => m.canonicalId),
      [],
      "models on unverified providers must be manualOnly and carry no littRecommended/littTier",
    );
  });
});

describe("openagents routing — never auto-selected", () => {
  it("AUTO never selects it even when its key is configured", () => {
    const r = registry(); // every provider credentialed, incl. openagents
    assert.ok(
      r.isRoutable(r.getById(OA_ID)!),
      "sanity: openagents model is routable when OPENAGENTS_API_KEY set",
    );
    for (const message of [
      "hey what's up?",
      "debug this nasty architecture problem",
      "analyze this entire repo",
      "run the agent workflow to deploy",
      "write a function to parse csv",
    ]) {
      const res = routeModel(r, { message });
      assert.notEqual(
        res.model.provider,
        "openagents",
        `AUTO selected openagents for: ${message}`,
      );
    }
  });

  it("AUTO budget and max preferences never select it", () => {
    const r = registry();
    for (const preference of ["budget", "max"] as const) {
      const res = routeModel(r, { message: "hey" }, { preference });
      assert.notEqual(res.model.provider, "openagents", `${preference} selected openagents`);
    }
  });

  it("never appears in any fallback chain", () => {
    const r = registry();
    for (const taskKind of ["chat", "fast", "coding", "agent", "reasoning", "large-context"]) {
      const chain = r.getFallbackChain("gpt-5.6-luna", taskKind);
      assert.ok(
        chain.every((m) => m.provider !== "openagents"),
        `fallback chain for ${taskKind} contains an openagents model`,
      );
    }
  });

  it("never appears in the recommended set", () => {
    const r = registry();
    assert.ok(r.getAvailableRecommended().every((m) => m.provider !== "openagents"));
  });

  it("explicit pinned/ask selection still works (opt-in honored)", () => {
    const r = registry();
    const pinned = routeModel(r, { message: "hey" }, { mode: "pinned", pinnedModelId: OA_ID });
    assert.equal(pinned.model.canonicalId, OA_ID);
    const asked = routeModel(r, { message: "hey" }, { mode: "ask", askChoice: OA_ID });
    assert.equal(asked.model.canonicalId, OA_ID);
    assert.equal(asked.servedBy, "openagents");
  });
});

describe("openagents credential boundaries", () => {
  it("OPENROUTER_API_KEY alone does not make it routable", () => {
    const r = registry(onlyOpenRouter());
    const entry = r.getById(OA_ID)!;
    assert.equal(
      r.isRoutable(entry),
      false,
      "an OpenRouter key must never grant access to the openagents gateway",
    );
  });

  it("when it is the ONLY configured provider, AUTO may still serve it (last-resort escape)", () => {
    const r = registry(onlyOpenAgents());
    const res = routeModel(r, { message: "hey" });
    assert.equal(res.model.canonicalId, OA_ID);
    assert.equal(res.servedBy, "openagents");
  });
});
