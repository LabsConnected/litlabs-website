/**
 * Regression test: /model lists only genuinely routable models.
 *
 * ModelRegistry.isRoutable answers "routable given the credentials THIS
 * resolver reports" — it is a local-credential question, not a claim
 * about what LiTT as a product can serve. Managed/hosted access is
 * expressed one layer up, by injecting a resolver that reports hosted
 * credentials (ModelRuntime(remoteMode) does exactly this).
 *
 * So free OpenRouter models are routable in two of three modes:
 *   - local, no OpenRouter credential  → NOT routable (nothing can serve them)
 *   - local, OPENROUTER_API_KEY set     → routable
 *   - managed/remote (hosted key)       → routable
 *
 * This test previously asserted free models were ALWAYS routable, which
 * was the contract fba05d99 introduced. bed731a4 deliberately narrowed
 * it — a user with only GROQ_API_KEY was being offered free OpenRouter
 * models the CLI could not actually serve — but did not update this
 * test. The assertions below track the current, narrower contract.
 *
 * Paid models without credentials must NOT be routable.
 */

import { describe, it, expect } from "vitest";
import { ModelRegistry, MODEL_CATALOG, createEnvCredentialResolver } from "@litt/models";
import type { CredentialInfo, ProviderId } from "@litt/models";

/** A resolver standing in for managed mode: the server holds every key. */
const managedResolver = (provider: ProviderId): CredentialInfo => ({
  hasCredential: true,
  source: "litt-managed",
  servedBy: provider,
});

describe("Free model routability", () => {
  it("R: free OpenRouter models need an OpenRouter credential; paid models need their own", () => {
    // No provider keys at all — simulates a user with no local API keys
    const envAccessor = { get: (_key: string) => undefined };
    const registry = new ModelRegistry(
      MODEL_CATALOG,
      createEnvCredentialResolver(envAccessor.get),
    );

    const freeModels = registry.getAll().filter((m) => m.pricing?.unit === "free");
    expect(freeModels.length).toBeGreaterThan(0);

    // Free models are served via OpenRouter. With no OpenRouter key and
    // no hosted resolver, nothing can actually serve them — offering them
    // would route the user to a request that cannot succeed.
    for (const model of freeModels) {
      expect(registry.isRoutable(model)).toBe(false);
    }

    // Paid models without credentials must NOT be routable
    const paidModels = registry.getAll().filter((m) => m.pricing?.unit !== "free");
    for (const model of paidModels) {
      if (model.availability !== "offline" && model.availability !== "deprecated") {
        expect(registry.isRoutable(model)).toBe(false);
      }
    }
  });

  it("R1b: free models ARE routable in managed mode (server holds the OpenRouter key)", () => {
    // The other half of the contract: ModelRuntime(remoteMode) injects a
    // resolver like this one, and free models must then be routable
    // without the user holding any local key.
    const registry = new ModelRegistry(MODEL_CATALOG, managedResolver);

    const freeModels = registry.getAll().filter((m) => m.pricing?.unit === "free");
    expect(freeModels.length).toBeGreaterThan(0);
    for (const model of freeModels) {
      expect(registry.isRoutable(model)).toBe(true);
    }
  });

  it("R2: free models are routable even with credentials present", () => {
    // With credentials — free models should still be routable
    const envAccessor = {
      get: (key: string) => {
        if (key === "OPENAI_API_KEY") return "sk-proj-test";
        if (key === "OPENROUTER_API_KEY") return "sk-or-v1-test";
        return undefined;
      },
    };
    const registry = new ModelRegistry(
      MODEL_CATALOG,
      createEnvCredentialResolver(envAccessor.get),
    );

    const freeModels = registry.getAll().filter((m) => m.pricing?.unit === "free");
    for (const model of freeModels) {
      expect(registry.isRoutable(model)).toBe(true);
    }
  });

  it("R2b: an OpenRouter key alone is enough — no other provider key needed", () => {
    // Guards the specific regression bed731a4 fixed from the other side:
    // a user with only OPENROUTER_API_KEY must still get the free models.
    const registry = new ModelRegistry(
      MODEL_CATALOG,
      createEnvCredentialResolver((key) =>
        key === "OPENROUTER_API_KEY" ? "sk-or-v1-test" : undefined,
      ),
    );

    const freeModels = registry.getAll().filter((m) => m.pricing?.unit === "free");
    for (const model of freeModels) {
      expect(registry.isRoutable(model)).toBe(true);
    }
  });

  it("R3: all free models in catalog have valid OpenRouter slug format", () => {
    // Every free model must have an openRouterModelId that contains ":free"
    // and a providerModelId with "/" (OpenRouter slug format: "vendor/model:free")
    const freeModels = MODEL_CATALOG.filter((m) => m.pricing?.unit === "free");
    for (const model of freeModels) {
      expect(model.openRouterModelId).toContain(":free");
      expect(model.openRouterModelId).toContain("/");
      expect(model.providerModelId).toContain("/");
      expect(model.provider).toBe("openrouter");
    }
  });
});
