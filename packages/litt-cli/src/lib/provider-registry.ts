/**
 * ProviderRegistry — the real multi-model LiTT provider layer.
 *
 * This is what turns LiTT from a model picker into a real multi-model
 * operating system. Instead of a hardcoded catalog, the registry:
 *
 *   1. Discovers providers based on actual credentials
 *   2. Reports health status (READY / NO KEY / RATE LIMITED / DOWN)
 *   3. Exposes available models per provider
 *   4. Feeds credential-aware routing (don't route to Claude if no key)
 *   5. Supports fallback chains (if model A fails → try model B)
 *   6. Distinguishes BYOK vs LiTT Credits
 *
 * MODEL TRUTH (same philosophy as VerificationGate):
 *   available ≠ configured ≠ active
 *
 *   available  — provider has credentials and health check passed
 *   configured — user/project selected this model
 *   active     — runtime actually executed a request with it
 *
 * No model is presented as available unless its provider credential
 * is actually present and healthy.
 */

import type { ModelChoice } from "./model-routing.js";

// ─── Types ─────────────────────────────────────────────────────────

/**
 * A model provider — Anthropic, OpenAI, Google, OpenRouter, Local, etc.
 */
export interface ModelProvider {
  /** Provider ID: "anthropic", "openai", "google", "openrouter", "local" */
  id: string;
  /** Display name: "Anthropic", "OpenAI", etc. */
  label: string;
  /** What kind of credential pays for this provider */
  credentialType: "byok" | "litt-credits" | "free" | "local";
  /** Environment variable that holds the API key (if BYOK) */
  envKey?: string;
  /** Alternative env vars that also grant access (e.g. OpenRouter covers Anthropic) */
  altEnvKeys?: string[];
  /** Base URL for health checks */
  healthUrl?: string;
}

/**
 * Health status for a provider.
 */
export type ProviderHealth = "ready" | "no-key" | "rate-limited" | "down" | "unknown";

/**
 * A provider with resolved health + discovered models.
 * This is what the /models screen displays.
 */
export interface ProviderStatus {
  provider: ModelProvider;
  health: ProviderHealth;
  /** True if any credential (direct or via OpenRouter) grants access */
  hasCredential: boolean;
  /** Models discovered for this provider (from catalog or API) */
  models: DiscoveredModel[];
  /** Latency in ms from health check (if checked) */
  latencyMs: number | null;
  /** Last health check timestamp */
  lastChecked: number | null;
  /** Error message if health check failed */
  error: string | null;
}

/**
 * A model discovered from a provider — with availability truth.
 */
export interface DiscoveredModel {
  choice: ModelChoice;
  /** True if this model can actually be used right now */
  available: boolean;
  /** Why it's unavailable (if not) */
  unavailableReason?: string;
}

/**
 * Fallback chain result — what to try when a model fails.
 */
export interface FallbackResult {
  /** The model that was tried */
  modelId: string;
  /** Why it failed */
  reason: string;
  /** Whether to try the next model */
  shouldFallback: boolean;
  /** The next model to try (if any) */
  nextModel?: ModelChoice;
}

// ─── Provider definitions ──────────────────────────────────────────

/**
 * The known providers. OpenRouter is special — it's a meta-provider
 * that can route to models from Anthropic, OpenAI, Google, etc.
 * If OPENROUTER_API_KEY is set, all OpenRouter-routed models are available.
 */
const PROVIDERS: ModelProvider[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    credentialType: "byok",
    envKey: "OPENROUTER_API_KEY",
    healthUrl: "https://openrouter.ai/api/v1/models",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    credentialType: "byok",
    envKey: "ANTHROPIC_API_KEY",
    altEnvKeys: ["OPENROUTER_API_KEY"], // OpenRouter covers Anthropic
  },
  {
    id: "openai",
    label: "OpenAI",
    credentialType: "byok",
    envKey: "OPENAI_API_KEY",
    altEnvKeys: ["OPENROUTER_API_KEY"], // OpenRouter covers OpenAI
  },
  {
    id: "google",
    label: "Google",
    credentialType: "byok",
    envKey: "GOOGLE_API_KEY",
    altEnvKeys: ["OPENROUTER_API_KEY"], // OpenRouter covers Google
  },
  {
    id: "local",
    label: "Local",
    credentialType: "local",
    // Local models (Ollama) don't need an API key — just a running server
    healthUrl: "http://localhost:11434/api/tags",
  },
];

