/**
 * Model truth regression tests.
 *
 * Enforces the same philosophy as the VerificationGate:
 *   configured ≠ active ≠ proven
 *
 * Regression cases:
 *   1. OPENROUTER_API_KEY alone does NOT show Claude (or any specific model)
 *   2. Offline runtime (no provider) does NOT invent an activeModel
 *   3. configuredModel ≠ activeModel (active only after runtime execution)
 *   4. activeModel comes from runtime/model execution truth, not env vars
 *   5. `auto` profile routes, does not secretly equal Claude
 *   6. LITT_MODEL / OPENROUTER_MODEL overrides take priority (source: "user")
 *   7. modelDisplayLabel shows "unresolved" when nothing is configured
 *   8. Provider availability is separate from model selection
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  hasProviderKey,
  resolveConfiguredModel,
  buildModelState,
  modelDisplayLabel,
  OpenRouterModelProvider,
  type ModelState,
} from "../lib/model-provider.js";

// ─── Env management ────────────────────────────────────────────────

const ENV_KEYS = ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "LITT_MODEL", "OPENROUTER_MODEL"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
});

// ─── Tests ─────────────────────────────────────────────────────────

describe("Model truth — configured ≠ active ≠ proven", () => {
  it("OPENROUTER_API_KEY alone does NOT show Claude as active", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    // No LITT_MODEL, no OPENROUTER_MODEL set
    const state = buildModelState();

    // Provider is available — that's truthful
    expect(state.provider).toBe("openrouter");
    // But activeModel is null — no request has been executed
    expect(state.activeModel).toBeNull();
    // configuredModel is the profile default, NOT displayed as "active"
    expect(state.configuredModel).toBeTruthy();
    // The display label shows the configured model, not "claude-sonnet-4.6" as active
    const label = modelDisplayLabel(state);
    // It should NOT claim Claude is active
    expect(label).not.toBe("claude-sonnet-4.6");
  });

  it("offline runtime (no provider) does NOT invent an activeModel", () => {
    // No OPENROUTER_API_KEY set
    const state = buildModelState();

    expect(state.provider).toBeNull();
    expect(state.configuredModel).toBeNull();
    expect(state.activeModel).toBeNull();
    expect(state.source).toBeNull();

    const label = modelDisplayLabel(state);
    expect(label).toBe("unresolved");
  });

  it("configuredModel ≠ activeModel — active only after runtime execution", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";

    // Before any execution
    const before = buildModelState({ profile: "smart" });
    expect(before.configuredModel).toBeTruthy();
    expect(before.activeModel).toBeNull();
    expect(before.source).not.toBe("runtime");

    // After execution (simulated)
    const after = buildModelState({
      profile: "smart",
      activeModel: "anthropic/claude-sonnet-4.6",
    });
    expect(after.activeModel).toBe("anthropic/claude-sonnet-4.6");
    expect(after.source).toBe("runtime");
    // configuredModel and activeModel CAN differ (e.g. auto routing)
  });

  it("activeModel comes from runtime truth, not from env assumption", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    // Even with a key, without activeModel the state doesn't claim one
    const state = buildModelState();
    expect(state.activeModel).toBeNull();
    expect(state.source).not.toBe("runtime");
  });

  it("auto profile routes — does NOT secretly equal Claude", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    const { model, source } = resolveConfiguredModel("auto");

    // auto should produce the routing token, not a hardcoded Claude model
    expect(model).not.toBe("anthropic/claude-sonnet-4.6");
    expect(model).not.toContain("claude");
    expect(source).toBe("profile");
  });

  it("LITT_MODEL override takes priority (source: user)", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    process.env.LITT_MODEL = "openai/gpt-4o";
    const { model, source } = resolveConfiguredModel("smart");

    expect(model).toBe("openai/gpt-4o");
    expect(source).toBe("user");
  });

  it("OPENROUTER_MODEL override takes priority (source: user)", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    process.env.OPENROUTER_MODEL = "google/gemini-pro-1.5";
    const { model, source } = resolveConfiguredModel("smart");

    expect(model).toBe("google/gemini-pro-1.5");
    expect(source).toBe("user");
  });

  it("modelDisplayLabel shows 'unresolved' when nothing is configured", () => {
    const state: ModelState = {
      provider: null,
      configuredModel: null,
      activeModel: null,
      profile: null,
      source: null,
    };
    expect(modelDisplayLabel(state)).toBe("unresolved");
  });

  it("modelDisplayLabel shows activeModel when runtime has executed", () => {
    const state: ModelState = {
      provider: "openrouter",
      configuredModel: "openrouter/auto",
      activeModel: "anthropic/claude-sonnet-4.6",
      profile: "auto",
      source: "runtime",
    };
    expect(modelDisplayLabel(state)).toBe("anthropic/claude-sonnet-4.6");
  });

  it("modelDisplayLabel shows configuredModel when not yet active", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    const state = buildModelState({ profile: "smart" });
    const label = modelDisplayLabel(state);
    // Shows the configured model, not "unresolved" and not claiming active
    expect(label).not.toBe("unresolved");
    expect(label).toBe(state.configuredModel);
  });

  it("provider availability is separate from model selection", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    expect(hasProviderKey()).toBe(true);

    // Provider is available but no model is active
    const state = buildModelState();
    expect(state.provider).toBe("openrouter");
    expect(state.activeModel).toBeNull();
  });

  it("no provider key → hasProviderKey is false, state is fully unresolved", () => {
    expect(hasProviderKey()).toBe(false);
    const state = buildModelState();
    expect(state.provider).toBeNull();
    expect(state.configuredModel).toBeNull();
    expect(state.activeModel).toBeNull();
  });

  it("OpenRouterModelProvider exposes configuredModel ≠ activeModel before stream", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    const provider = new OpenRouterModelProvider({ profile: "smart" });

    // configuredModel is set from profile resolution
    expect(provider.configuredModel).toBeTruthy();
    // activeModel is null until stream() is called
    expect(provider.activeModel).toBeNull();
    // They are different concepts
    expect(provider.configuredModel).not.toBe(provider.activeModel);
  });

  it("smart profile resolves to a model with source: profile", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    const { model, source } = resolveConfiguredModel("smart");
    expect(model).toBeTruthy();
    expect(source).toBe("profile");
  });

  it("fast profile resolves to a different model than smart", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    const smart = resolveConfiguredModel("smart");
    const fast = resolveConfiguredModel("fast");
    expect(smart.model).not.toBe(fast.model);
  });

  it("user override beats profile resolution", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    process.env.LITT_MODEL = "meta-llama/llama-3.1-405b-instruct";
    const smart = resolveConfiguredModel("smart");
    const auto = resolveConfiguredModel("auto");
    // Both should use the user override, not the profile default
    expect(smart.model).toBe("meta-llama/llama-3.1-405b-instruct");
    expect(auto.model).toBe("meta-llama/llama-3.1-405b-instruct");
    expect(smart.source).toBe("user");
    expect(auto.source).toBe("user");
  });
});
