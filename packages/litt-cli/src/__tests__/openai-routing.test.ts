/**
 * OpenAI Routing Regression Test
 *
 * Proves that when OPENAI_API_KEY is set, AUTO mode routes GPT-5.6 Luna
 * directly through OpenAI, not through OpenRouter.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEnvCredentialResolver, MODEL_CATALOG, ModelRegistry } from "@litt/models";
import { resolveProviderAdapter } from "../lib/model-provider.js";

describe("OpenAI Routing - Direct Provider Preference", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("AUTO + GPT-5.6 Luna routes to OpenAI when OPENAI_API_KEY is set", () => {
    // Set OPENAI_API_KEY, clear OPENROUTER_API_KEY
    process.env.OPENAI_API_KEY = "sk-test-key";
    delete process.env.OPENROUTER_API_KEY;

    const resolver = createEnvCredentialResolver((key) => process.env[key]);
    const registry = new ModelRegistry(MODEL_CATALOG, resolver);

    const lunaModel = registry.getById("gpt-5.6-luna");
    expect(lunaModel).toBeDefined();

    const creds = registry.credentialFor(lunaModel!);
    expect(creds.servedBy).toBe("openai");
    expect(creds.hasCredential).toBe(true);
    expect(creds.source).toBe("byok");

    // Verify the adapter resolves to OpenAI
    const routed = {
      id: lunaModel!.canonicalId,
      label: lunaModel!.displayName,
      servedBy: creds.servedBy,
      provider: lunaModel!.provider,
      providerModelId: lunaModel!.providerModelId,
      openRouterModelId: lunaModel!.openRouterModelId,
      reason: "LiTT default",
      fallbackReason: null,
      appliedPolicy: "auto",
    };

    const adapter = resolveProviderAdapter(routed);
    expect(adapter.providerId).toBe("openai");
  });

  it("AUTO + GPT-5.6 Terra routes to OpenAI when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    delete process.env.OPENROUTER_API_KEY;

    const resolver = createEnvCredentialResolver((key) => process.env[key]);
    const registry = new ModelRegistry(MODEL_CATALOG, resolver);

    const terraModel = registry.getById("gpt-5.6-terra");
    expect(terraModel).toBeDefined();

    const creds = registry.credentialFor(terraModel!);
    expect(creds.servedBy).toBe("openai");

    const routed = {
      id: terraModel!.canonicalId,
      label: terraModel!.displayName,
      servedBy: creds.servedBy,
      provider: terraModel!.provider,
      providerModelId: terraModel!.providerModelId,
      openRouterModelId: terraModel!.openRouterModelId,
      reason: "LiTT default",
      fallbackReason: null,
      appliedPolicy: "auto",
    };

    const adapter = resolveProviderAdapter(routed);
    expect(adapter.providerId).toBe("openai");
  });

  it("AUTO + GPT-5.6 Luna falls back to OpenRouter when only OPENROUTER_API_KEY is set", () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    const resolver = createEnvCredentialResolver((key) => process.env[key]);
    const registry = new ModelRegistry(MODEL_CATALOG, resolver);

    const lunaModel = registry.getById("gpt-5.6-luna");
    expect(lunaModel).toBeDefined();

    const creds = registry.credentialFor(lunaModel!);
    expect(creds.servedBy).toBe("openrouter");
    expect(creds.hasCredential).toBe(true);

    const routed = {
      id: lunaModel!.canonicalId,
      label: lunaModel!.displayName,
      servedBy: creds.servedBy,
      provider: lunaModel!.provider,
      providerModelId: lunaModel!.providerModelId,
      openRouterModelId: lunaModel!.openRouterModelId,
      reason: "LiTT default",
      fallbackReason: null,
      appliedPolicy: "auto",
    };

    const adapter = resolveProviderAdapter(routed);
    expect(adapter.providerId).toBe("openrouter");
  });

  it("OPENAI_API_KEY takes precedence over OPENROUTER_API_KEY for OpenAI models", () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.OPENROUTER_API_KEY = "sk-or-test-router";

    const resolver = createEnvCredentialResolver((key) => process.env[key]);
    const registry = new ModelRegistry(MODEL_CATALOG, resolver);

    const lunaModel = registry.getById("gpt-5.6-luna");
    expect(lunaModel).toBeDefined();

    const creds = registry.credentialFor(lunaModel!);
    // Direct key should take precedence over OpenRouter fallback
    expect(creds.servedBy).toBe("openai");
    expect(creds.source).toBe("byok");
  });
});