/**
 * Regression test: /model lists only genuinely routable models.
 *
 * Free-priced models (pricing.unit === "free") must always be routable
 * regardless of whether the user has provider credentials — the server
 * holds the OpenRouter key, so free models work without any local keys.
 *
 * Paid models without credentials must NOT be routable.
 */

import { describe, it, expect } from "vitest";
import { ModelRegistry, MODEL_CATALOG, createEnvCredentialResolver } from "@litt/models";

describe("Free model routability", () => {
  it("R: free models are always routable; paid models require credentials", () => {
    // No provider keys at all — simulates a user with no local API keys
    const envAccessor = { get: (_key: string) => undefined };
    const registry = new ModelRegistry(
      MODEL_CATALOG,
      createEnvCredentialResolver(envAccessor.get),
    );

    const freeModels = registry.getAll().filter((m) => m.pricing?.unit === "free");
    expect(freeModels.length).toBeGreaterThan(0);

    // Every free model must be routable even without credentials
    for (const model of freeModels) {
      expect(registry.isRoutable(model)).toBe(true);
    }

    // Paid models without credentials must NOT be routable
    const paidModels = registry.getAll().filter((m) => m.pricing?.unit !== "free");
    for (const model of paidModels) {
      if (model.availability !== "offline" && model.availability !== "deprecated") {
        expect(registry.isRoutable(model)).toBe(false);
      }
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
