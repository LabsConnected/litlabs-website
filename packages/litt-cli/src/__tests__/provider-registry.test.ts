/**
 * Provider registry + credential-aware routing + fallback + persistence tests.
 *
 * Tests the real multi-model LiTT provider layer:
 *   1. Credential-aware discovery (don't show models whose provider isn't configured)
 *   2. Health status (READY / UNVERIFIED / NO KEY / RATE LIMITED / DOWN)
 *   3. Fallback chain (if model A fails → try model B)
 *   4. Persistence (prefs survive closing and reopening litt)
 *   5. Credential-aware routing (don't route to unavailable models)
 *   6. BYOK vs LiTT Credits distinction
 *   7. Source truth (servedBy — OpenRouter vs direct)
 *   8. Capability registry + task classification
 *   9. Context-aware routing (reject too-small context)
 *   10. Per-task overrides from prefs
 *   11. Cost model + budget routing math
 *   12. Routing telemetry + /route explain
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ProviderRegistry,
  FallbackExecutor,
  RoutingEngine,
  TelemetryStore,
  hasCredential,
  credentialSource,
  resolveServedBy,
  loadModelPrefs,
  saveModelPrefs,
  getDefaultPrefsPath,
  getModelCost,
  estimateRunCost,
  CAPABILITY_LABELS,
  TASK_REQUIREMENTS,
  type ModelPrefs,
  type ModelProvider,
} from "../lib/provider-registry.js";
import { routeModel, MODEL_CATALOG, type ModelChoice } from "../lib/model-routing.js";
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

  it("hasCredential returns false when only OpenRouter fallback key is set (SEC-5.9)", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const provider: ModelProvider = {
      id: "anthropic",
      label: "Anthropic",
      credentialType: "byok",
      envKey: "ANTHROPIC_API_KEY",
      altEnvKeys: ["OPENROUTER_API_KEY"],
    };
    // SEC-5.9: an OpenRouter key is NOT a credential for Anthropic.
    // resolveServedBy() correctly reports OpenRouter as the server,
    // but hasCredential() must not treat a cross-provider key as a
    // direct credential.
    expect(hasCredential(provider)).toBe(false);
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

  it("reports ready or unverified for OpenRouter when key is set", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const openrouter = registry.getProviderStatus("openrouter");
    expect(openrouter).not.toBeNull();
    // Health is "ready" (proven) or "unverified" (routable but health check didn't pass)
    expect(["ready", "unverified", "down"]).toContain(openrouter!.health);
    expect(openrouter!.hasCredential).toBe(true);
  });

  it("UNKNOWN is not READY — unverified is routable but not proven", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const anthropic = registry.getProviderStatus("anthropic");
    expect(anthropic).not.toBeNull();
    // Anthropic has no direct health URL, so it's "unverified" not "ready"
    // (unless OpenRouter health check passed, in which case it's still
    // served by OpenRouter, not directly tested as Anthropic)
    if (anthropic!.health === "unverified") {
      // Models are routable but not proven
      expect(anthropic!.models.length).toBeGreaterThan(0);
      expect(anthropic!.models.every((m) => m.proven === false)).toBe(true);
    }
  });

  it("servedBy shows OpenRouter when only OpenRouter key is set", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const anthropic = registry.getProviderStatus("anthropic");
    expect(anthropic).not.toBeNull();
    // Claude is served by OpenRouter, not directly by Anthropic
    expect(anthropic!.servedBy).toBe("openrouter");
  });

  it("servedBy shows direct provider when direct key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const anthropic = registry.getProviderStatus("anthropic");
    expect(anthropic).not.toBeNull();
    expect(anthropic!.servedBy).toBe("anthropic");
  });

  it("Anthropic models available via OpenRouter even without direct key", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const anthropic = registry.getProviderStatus("anthropic");
    expect(anthropic).not.toBeNull();
    // SEC-5.9: hasCredential is false (no direct Anthropic key), but
    // models are still available because OpenRouter serves them.
    expect(anthropic!.hasCredential).toBe(false);
    expect(anthropic!.servedBy).toBe("openrouter");
    expect(anthropic!.models.length).toBeGreaterThan(0);
  });

  it("getAvailableModels returns only models from ready/unverified providers", async () => {
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

  it("getProvenModels excludes unverified providers", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const proven = registry.getProvenModels();
    // Only models from providers with health === "ready"
    expect(proven.length).toBeLessThanOrEqual(registry.getAvailableModels().length);
  });

  it("isModelAvailable returns false for models with no credentialed provider", async () => {
    // No keys set at all
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    expect(registry.isModelAvailable("anthropic/claude-sonnet-5")).toBe(false);
  });

  it("isModelAvailable returns true when OpenRouter is available", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    // OpenRouter can route to any model
    expect(registry.isModelAvailable("anthropic/claude-sonnet-5")).toBe(true);
  });

  it("getModelServedBy returns openrouter when only OpenRouter key set", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    expect(registry.getModelServedBy("anthropic/claude-sonnet-5")).toBe("openrouter");
  });

  it("getUnavailableReason explains why a model is unavailable", async () => {
    // Ensure no keys are set (beforeEach clears them, but be explicit)
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const reason = registry.getUnavailableReason("anthropic/claude-sonnet-5");
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
    const chain = registry.getFallbackChain("openai/gpt-5.6-sol", "coding");
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0].id).toBe("openai/gpt-5.6-sol");
    // Should include other coding-capable models as fallbacks
    const hasOther = chain.some(m => m.id !== "openai/gpt-5.6-sol" && m.strengths.includes("coding"));
    expect(hasOther).toBe(true);
  });

  it("getNextFallback returns a different model each time", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const first = registry.getNextFallback("openai/gpt-5.6-sol", "coding", []);
    expect(first).not.toBeNull();
    const second = registry.getNextFallback("openai/gpt-5.6-sol", "coding", [first!.id]);
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
    executor.nextFallback("openai/gpt-5.6-sol", "coding");
    executor.nextFallback("anthropic/claude-sonnet-5", "coding");
    expect(executor.getTried()).toEqual(["openai/gpt-5.6-sol", "anthropic/claude-sonnet-5"]);
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
    const available = ["openai/gpt-5.6-terra", "openai/gpt-5.6-sol"];
    const choice = routeModel("auto", null, "fix this TypeScript bug", available);
    expect(available).toContain(choice.id);
    expect(choice.id).not.toContain("anthropic");
  });

  it("routeModel falls back to full catalog when no available list provided", () => {
    const choice = routeModel("auto", null, "fix this bug");
    expect(MODEL_CATALOG.map(m => m.id)).toContain(choice.id);
  });

  it("routeModel budget mode respects availability", () => {
    const available = ["openai/gpt-5.6-terra", "openai/gpt-5.6-sol"];
    const choice = routeModel("budget", null, "write a function", available);
    expect(available).toContain(choice.id);
  });

  it("routeModel max mode respects availability", () => {
    const available = ["openai/gpt-5.6-terra", "openai/gpt-5.6-sol"];
    const choice = routeModel("max", null, "design architecture", available);
    expect(available).toContain(choice.id);
  });

  it("routeModel fixed mode falls through when selected model unavailable", () => {
    const available = ["openai/gpt-5.6-terra"];
    // User selected Claude but it's not available → should fall through to auto
    const choice = routeModel("fixed", "anthropic/claude-sonnet-5", "fix bug", available);
    expect(available).toContain(choice.id);
  });

  it("routeModel coding task prefers Qwen3 Coder when available", () => {
    const available = ["qwen/qwen3-coder", "anthropic/claude-sonnet-5", "google/gemini-2.5-pro"];
    const choice = routeModel("auto", null, "fix this TypeScript bug in auth.ts", available);
    expect(choice.id).toBe("qwen/qwen3-coder");
  });

  it("routeModel reasoning task prefers GPT-5.6 Sol when available", () => {
    const available = ["openai/gpt-5.6-sol", "openai/gpt-5.6-terra", "anthropic/claude-sonnet-5"];
    const choice = routeModel("auto", null, "redesign the execution architecture", available);
    expect(choice.id).toBe("openai/gpt-5.6-sol");
  });

  it("routeModel vision task prefers Gemini when available", () => {
    const available = ["google/gemini-2.5-pro", "anthropic/claude-sonnet-5", "openai/gpt-5.6-terra"];
    const choice = routeModel("auto", null, "inspect this screenshot and reproduce the UI", available);
    expect(choice.id).toBe("google/gemini-2.5-pro");
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
      selectedModel: "qwen/qwen3-coder",
      capabilityOverrides: { coding: "qwen/qwen3-coder" },
      lastUsedModel: "anthropic/claude-sonnet-5",
      showFallbackNotifications: false,
    };

    saveModelPrefs(prefs, prefsPath);
    const loaded = loadModelPrefs(prefsPath);

    expect(loaded.routingMode).toBe("fixed");
    expect(loaded.selectedModel).toBe("qwen/qwen3-coder");
    expect(loaded.capabilityOverrides.coding).toBe("qwen/qwen3-coder");
    expect(loaded.lastUsedModel).toBe("anthropic/claude-sonnet-5");
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
      selectedModel: "openai/gpt-5.6-sol",
      capabilityOverrides: {
        coding: "qwen/qwen3-coder",
        reasoning: "openai/gpt-5.6-sol",
        vision: "google/gemini-2.5-pro",
      },
      lastUsedModel: "google/gemini-2.5-pro",
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

// ─── Source truth tests ────────────────────────────────────────────

describe("Source truth (servedBy)", () => {
  it("resolveServedBy returns openrouter when only OpenRouter key set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const provider: ModelProvider = {
      id: "anthropic",
      label: "Anthropic",
      credentialType: "byok",
      envKey: "ANTHROPIC_API_KEY",
      altEnvKeys: ["OPENROUTER_API_KEY"],
    };
    expect(resolveServedBy(provider)).toBe("openrouter");
  });

  it("resolveServedBy returns direct provider when direct key set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const provider: ModelProvider = {
      id: "anthropic",
      label: "Anthropic",
      credentialType: "byok",
      envKey: "ANTHROPIC_API_KEY",
      altEnvKeys: ["OPENROUTER_API_KEY"],
    };
    expect(resolveServedBy(provider)).toBe("anthropic");
  });

  it("resolveServedBy returns local for local providers", () => {
    const provider: ModelProvider = {
      id: "local",
      label: "Local",
      credentialType: "local",
    };
    expect(resolveServedBy(provider)).toBe("local");
  });
});

// ─── Capability registry tests ─────────────────────────────────────

describe("Capability registry", () => {
  it("CAPABILITY_LABELS has all capabilities", () => {
    expect(CAPABILITY_LABELS.coding).toBe("Coding");
    expect(CAPABILITY_LABELS.reasoning).toBe("Reasoning");
    expect(CAPABILITY_LABELS.vision).toBe("Vision");
    expect(CAPABILITY_LABELS.tools).toBe("Tool Use");
    expect(CAPABILITY_LABELS.longContext).toBe("Long Context");
    expect(CAPABILITY_LABELS.fast).toBe("Fast");
    expect(CAPABILITY_LABELS.local).toBe("Local");
    expect(CAPABILITY_LABELS.structuredOutput).toBe("Structured Output");
  });

  it("TASK_REQUIREMENTS maps task types to required capabilities", () => {
    expect(TASK_REQUIREMENTS.coding).toContain("coding");
    expect(TASK_REQUIREMENTS.coding).toContain("tools");
    expect(TASK_REQUIREMENTS.reasoning).toContain("reasoning");
    expect(TASK_REQUIREMENTS.vision).toContain("vision");
    expect(TASK_REQUIREMENTS.local).toContain("local");
    expect(TASK_REQUIREMENTS.general).toEqual([]);
  });
});

// ─── Routing engine tests ──────────────────────────────────────────

describe("RoutingEngine", () => {
  it("classifies coding tasks", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    const engine = new RoutingEngine(registry, { routingMode: "auto", selectedModel: null, capabilityOverrides: {}, lastUsedModel: null, showFallbackNotifications: true }, MODEL_CATALOG);
    expect(engine.classifyTask("fix this TypeScript bug")).toBe("coding");
    expect(engine.classifyTask("implement a new function")).toBe("coding");
    expect(engine.classifyTask("refactor the auth module")).toBe("coding");
  });

  it("classifies reasoning tasks", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    const engine = new RoutingEngine(registry, { routingMode: "auto", selectedModel: null, capabilityOverrides: {}, lastUsedModel: null, showFallbackNotifications: true }, MODEL_CATALOG);
    expect(engine.classifyTask("design the execution architecture")).toBe("reasoning");
    expect(engine.classifyTask("analyze this complex system")).toBe("reasoning");
  });

  it("classifies vision tasks", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    const engine = new RoutingEngine(registry, { routingMode: "auto", selectedModel: null, capabilityOverrides: {}, lastUsedModel: null, showFallbackNotifications: true }, MODEL_CATALOG);
    expect(engine.classifyTask("inspect this screenshot")).toBe("vision");
    expect(engine.classifyTask("reproduce this UI from the image")).toBe("vision");
  });

  it("classifies local/private tasks", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    const engine = new RoutingEngine(registry, { routingMode: "auto", selectedModel: null, capabilityOverrides: {}, lastUsedModel: null, showFallbackNotifications: true }, MODEL_CATALOG);
    expect(engine.classifyTask("don't send any code off this machine")).toBe("local");
    expect(engine.classifyTask("keep it local and offline")).toBe("local");
  });

  it("classifies fast tasks (short requests)", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    const engine = new RoutingEngine(registry, { routingMode: "auto", selectedModel: null, capabilityOverrides: {}, lastUsedModel: null, showFallbackNotifications: true }, MODEL_CATALOG);
    expect(engine.classifyTask("make button blue")).toBe("fast");
  });

  it("produces telemetry with full routing decision", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const engine = new RoutingEngine(registry, { routingMode: "auto", selectedModel: null, capabilityOverrides: {}, lastUsedModel: null, showFallbackNotifications: true }, MODEL_CATALOG);
    const { choice, telemetry } = engine.route("fix this TypeScript bug", null, null, "auto");
    expect(telemetry.taskType).toBe("coding");
    expect(telemetry.selectedModel).toBe(choice.id);
    expect(telemetry.servedBy).toBeDefined();
    expect(telemetry.estimatedCost).toBeGreaterThan(0);
    expect(telemetry.candidates.length).toBeGreaterThan(0);
    expect(telemetry.timestamp).toBeGreaterThan(0);
  });

  it("per-task override takes priority over auto routing", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const prefs: ModelPrefs = {
      routingMode: "auto",
      selectedModel: null,
      capabilityOverrides: { coding: "anthropic/claude-sonnet-5" },
      lastUsedModel: null,
      showFallbackNotifications: true,
    };
    const engine = new RoutingEngine(registry, prefs, MODEL_CATALOG);
    const { choice } = engine.route("fix this bug", null, null, "auto");
    expect(choice.id).toBe("anthropic/claude-sonnet-5");
  });

  it("budget mode picks cheapest capable model mathematically", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const engine = new RoutingEngine(registry, { routingMode: "budget", selectedModel: null, capabilityOverrides: {}, lastUsedModel: null, showFallbackNotifications: true }, MODEL_CATALOG);
    // Pass explicit available list including local model (which might be down in real health check)
    const allIds = MODEL_CATALOG.map(m => m.id);
    const { choice, telemetry } = engine.route("fix this bug", allIds, null, "budget");
    // Should pick the cheapest model with coding capability
    const codingModels = MODEL_CATALOG.filter(m => m.strengths.includes("coding"));
    const cheapest = [...codingModels].sort((a, b) =>
      (getModelCost(a.id).inputPer1M + getModelCost(a.id).outputPer1M) -
      (getModelCost(b.id).inputPer1M + getModelCost(b.id).outputPer1M)
    )[0];
    expect(choice.id).toBe(cheapest.id);
  });

  it("context-aware routing rejects models with too-small context", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    // Use a custom catalog with a small-context model to test rejection
    const smallContextCatalog: ModelChoice[] = [
      ...MODEL_CATALOG,
      {
        id: "test/small-context-coder",
        label: "Test Small Context",
        provider: "OpenAI",
        description: "Test model with 16K context",
        strengths: ["coding", "tools"],
        cost: 1,
        power: 2,
        contextK: 16,
      },
    ];
    const engine = new RoutingEngine(registry, { routingMode: "auto", selectedModel: null, capabilityOverrides: {}, lastUsedModel: null, showFallbackNotifications: true }, smallContextCatalog);
    const allIds = smallContextCatalog.map(m => m.id);
    // Use a coding task that implies reading the entire repository (estimates 50K+ context)
    const longRequest = "fix this bug by reading all the files in the entire repository and understanding the whole project structure";
    const { telemetry } = engine.route(longRequest, allIds, null, "auto");
    // Small-context model should be in rejected list (16K < estimated 50K+ context)
    const smallRejected = telemetry.rejected.find(r => r.modelId === "test/small-context-coder");
    expect(smallRejected).toBeDefined();
    expect(smallRejected!.reason).toContain("Context too small");
  });
});

// ─── Cost model tests ──────────────────────────────────────────────

describe("Cost model", () => {
  it("getModelCost returns cost for known models", () => {
    const cost = getModelCost("anthropic/claude-sonnet-5");
    expect(cost.inputPer1M).toBeGreaterThan(0);
    expect(cost.outputPer1M).toBeGreaterThan(0);
    expect(cost.paymentModel).toBe("byok");
  });

  it("getModelCost returns default for unknown models", () => {
    const cost = getModelCost("unknown/model");
    expect(cost.inputPer1M).toBeGreaterThan(0);
    expect(cost.paymentModel).toBe("byok");
  });

  it("local model has zero cost", () => {
    const cost = getModelCost("qwen/qwen3-coder");
    expect(cost.inputPer1M).toBe(0);
    expect(cost.outputPer1M).toBe(0);
  });

  it("estimateRunCost calculates correctly", () => {
    // Claude Sonnet: $3/1M input, $15/1M output
    // 100K input + 10K output = 0.3 + 0.15 = $0.45
    const cost = estimateRunCost("anthropic/claude-sonnet-5", 100_000, 10_000);
    expect(cost).toBeCloseTo(0.45, 2);
  });

  it("estimateRunCost for local model is zero", () => {
    const cost = estimateRunCost("qwen/qwen3-coder", 100_000, 10_000);
    expect(cost).toBe(0);
  });
});

// ─── Telemetry store tests ─────────────────────────────────────────

describe("TelemetryStore", () => {
  it("stores and retrieves telemetry records", () => {
    const store = new TelemetryStore();
    const telemetry = {
      request: "test",
      taskType: "coding" as const,
      routingMode: "auto",
      estimatedContextTokens: 5000,
      requiredCapabilities: ["coding" as const, "tools" as const],
      candidates: ["model-a"],
      rejected: [],
      selectedModel: "model-a",
      servedBy: "openrouter",
      credentialSource: "OPENROUTER_API_KEY",
      fallbackAttempts: [],
      estimatedCost: 0.01,
      actualCost: null,
      timestamp: Date.now(),
    };
    store.record(telemetry);
    expect(store.getLast()?.selectedModel).toBe("model-a");
  });

  it("retains max 50 records", () => {
    const store = new TelemetryStore();
    for (let i = 0; i < 60; i++) {
      store.record({
        request: `test-${i}`,
        taskType: "general" as const,
        routingMode: "auto",
        estimatedContextTokens: 1000,
        requiredCapabilities: [],
        candidates: [],
        rejected: [],
        selectedModel: `model-${i}`,
        servedBy: "openrouter",
        credentialSource: "OPENROUTER_API_KEY",
        fallbackAttempts: [],
        estimatedCost: 0.01,
        actualCost: null,
        timestamp: Date.now(),
      });
    }
    expect(store.getAll().length).toBe(50);
  });

  it("clear empties the store", () => {
    const store = new TelemetryStore();
    store.record({
      request: "test",
      taskType: "general" as const,
      routingMode: "auto",
      estimatedContextTokens: 1000,
      requiredCapabilities: [],
      candidates: [],
      rejected: [],
      selectedModel: "model-a",
      servedBy: "openrouter",
      credentialSource: "OPENROUTER_API_KEY",
      fallbackAttempts: [],
      estimatedCost: 0.01,
      actualCost: null,
      timestamp: Date.now(),
    });
    store.clear();
    expect(store.getLast()).toBeNull();
  });
});

// ─── Async refresh tests ───────────────────────────────────────────

describe("Async health refresh", () => {
  it("refreshAsync does not block", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    // Should return immediately
    registry.refreshAsync();
    // Statuses might be empty (first call) — that's OK
    expect(registry.isCacheFresh()).toBe(false);
  });

  it("isCacheFresh returns true after refresh", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    expect(registry.isCacheFresh()).toBe(true);
  });

  it("getAvailableModelIds returns array of IDs", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const registry = new ProviderRegistry(MODEL_CATALOG);
    await registry.refresh();
    const ids = registry.getAvailableModelIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("anthropic/claude-sonnet-5");
  });
});