// ─── Credential resolution ─────────────────────────────────────────

/**
 * Check if a provider has credentials (direct or via OpenRouter).
 */
export function hasCredential(provider: ModelProvider): boolean {
  // Local providers don't need API keys
  if (provider.credentialType === "local") {
    return true; // Availability checked via health URL
  }

  // Check direct env key
  if (provider.envKey && process.env[provider.envKey]) {
    return true;
  }

  // Check alternative env keys (OpenRouter covers many providers)
  if (provider.altEnvKeys) {
    for (const altKey of provider.altEnvKeys) {
      if (process.env[altKey]) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get the credential source for a provider — which env var actually
 * granted access. This matters for BYOK vs LiTT Credits display.
 */
export function credentialSource(provider: ModelProvider): string | null {
  if (provider.credentialType === "local") {
    return "local";
  }

  if (provider.envKey && process.env[provider.envKey]) {
    return provider.envKey;
  }

  if (provider.altEnvKeys) {
    for (const altKey of provider.altEnvKeys) {
      if (process.env[altKey]) {
        return altKey;
      }
    }
  }

  return null;
}

// ─── Provider registry ─────────────────────────────────────────────

/**
 * ProviderRegistry — discovers and tracks provider health + model availability.
 *
 * Usage:
 *   const registry = new ProviderRegistry();
 *   await registry.refresh();
 *   const statuses = registry.getProviderStatuses();
 *   const available = registry.getAvailableModels();
 *   const fallback = registry.getFallbackChain("openai/gpt-5.6-codex", "coding");
 */
export class ProviderRegistry {
  private statuses: Map<string, ProviderStatus> = new Map();
  private catalog: ModelChoice[];

  constructor(catalog: ModelChoice[]) {
    this.catalog = catalog;
  }

  /**
   * Refresh provider health + model availability.
   * Calls health endpoints for each provider (with timeout).
   */
  async refresh(): Promise<void> {
    const checks = PROVIDERS.map((provider) => this.checkProvider(provider));
    await Promise.allSettled(checks);
  }

  /**
   * Check a single provider's health and resolve its models.
   */
  private async checkProvider(provider: ModelProvider): Promise<void> {
    const cred = hasCredential(provider);
    const source = credentialSource(provider);

    // No credential → no-key status, no models
    if (!cred) {
      this.statuses.set(provider.id, {
        provider,
        health: "no-key",
        hasCredential: false,
        models: [],
        latencyMs: null,
        lastChecked: Date.now(),
        error: null,
      });
      return;
    }

    // Has credential — check health if URL available
    let health: ProviderHealth = "ready";
    let latencyMs: number | null = null;
    let error: string | null = null;

    if (provider.healthUrl) {
      try {
        const start = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const headers: Record<string, string> = {};
        // Add auth header for providers that need it
        const keyEnv = source && source !== "local" ? source : null;
        if (keyEnv && process.env[keyEnv]) {
          headers["Authorization"] = `Bearer ${process.env[keyEnv]}`;
        }

        const response = await fetch(provider.healthUrl, {
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        latencyMs = Date.now() - start;

        if (response.ok) {
          health = "ready";
        } else if (response.status === 429) {
          health = "rate-limited";
          error = "Rate limited (429)";
        } else {
          health = "down";
          error = `HTTP ${response.status}`;
        }
      } catch (e) {
        // For local providers, being down just means Ollama isn't running
        if (provider.credentialType === "local") {
          health = "down";
          error = "Local server not running";
        } else {
          // Network error — provider might still work for API calls
          // (health endpoint might be different from API endpoint)
          health = "unknown";
          error = e instanceof Error ? e.message : String(e);
        }
        latencyMs = null;
      }
    }

    // Discover models for this provider from the catalog
    const models: DiscoveredModel[] = this.catalog
      .filter((choice) => choice.provider.toLowerCase() === provider.label.toLowerCase())
      .map((choice) => ({
        choice,
        available: health === "ready" || health === "unknown",
        unavailableReason: health !== "ready" && health !== "unknown"
          ? this.healthToReason(health)
          : undefined,
      }));

    this.statuses.set(provider.id, {
      provider,
      health,
      hasCredential: true,
      models,
      latencyMs,
      lastChecked: Date.now(),
      error,
    });
  }

  /**
   * Get all provider statuses.
   */
  getProviderStatuses(): ProviderStatus[] {
    return PROVIDERS.map((p) => this.statuses.get(p.id)).filter((s): s is ProviderStatus => s !== undefined);
  }

  /**
   * Get a specific provider status.
   */
  getProviderStatus(providerId: string): ProviderStatus | null {
    return this.statuses.get(providerId) ?? null;
  }

  /**
   * Get all available models across all providers.
   * Only models whose provider is READY or UNKNOWN (might work).
   */
  getAvailableModels(): ModelChoice[] {
    const result: ModelChoice[] = [];
    for (const status of this.statuses.values()) {
      if (status.health === "ready" || status.health === "unknown") {
        for (const model of status.models) {
          if (model.available) {
            result.push(model.choice);
          }
        }
      }
    }
    return result;
  }

  /**
   * Check if a specific model is available.
   */
  isModelAvailable(modelId: string): boolean {
    for (const status of this.statuses.values()) {
      const model = status.models.find((m) => m.choice.id === modelId);
      if (model) {
        return model.available;
      }
    }
    // Model not in any provider — check if OpenRouter has it
    const openrouter = this.statuses.get("openrouter");
    if (openrouter && openrouter.health === "ready") {
      // OpenRouter can route to any model, even if not in our catalog
      return true;
    }
    return false;
  }

  /**
   * Get the reason a model is unavailable.
   */
  getUnavailableReason(modelId: string): string | null {
    // Check if any provider has this model in its status
    let foundInAnyProvider = false;
    for (const status of this.statuses.values()) {
      const model = status.models.find((m) => m.choice.id === modelId);
      if (model) {
        foundInAnyProvider = true;
        if (!model.available) {
          return model.unavailableReason ?? "Provider not ready";
        }
      }
    }

    // Model not discovered in any provider's model list — check if its
    // provider exists but has no credential
    if (!foundInAnyProvider) {
      const choice = this.catalog.find((m) => m.id === modelId);
      if (choice) {
        // Find the matching provider by label
        const provider = PROVIDERS.find(
          (p) => p.label.toLowerCase() === choice.provider.toLowerCase(),
        );
        if (provider) {
          const status = this.statuses.get(provider.id);
          if (status && status.health === "no-key") {
            return `${provider.label} Credential required`;
          }
        }
        // If OpenRouter is available, the model might still be reachable
        const openrouter = this.statuses.get("openrouter");
        if (openrouter && openrouter.health === "ready") {
          return null; // Available via OpenRouter
        }
        return "No provider credential available";
      }
    }

    return null;
  }

  /**
   * Build a fallback chain for a model + capability.
   *
   * If the primary model fails, try other models with the same
   * capability, ordered by power (descending) then cost (ascending).
   */
  getFallbackChain(
    primaryModelId: string,
    capability: string,
  ): ModelChoice[] {
    const available = this.getAvailableModels();
    const primary = available.find((m) => m.id === primaryModelId);

    // Models with the same capability, excluding the primary
    const candidates = available
      .filter((m) => m.id !== primaryModelId)
      .filter((m) => m.strengths.includes(capability))
      .sort((a, b) => {
        // Prefer higher power, then lower cost
        if (b.power !== a.power) return b.power - a.power;
        return a.cost - b.cost;
      });

    // Primary first, then fallbacks
    const chain: ModelChoice[] = [];
    if (primary) chain.push(primary);
    chain.push(...candidates);
    return chain;
  }

  /**
   * Get the next model to try after a failure.
   */
  getNextFallback(
    failedModelId: string,
    capability: string,
    triedIds: string[],
  ): ModelChoice | null {
    const chain = this.getFallbackChain(failedModelId, capability);
    const next = chain.find((m) => !triedIds.includes(m.id));
    return next ?? null;
  }

  private healthToReason(health: ProviderHealth): string {
    switch (health) {
      case "no-key": return "Credential required";
      case "rate-limited": return "Rate limited — try again later";
      case "down": return "Provider is down";
      case "unknown": return "Health unknown";
      case "ready": return "";
    }
  }
}

// ─── Persistence ───────────────────────────────────────────────────

/**
 * Persisted model preferences — survives closing and reopening litt.
 * Stored in ~/.litt/model-prefs.json
 */
export interface ModelPrefs {
  /** Routing mode preference */
  routingMode: "auto" | "fixed" | "budget" | "max";
  /** Explicitly selected model (for "fixed" mode) */
  selectedModel: string | null;
  /** Per-capability overrides: { coding: "openai/gpt-5.6-codex", ... } */
  capabilityOverrides: Record<string, string>;
  /** Last used model (for convenience) */
  lastUsedModel: string | null;
  /** Whether to show fallback notifications */
  showFallbackNotifications: boolean;
}

const DEFAULT_PREFS: ModelPrefs = {
  routingMode: "auto",
  selectedModel: null,
  capabilityOverrides: {},
  lastUsedModel: null,
  showFallbackNotifications: true,
};

/**
 * Load model preferences from disk.
 * Returns defaults if file doesn't exist or is corrupt.
 */
export function loadModelPrefs(prefsPath: string): ModelPrefs {
  try {
    const fs = require("fs");
    if (!fs.existsSync(prefsPath)) {
      return { ...DEFAULT_PREFS };
    }
    const raw = fs.readFileSync(prefsPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Save model preferences to disk.
 */
export function saveModelPrefs(prefs: ModelPrefs, prefsPath: string): void {
  try {
    const fs = require("fs");
    const path = require("path");
    const dir = path.dirname(prefsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2) + "\n", "utf-8");
  } catch {
    // Non-fatal — prefs are convenience, not critical
  }
}

/**
 * Get the default prefs path: ~/.litt/model-prefs.json
 */
export function getDefaultPrefsPath(): string {
  const path = require("path");
  const os = require("os");
  const littHome = process.env.LITT_HOME ?? path.join(os.homedir(), ".litt");
  return path.join(littHome, "model-prefs.json");
}

// ─── Fallback execution ────────────────────────────────────────────

/**
 * FallbackExecutor — tries models in order until one succeeds.
 *
 * If a model fails with a rate-limit or network error, it tries the
 * next model in the fallback chain. If a model fails with a content
 * error (bad response), it does NOT fallback (the model worked, just
 * gave a bad answer — that's a different problem).
 */
export class FallbackExecutor {
  private registry: ProviderRegistry;
  private triedIds: string[] = [];

  constructor(registry: ProviderRegistry) {
    this.registry = registry;
  }

  /**
   * Determine if an error should trigger a fallback.
   * Rate limits, network errors, and server errors → fallback.
   * Content errors (bad response, parse errors) → no fallback.
   */
  shouldFallback(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      // Rate limited
      if (msg.includes("429") || msg.includes("rate limit")) return true;
      // Server errors
      if (msg.includes("500") || msg.includes("502") || msg.includes("503")) return true;
      // Network errors
      if (msg.includes("network") || msg.includes("econnreset") || msg.includes("timeout")) return true;
      // API key errors
      if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized")) return true;
    }
    return false;
  }

  /**
   * Get the next model to try after a failure.
   */
  nextFallback(failedModelId: string, capability: string): ModelChoice | null {
    this.triedIds.push(failedModelId);
    return this.registry.getNextFallback(failedModelId, capability, this.triedIds);
  }

  /**
   * Reset the tried list (for a new mission).
   */
  reset(): void {
    this.triedIds = [];
  }

  /**
   * Get the list of tried model IDs (for telemetry/display).
   */
  getTried(): string[] {
    return [...this.triedIds];
  }
}
