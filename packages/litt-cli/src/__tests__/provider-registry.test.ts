/**
 * Provider registry + credential-aware routing + fallback + persistence tests.
 *
 * Tests the real multi-model LiTT provider layer:
 *   1. Credential-aware discovery (don't show models whose provider isn't configured)
 *   2. Health status (READY / NO KEY / RATE LIMITED / DOWN)
 *   3. Fallback chain (if model A fails → try model B)
 *   4. Persistence (prefs survive closing and reopening litt)
 *   5. Credential-aware routing (don't route to unavailable models)
 *   6. BYOK vs LiTT Credits distinction
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ProviderRegistry,
  FallbackExecutor,
  hasCredential,
  credentialSource,
  loadModelPrefs,
  saveModelPrefs,
  getDefaultPrefsPath,
  type ModelPrefs,
  type ModelProvider,
} from "../lib/provider-registry.js";
import { routeModel, MODEL_CATALOG } from "../lib/model-routing.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Env management ────────────────────────────────────────────────

const ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "LITT_HOME",
] as const;

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

// ─── Credential tests ──────────────────────────────────────────────

describe("Credential-aware discovery", () => {
  it("hasCredential returns false when no env key is set", () => {
    const provider: ModelProvider = {
      id: "anthropic",
      label: "Anthropic",
      credentialType: "byok",
      envKey: "ANTHROPIC_API_KEY",
    };
    expect(hasCredential(provider)).toBe(false);
  });

  it("hasCredential returns true when direct env key is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const provider: ModelProvider = {
      id: "anthropic",
      label: "Anthropic",
      credentialType: "byok",
      envKey: "ANTHROPIC_API_KEY",
    };
    expect(hasCredential(provider)).toBe(true);
  });

  it("hasCredential returns true via OpenRouter fallback (altEnvKeys)", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const provider: ModelProvider = {
      id: "anthropic",
      label: "Anthropic",
      credentialType: "byok",
      envKey: "ANTHROPIC_API_KEY",
      altEnvKeys: ["OPENROUTER_API_KEY"],
    };
    expect(hasCredential(provider)).toBe(true);
  });

  it("hasCredential returns true for local providers (no key needed)", () => {
    const provider: ModelProvider = {
      id: "local",
      label: "Local",
      credentialType: "local",
    };
    expect(hasCredential(provider)).toBe(true);
  });

  it("credentialSource returns the env var that granted access", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const provider: ModelProvider = {
      id: "anthropic",
      label: "Anthropic",
      credentialType: "byok",
      envKey: "ANTHROPIC_API_KEY",
      altEnvKeys: ["OPENROUTER_API_KEY"],
    };
    expect(credentialSource(provider)).toBe("OPENROUTER_API_KEY");
  });

  it("credentialSource returns direct key when both direct and alt are set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const provider: ModelProvider = {
      id: "anthropic",
      label: "Anthropic",
      credentialType: "byok",
      envKey: "ANTHROPIC_API_KEY",
      altEnvKeys: ["OPENROUTER_API_KEY"],
    };
    expect(credentialSource(provider)).toBe("ANTHROPIC_API_KEY");
  });
});

// ─── Provider registry tests ───────────────────────────────────────

describe("ProviderRegistry", () => {
  it("reports no-key for providers without credentials", async () => {
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const anthropic = registry.getProviderStatus("anthropic");
    expect(anthropic).not.toBeNull();
    expect(anthropic!.health).toBe("no-key");
    expect(anthropic!.hasCredential).toBe(false);
    expect(anthropic!.models).toHaveLength(0);
  });

  it("reports ready for OpenRouter when key is set", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const openrouter = registry.getProviderStatus("openrouter");
    expect(openrouter).not.toBeNull();
    // Health might be "ready" or "unknown" depending on network
    expect(["ready", "unknown", "down"]).toContain(openrouter!.health);
    expect(openrouter!.hasCredential).toBe(true);
  });

  it("Anthropic models available via OpenRouter even without direct key", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const anthropic = registry.getProviderStatus("anthropic");
    expect(anthropic).not.toBeNull();
    expect(anthropic!.hasCredential).toBe(true);
    // Models should be discovered (health might be unknown since no direct API check)
    expect(anthropic!.models.length).toBeGreaterThan(0);
  });

  it("getAvailableModels returns only models from ready/unknown providers", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const available = registry.getAvailableModels();
    // Should include models from OpenRouter-covered providers
    expect(available.length).toBeGreaterThan(0);
    // Should NOT include models from providers without any credential
    const google = available.find(m => m.provider === "Google");
    // Google is covered by OpenRouter, so it should be available
    expect(google).toBeDefined();
  });

  it("isModelAvailable returns false for models with no credentialed provider", async () => {
    // No keys set at all
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    expect(registry.isModelAvailable("anthropic/claude-sonnet-4.6")).toBe(false);
  });

  it("isModelAvailable returns true when OpenRouter is available", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    // OpenRouter can route to any model
    expect(registry.isModelAvailable("anthropic/claude-sonnet-4.6")).toBe(true);
  });

  it("getUnavailableReason explains why a model is unavailable", async () => {
    // Ensure no keys are set (beforeEach clears them, but be explicit)
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const reason = registry.getUnavailableReason("anthropic/claude-sonnet-4.6");
    expect(reason).not.toBeNull();
    expect(reason!).toContain("Credential");
  });
});

// ─── Fallback chain tests ──────────────────────────────────────────

describe("Fallback chain", () => {
  it("builds a fallback chain with primary first", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const chain = registry.getFallbackChain("openai/gpt-5.6-codex", "coding");
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0].id).toBe("openai/gpt-5.6-codex");
    // Should include other coding-capable models as fallbacks
    const hasOther = chain.some(m => m.id !== "openai/gpt-5.6-codex" && m.strengths.includes("coding"));
    expect(hasOther).toBe(true);
  });

  it("getNextFallback returns a different model each time", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const first = registry.getNextFallback("openai/gpt-5.6-codex", "coding", []);
    expect(first).not.toBeNull();
    const second = registry.getNextFallback("openai/gpt-5.6-codex", "coding", [first!.id]);
    expect(second).not.toBeNull();
    expect(second!.id).not.toBe(first!.id);
  });

  it("FallbackExecutor shouldFallback on rate limit errors", () => {
    const registry = new ProviderRegistry(MODEL_CATALOG);
    const executor = new FallbackExecutor(registry);
    expect(executor.shouldFallback(new Error("OpenRouter API error 429: rate limited"))).toBe(true);
  });

  it("FallbackExecutor shouldFallback on server errors", () => {
    const registry = new ProviderRegistry(MODEL_CATALOG);
    const executor = new FallbackExecutor(registry);
    expect(executor.shouldFallback(new Error("OpenRouter API error 503: service unavailable"))).toBe(true);
  });

  it("FallbackExecutor shouldFallback on network errors", () => {
    const registry = new ProviderRegistry(MODEL_CATALOG);
    const executor = new FallbackExecutor(registry);
    expect(executor.shouldFallback(new Error("network error: ECONNRESET"))).toBe(true);
  });

  it("FallbackExecutor does NOT fallback on content errors", () => {
    const registry = new ProviderRegistry(MODEL_CATALOG);
    const executor = new FallbackExecutor(registry);
    expect(executor.shouldFallback(new Error("Invalid JSON response"))).toBe(false);
  });

  it("FallbackExecutor tracks tried models", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const executor = new FallbackExecutor(registry);
    executor.nextFallback("openai/gpt-5.6-codex", "coding");
    executor.nextFallback("anthropic/claude-sonnet-4.6", "coding");
    expect(executor.getTried()).toEqual(["openai/gpt-5.6-codex", "anthropic/claude-sonnet-4.6"]);
  });

  it("FallbackExecutor reset clears tried list", () => {
    const registry = new ProviderRegistry(MODEL_CATALOG);
    const executor = new FallbackExecutor(registry);
    executor.nextFallback("model-a", "coding");
    executor.reset();
    expect(executor.getTried()).toEqual([]);
  });
});

// ─── Credential-aware routing tests ────────────────────────────────

describe("Credential-aware routing", () => {
  it("routeModel only selects from available models when provided", () => {
    // Only OpenRouter's auto model is available
    const available = ["openrouter/auto"];
    const choice = routeModel("auto", null, "fix this bug", available);
    expect(available).toContain(choice.id);
  });

  it("routeModel does not route to Claude when Anthropic not available", () => {
    // Only OpenAI models available
    const available = ["openai/gpt-5.6", "openai/gpt-5.6-codex"];
    const choice = routeModel("auto", null, "fix this TypeScript bug", available);
    expect(available).toContain(choice.id);
    expect(choice.id).not.toContain("anthropic");
  });

  it("routeModel falls back to full catalog when no available list provided", () => {
    const choice = routeModel("auto", null, "fix this bug");
    expect(MODEL_CATALOG.map(m => m.id)).toContain(choice.id);
  });

  it("routeModel budget mode respects availability", () => {
    const available = ["openai/gpt-5.6", "openai/gpt-5.6-codex"];
    const choice = routeModel("budget", null, "write a function", available);
    expect(available).toContain(choice.id);
  });

  it("routeModel max mode respects availability", () => {
    const available = ["openai/gpt-5.6", "openai/gpt-5.6-codex"];
    const choice = routeModel("max", null, "design architecture", available);
    expect(available).toContain(choice.id);
  });

  it("routeModel fixed mode falls through when selected model unavailable", () => {
    const available = ["openai/gpt-5.6"];
    // User selected Claude but it's not available → should fall through to auto
    const choice = routeModel("fixed", "anthropic/claude-sonnet-4.6", "fix bug", available);
    expect(available).toContain(choice.id);
  });

  it("routeModel coding task prefers Codex when available", () => {
    const available = ["openai/gpt-5.6-codex", "anthropic/claude-sonnet-4.6", "google/gemini-3-pro"];
    const choice = routeModel("auto", null, "fix this TypeScript bug in auth.ts", available);
    expect(choice.id).toBe("openai/gpt-5.6-codex");
  });

  it("routeModel reasoning task prefers Opus when available", () => {
    const available = ["anthropic/claude-opus-4.6", "openai/gpt-5.6", "anthropic/claude-sonnet-4.6"];
    const choice = routeModel("auto", null, "redesign the execution architecture", available);
    expect(choice.id).toBe("anthropic/claude-opus-4.6");
  });

  it("routeModel vision task prefers Gemini when available", () => {
    const available = ["google/gemini-3-pro", "anthropic/claude-sonnet-4.6", "openai/gpt-5.6"];
    const choice = routeModel("auto", null, "inspect this screenshot and reproduce the UI", available);
    expect(choice.id).toBe("google/gemini-3-pro");
  });
});

// ─── Persistence tests ─────────────────────────────────────────────

describe("Model preferences persistence", () => {
  it("loadModelPrefs returns defaults when file doesn't exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-prefs-"));
    const prefsPath = path.join(tmpDir, "model-prefs.json");
    const prefs = loadModelPrefs(prefsPath);
    expect(prefs.routingMode).toBe("auto");
    expect(prefs.selectedModel).toBeNull();
    expect(prefs.capabilityOverrides).toEqual({});
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("saveModelPrefs writes and loadModelPrefs reads back", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-prefs-"));
    const prefsPath = path.join(tmpDir, "model-prefs.json");

    const prefs: ModelPrefs = {
      routingMode: "fixed",
      selectedModel: "openai/gpt-5.6-codex",
      capabilityOverrides: { coding: "openai/gpt-5.6-codex" },
      lastUsedModel: "anthropic/claude-sonnet-4.6",
      showFallbackNotifications: false,
    };

    saveModelPrefs(prefs, prefsPath);
    const loaded = loadModelPrefs(prefsPath);

    expect(loaded.routingMode).toBe("fixed");
    expect(loaded.selectedModel).toBe("openai/gpt-5.6-codex");
    expect(loaded.capabilityOverrides.coding).toBe("openai/gpt-5.6-codex");
    expect(loaded.lastUsedModel).toBe("anthropic/claude-sonnet-4.6");
    expect(loaded.showFallbackNotifications).toBe(false);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("saveModelPrefs creates directory if it doesn't exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-prefs-"));
    const nestedDir = path.join(tmpDir, "nested", "dir");
    const prefsPath = path.join(nestedDir, "model-prefs.json");

    saveModelPrefs({
      routingMode: "budget",
      selectedModel: null,
      capabilityOverrides: {},
      lastUsedModel: null,
      showFallbackNotifications: true,
    }, prefsPath);

    expect(fs.existsSync(prefsPath)).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("loadModelPrefs returns defaults on corrupt JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-prefs-"));
    const prefsPath = path.join(tmpDir, "model-prefs.json");
    fs.writeFileSync(prefsPath, "{ invalid json }", "utf-8");

    const prefs = loadModelPrefs(prefsPath);
    expect(prefs.routingMode).toBe("auto");
    expect(prefs.selectedModel).toBeNull();

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("getDefaultPrefsPath returns ~/.litt/model-prefs.json", () => {
    // LITT_HOME is cleared by beforeEach, so it uses homedir()
    const prefsPath = getDefaultPrefsPath();
    expect(prefsPath).toContain(".litt");
    expect(prefsPath).toContain("model-prefs.json");
  });

  it("getDefaultPrefsPath respects LITT_HOME env var", () => {
    process.env.LITT_HOME = "/tmp/custom-litt-home";
    const prefsPath = getDefaultPrefsPath();
    expect(prefsPath).toContain("custom-litt-home");
    expect(prefsPath).toContain("model-prefs.json");
  });

  it("preferences survive save → load cycle with all fields", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-prefs-"));
    const prefsPath = path.join(tmpDir, "model-prefs.json");

    const original: ModelPrefs = {
      routingMode: "max",
      selectedModel: "anthropic/claude-opus-4.6",
      capabilityOverrides: {
        coding: "openai/gpt-5.6-codex",
        reasoning: "anthropic/claude-opus-4.6",
        vision: "google/gemini-3-pro",
      },
      lastUsedModel: "google/gemini-3-pro",
      showFallbackNotifications: false,
    };

    saveModelPrefs(original, prefsPath);
    const loaded = loadModelPrefs(prefsPath);

    expect(loaded).toEqual(original);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ─── BYOK vs LiTT Credits ──────────────────────────────────────────

describe("BYOK vs LiTT Credits", () => {
  it("OpenRouter provider is BYOK", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const provider: ModelProvider = {
      id: "openrouter",
      label: "OpenRouter",
      credentialType: "byok",
      envKey: "OPENROUTER_API_KEY",
    };
    expect(provider.credentialType).toBe("byok");
    expect(hasCredential(provider)).toBe(true);
  });

  it("local provider is local (not BYOK)", () => {
    const provider: ModelProvider = {
      id: "local",
      label: "Local",
      credentialType: "local",
    };
    expect(provider.credentialType).toBe("local");
    expect(hasCredential(provider)).toBe(true);
  });

  it("provider without key reports no-key health", async () => {
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const openai = registry.getProviderStatus("openai");
    expect(openai!.health).toBe("no-key");
    expect(openai!.provider.credentialType).toBe("byok");
  });
});
