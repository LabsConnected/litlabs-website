/**
 * ProviderRegistry — the real multi-model LiTT provider layer.
 *
 * This is what turns LiTT from a model picker into a real multi-model
 * operating system. Instead of a hardcoded catalog, the registry:
 *
 *   1. Discovers providers based on actual credentials
 *   2. Reports health status (READY / NO KEY / RATE LIMITED / DOWN / UNVERIFIED)
 *   3. Exposes available models per provider with SOURCE TRUTH
 *   4. Feeds credential-aware routing (don't route to Claude if no key)
 *   5. Supports fallback chains (if model A fails → try model B)
 *   6. Distinguishes BYOK vs LiTT Credits
 *   7. Caches health checks — async refresh, never blocks UI
 *
 * MODEL TRUTH (same philosophy as VerificationGate):
 *   available ≠ configured ≠ active ≠ proven
 *
 *   available  — provider has credentials and is routable
 *   configured — user/project selected this model
 *   active     — runtime actually executed a request with it
 *   proven     — health check passed (READY), not just routable (UNVERIFIED)
 *
 * SOURCE TRUTH:
 *   If Claude is served through OpenRouter, we show:
 *     MODEL     Claude Sonnet 4.6
 *     SOURCE    OpenRouter
 *     ROUTE     Anthropic model
 *     PAYMENT   BYOK
 *   We do NOT report "Anthropic READY" as though a direct Anthropic
 *   connection was tested. The `servedBy` field tracks this.
 *
 * HEALTH TRUTH:
 *   UNKNOWN ≠ READY. A provider with UNKNOWN health is *routable*
 *   (credential exists, might work) but NOT *proven* (health check
 *   didn't pass). The UI must say UNVERIFIED, not imply health was
 *   tested.
 */

import type { ModelChoice } from "./model-routing.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ─── Capability registry ───────────────────────────────────────────

/**
 * Formal capability registry — what a model can do.
 * Used for routing, filtering, and display.
 */
export type Capability =
  | "coding"
  | "reasoning"
  | "vision"
  | "tools"
  | "longContext"
  | "fast"
  | "local"
  | "structuredOutput";

export const CAPABILITY_LABELS: Record<Capability, string> = {
  coding: "Coding",
  reasoning: "Reasoning",
  vision: "Vision",
  tools: "Tool Use",
  longContext: "Long Context",
  fast: "Fast",
  local: "Local",
  structuredOutput: "Structured Output",
};

/**
 * Task type → required capabilities.
 * The routing engine uses this to filter candidates.
 */
export type TaskType = "coding" | "reasoning" | "vision" | "fast" | "local" | "general";

export const TASK_REQUIREMENTS: Record<TaskType, Capability[]> = {
  coding: ["coding", "tools"],
  reasoning: ["reasoning"],
  vision: ["vision"],
  fast: ["fast"],
  local: ["local"],
  general: [],
};

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
 * READY = health check passed (proven)
 * UNVERIFIED = credential exists but health check didn't pass (routable, not proven)
 * NO KEY = no credential
 * RATE LIMITED = 429
 * DOWN = health check failed
 */
export type ProviderHealth = "ready" | "unverified" | "no-key" | "rate-limited" | "down";

/**
 * A provider with resolved health + discovered models.
 * This is what the /models screen displays.
 */
export interface ProviderStatus {
  provider: ModelProvider;
  health: ProviderHealth;
  /** True if any credential (direct or via OpenRouter) grants access */
  hasCredential: boolean;
  /** Which provider actually serves requests for this provider (source truth) */
  servedBy: string;
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
 * A model discovered from a provider — with availability + source truth.
 */
export interface DiscoveredModel {
  choice: ModelChoice;
  /** True if this model can be routed to right now */
  available: boolean;
  /** Why it's unavailable (if not) */
  unavailableReason?: string;
  /** Which provider actually serves this model (source truth) */
  servedBy: string;
  /** Whether the serving provider's health was proven vs unverified */
  proven: boolean;
}

/**
 * Fallback chain result — what to try when a model fails.
 */
export interface FallbackResult {
  modelId: string;
  reason: string;
  shouldFallback: boolean;
  nextModel?: ModelChoice;
}

// ─── Cost model ────────────────────────────────────────────────────

/**
 * Real cost information for a model.
 * Prices are per 1M tokens in USD.
 */
export interface ModelCost {
  /** Price per 1M input tokens (USD) */
  inputPer1M: number;
  /** Price per 1M output tokens (USD) */
  outputPer1M: number;
  /** LiTT markup multiplier (1.0 = no markup, 1.1 = 10% markup) */
  markup: number;
  /** Whether this model is paid via BYOK (no LiTT charge) or LiTT Credits */
  paymentModel: "byok" | "litt-credits";
}

/**
 * Known costs for catalog models.
 * In production, this could be fetched from OpenRouter's pricing API.
 */
const MODEL_COSTS: Record<string, ModelCost> = {
  "openrouter/auto": { inputPer1M: 3, outputPer1M: 15, markup: 1.0, paymentModel: "byok" },
  "anthropic/claude-sonnet-5": { inputPer1M: 3, outputPer1M: 15, markup: 1.0, paymentModel: "byok" },
  "openai/gpt-5.6-sol": { inputPer1M: 5, outputPer1M: 15, markup: 1.0, paymentModel: "byok" },
  "openai/gpt-5.6-terra": { inputPer1M: 3, outputPer1M: 10, markup: 1.0, paymentModel: "byok" },
  "openai/gpt-5.6-luna": { inputPer1M: 1, outputPer1M: 4, markup: 1.0, paymentModel: "byok" },
  "google/gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 5, markup: 1.0, paymentModel: "byok" },
  "google/gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5, markup: 1.0, paymentModel: "byok" },
  "qwen/qwen3-coder": { inputPer1M: 0, outputPer1M: 0, markup: 1.0, paymentModel: "byok" },
};

/**
 * Get the cost info for a model. Returns a default if unknown.
 */
export function getModelCost(modelId: string): ModelCost {
  return MODEL_COSTS[modelId] ?? { inputPer1M: 5, outputPer1M: 15, markup: 1.0, paymentModel: "byok" };
}

/**
 * Estimate the cost of a run.
 * @param modelId — the model
 * @param inputTokens — estimated input tokens
 * @param outputTokens — estimated output tokens
 * @returns estimated cost in USD
 */
export function estimateRunCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const cost = getModelCost(modelId);
  const baseCost = (inputTokens / 1_000_000) * cost.inputPer1M + (outputTokens / 1_000_000) * cost.outputPer1M;
  return baseCost * cost.markup;
}

// ─── Routing telemetry ─────────────────────────────────────────────

/**
 * Telemetry record for a single routing decision.
 * Retained for `/route explain` and audit.
 */
export interface RoutingTelemetry {
  /** What the user requested */
  request: string;
  /** Classified task type */
  taskType: TaskType;
  /** Routing mode (auto/fixed/budget/max) */
  routingMode: string;
  /** Estimated context size in tokens */
  estimatedContextTokens: number;
  /** Required capabilities for this task */
  requiredCapabilities: Capability[];
  /** All candidate models that were considered */
  candidates: string[];
  /** Models rejected + why */
  rejected: Array<{ modelId: string; reason: string }>;
  /** The model that was selected */
  selectedModel: string;
  /** Which provider serves the selected model */
  servedBy: string;
  /** Credential source (which env var) */
  credentialSource: string;
  /** Fallback attempts (if any) */
  fallbackAttempts: Array<{ modelId: string; reason: string }>;
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Actual cost (filled after run completes) */
  actualCost: number | null;
  /** Routing timestamp */
  timestamp: number;
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
    altEnvKeys: ["OPENROUTER_API_KEY"],
  },
  {
    id: "openai",
    label: "OpenAI",
    credentialType: "byok",
    envKey: "OPENAI_API_KEY",
    altEnvKeys: ["OPENROUTER_API_KEY"],
  },
  {
    id: "google",
    label: "Google",
    credentialType: "byok",
    envKey: "GOOGLE_API_KEY",
    altEnvKeys: ["OPENROUTER_API_KEY"],
  },
  {
    id: "local",
    label: "Local",
    credentialType: "local",
    healthUrl: "http://localhost:11434/api/tags",
  },
];

// ─── Credential resolution ─────────────────────────────────────────

/**
 * Check if a provider has its OWN direct credentials.
 *
 * SEC-5.9: This must NOT return true merely because an OpenRouter key
 * is present. An OpenRouter key is a credential for OpenRouter, not
 * for OpenAI/Anthropic/Google. Treating it as such lets a cross-provider
 * credential satisfy a different provider's gate, which can expose the
 * key to a provider that never issued it.
 *
 * The `altEnvKeys` field is still honored by `resolveServedBy()` and
 * `credentialSource()` — those correctly report that OpenRouter will
 * serve the request. But `hasCredential()` answers "does THIS provider
 * have its own key?", and the answer is no.
 */
export function hasCredential(provider: ModelProvider): boolean {
  if (provider.credentialType === "local") return true;
  if (provider.envKey && process.env[provider.envKey]) return true;
  return false;
}

/**
 * Get the credential source for a provider — which env var actually
 * granted access. This matters for BYOK vs LiTT Credits display.
 */
export function credentialSource(provider: ModelProvider): string | null {
  if (provider.credentialType === "local") return "local";
  if (provider.envKey && process.env[provider.envKey]) return provider.envKey;
  if (provider.altEnvKeys) {
    for (const altKey of provider.altEnvKeys) {
      if (process.env[altKey]) return altKey;
    }
  }
  return null;
}

/**
 * Determine which provider actually SERVES a model.
 * If only OpenRouter key is set (no direct Anthropic key), Claude is
 * served by OpenRouter, not Anthropic. This is SOURCE TRUTH.
 */
export function resolveServedBy(provider: ModelProvider): string {
  if (provider.credentialType === "local") return "local";
  // If direct key is set, the provider serves directly
  if (provider.envKey && process.env[provider.envKey]) return provider.id;
  // If only alt key (OpenRouter) is set, OpenRouter serves it
  if (provider.altEnvKeys) {
    for (const altKey of provider.altEnvKeys) {
      if (process.env[altKey]) {
        // Map env key to provider ID
        if (altKey === "OPENROUTER_API_KEY") return "openrouter";
        return altKey.toLowerCase().replace("_api_key", "");
      }
    }
  }
  return provider.id;
}

// ─── Provider registry ─────────────────────────────────────────────

/**
 * ProviderRegistry — discovers and tracks provider health + model availability.
 *
 * Health refresh is CACHED and ASYNCHRONOUS:
 *   - First call to refresh() checks all providers
 *   - Subsequent calls use last-known status immediately
 *   - refreshAsync() updates in background without blocking
 *   - Opening /models shows last-known instantly, refreshes in background
 */
export class ProviderRegistry {
  private statuses: Map<string, ProviderStatus> = new Map();
  private catalog: ModelChoice[];
  private lastRefreshTime: number = 0;
  private refreshInProgress: boolean = false;
  private refreshTTL: number = 30_000; // 30s cache

  constructor(catalog: ModelChoice[]) {
    this.catalog = catalog;
  }

  /**
   * Refresh provider health + model availability.
   * Calls health endpoints for each provider (with timeout).
   * Blocks until all checks complete.
   */
  async refresh(): Promise<void> {
    if (this.refreshInProgress) {
      // Wait for in-progress refresh
      while (this.refreshInProgress) await sleep(50);
      return;
    }
    this.refreshInProgress = true;
    try {
      const checks = PROVIDERS.map((provider) => this.checkProvider(provider));
      await Promise.allSettled(checks);
      this.lastRefreshTime = Date.now();
    } finally {
      this.refreshInProgress = false;
    }
  }

  /**
   * Async refresh — returns immediately with last-known status.
   * Updates in background. Use this for UI to avoid blocking.
   */
  refreshAsync(): void {
    if (this.refreshInProgress) return;
    if (Date.now() - this.lastRefreshTime < this.refreshTTL) return; // Cache fresh
    this.refresh().catch(() => {}); // Fire and forget
  }

  /**
   * Check if cached status is still fresh.
   */
  isCacheFresh(): boolean {
    return Date.now() - this.lastRefreshTime < this.refreshTTL;
  }

  /**
   * Check a single provider's health and resolve its models.
   */
  private async checkProvider(provider: ModelProvider): Promise<void> {
    const directCred = hasCredential(provider);
    const source = credentialSource(provider);
    const servedBy = resolveServedBy(provider);

    // SEC-5.9: hasCredential only checks the provider's OWN direct key.
    // But a provider can still be routable via OpenRouter (altEnvKeys).
    // credentialSource returns the actual env var granting access
    // (direct or alt). If neither exists, the provider is truly no-key.
    const hasAnyAccess = directCred || source !== null;

    // No credential at all (neither direct nor via OpenRouter) → no-key
    if (!hasAnyAccess) {
      this.statuses.set(provider.id, {
        provider,
        health: "no-key",
        hasCredential: false,
        servedBy: provider.id,
        models: [],
        latencyMs: null,
        lastChecked: Date.now(),
        error: null,
      });
      return;
    }

    // Has credential — check health if URL available
    let health: ProviderHealth = "unverified"; // Default: routable but not proven
    let latencyMs: number | null = null;
    let error: string | null = null;

    if (provider.healthUrl) {
      try {
        const start = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const headers: Record<string, string> = {};
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
          health = "ready"; // Proven
        } else if (response.status === 429) {
          health = "rate-limited";
          error = "Rate limited (429)";
        } else {
          health = "down";
          error = `HTTP ${response.status}`;
        }
      } catch (e) {
        if (provider.credentialType === "local") {
          health = "down";
          error = "Local server not running";
        } else {
          // Network error — provider might still work for API calls
          // but health was NOT proven. Mark as UNVERIFIED, not READY.
          health = "unverified";
          error = e instanceof Error ? e.message : String(e);
        }
        latencyMs = null;
      }
    }

    // Discover models for this provider from the catalog
    // Models are available if health is ready OR unverified (routable)
    // But `proven` is only true if health is ready
    const models: DiscoveredModel[] = this.catalog
      .filter((choice) => choice.provider.toLowerCase() === provider.label.toLowerCase())
      .map((choice) => ({
        choice,
        available: health === "ready" || health === "unverified",
        unavailableReason: health !== "ready" && health !== "unverified"
          ? this.healthToReason(health)
          : undefined,
        servedBy,
        proven: health === "ready",
      }));

    this.statuses.set(provider.id, {
      provider,
      health,
      // SEC-5.9: hasCredential reflects whether THIS provider has its own
      // direct key. servedBy tracks who actually serves the request.
      hasCredential: directCred,
      servedBy,
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
   * Get all available (routable) models across all providers.
   * Includes models from READY and UNVERIFIED providers.
   */
  getAvailableModels(): ModelChoice[] {
    const result: ModelChoice[] = [];
    for (const status of this.statuses.values()) {
      if (status.health === "ready" || status.health === "unverified") {
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
   * Get all PROVEN models (health check passed).
   * Stricter than getAvailableModels — excludes UNVERIFIED.
   */
  getProvenModels(): ModelChoice[] {
    const result: ModelChoice[] = [];
    for (const status of this.statuses.values()) {
      if (status.health === "ready") {
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
   * Check if a specific model is available (routable).
   */
  isModelAvailable(modelId: string): boolean {
    for (const status of this.statuses.values()) {
      const model = status.models.find((m) => m.choice.id === modelId);
      if (model) return model.available;
    }
    // Model not in any provider — check if OpenRouter has it
    const openrouter = this.statuses.get("openrouter");
    if (openrouter && (openrouter.health === "ready" || openrouter.health === "unverified")) {
      return true;
    }
    return false;
  }

  /**
   * Get the servedBy for a model (source truth).
   */
  getModelServedBy(modelId: string): string | null {
    for (const status of this.statuses.values()) {
      const model = status.models.find((m) => m.choice.id === modelId);
      if (model) return model.servedBy;
    }
    // If OpenRouter is available, it serves everything
    const openrouter = this.statuses.get("openrouter");
    if (openrouter && openrouter.hasCredential) return "openrouter";
    return null;
  }

  /**
   * Get the reason a model is unavailable.
   */
  getUnavailableReason(modelId: string): string | null {
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

    if (!foundInAnyProvider) {
      const choice = this.catalog.find((m) => m.id === modelId);
      if (choice) {
        const provider = PROVIDERS.find(
          (p) => p.label.toLowerCase() === choice.provider.toLowerCase(),
        );
        if (provider) {
          const status = this.statuses.get(provider.id);
          if (status && status.health === "no-key") {
            return `${provider.label} Credential required`;
          }
        }
        const openrouter = this.statuses.get("openrouter");
        if (openrouter && (openrouter.health === "ready" || openrouter.health === "unverified")) {
          return null;
        }
        return "No provider credential available";
      }
    }

    return null;
  }

  /**
   * Build a fallback chain for a model + capability.
   */
  getFallbackChain(
    primaryModelId: string,
    capability: string,
  ): ModelChoice[] {
    const available = this.getAvailableModels();
    const primary = available.find((m) => m.id === primaryModelId);

    const candidates = available
      .filter((m) => m.id !== primaryModelId)
      .filter((m) => m.strengths.includes(capability))
      .sort((a, b) => {
        if (b.power !== a.power) return b.power - a.power;
        return a.cost - b.cost;
      });

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

  /**
   * Get available model IDs (for passing to routeModel).
   */
  getAvailableModelIds(): string[] {
    return this.getAvailableModels().map((m) => m.id);
  }

  private healthToReason(health: ProviderHealth): string {
    switch (health) {
      case "no-key": return "Credential required";
      case "rate-limited": return "Rate limited — try again later";
      case "down": return "Provider is down";
      case "unverified": return "Health unverified";
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
  routingMode: "auto" | "fixed" | "budget" | "max";
  selectedModel: string | null;
  /** Per-capability overrides: { coding: "openai/gpt-5.6-codex", ... } */
  capabilityOverrides: Record<string, string>;
  lastUsedModel: string | null;
  showFallbackNotifications: boolean;
}

const DEFAULT_PREFS: ModelPrefs = {
  routingMode: "auto",
  selectedModel: null,
  capabilityOverrides: {},
  lastUsedModel: null,
  showFallbackNotifications: true,
};

export function loadModelPrefs(prefsPath: string): ModelPrefs {
  try {
    if (!existsSync(prefsPath)) return { ...DEFAULT_PREFS };
    const raw = readFileSync(prefsPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveModelPrefs(prefs: ModelPrefs, prefsPath: string): void {
  try {
    const dir = dirname(prefsPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(prefsPath, JSON.stringify(prefs, null, 2) + "\n", "utf-8");
  } catch {
    // Non-fatal
  }
}

export function getDefaultPrefsPath(): string {
  const littHome = process.env.LITT_HOME ?? join(homedir(), ".litt");
  return join(littHome, "model-prefs.json");
}

// ─── Fallback execution ────────────────────────────────────────────

/**
 * FallbackExecutor — tries models in order until one succeeds.
 */
export class FallbackExecutor {
  private registry: ProviderRegistry;
  private triedIds: string[] = [];
  private attempts: Array<{ modelId: string; reason: string }> = [];

  constructor(registry: ProviderRegistry) {
    this.registry = registry;
  }

  shouldFallback(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("429") || msg.includes("rate limit")) return true;
      if (msg.includes("500") || msg.includes("502") || msg.includes("503")) return true;
      if (msg.includes("network") || msg.includes("econnreset") || msg.includes("timeout")) return true;
      if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized")) return true;
    }
    return false;
  }

  nextFallback(failedModelId: string, capability: string): ModelChoice | null {
    this.triedIds.push(failedModelId);
    return this.registry.getNextFallback(failedModelId, capability, this.triedIds);
  }

  recordAttempt(modelId: string, reason: string): void {
    this.attempts.push({ modelId, reason });
  }

  reset(): void {
    this.triedIds = [];
    this.attempts = [];
  }

  getTried(): string[] {
    return [...this.triedIds];
  }

  getAttempts(): Array<{ modelId: string; reason: string }> {
    return [...this.attempts];
  }
}

// ─── Routing engine ────────────────────────────────────────────────

/**
 * The routing engine evaluates:
 *   Request → Intent → Privacy → Context → Credentials → Health → Override → Mode → Cost → Selected
 *
 * It produces a RoutingTelemetry record that can be displayed with /route explain.
 */
export class RoutingEngine {
  private registry: ProviderRegistry;
  private prefs: ModelPrefs;
  private catalog: ModelChoice[];

  constructor(registry: ProviderRegistry, prefs: ModelPrefs, catalog?: ModelChoice[]) {
    this.registry = registry;
    this.prefs = prefs;
    this.catalog = catalog ?? registry.getAvailableModels();
  }

  /**
   * Classify a request into a task type.
   */
  classifyTask(request: string): TaskType {
    const lower = request.toLowerCase();
    if (lower.includes("local") || lower.includes("offline") || lower.includes("private") || lower.includes("don't send")) return "local";
    if (lower.includes("image") || lower.includes("screenshot") || lower.includes("visual") || lower.includes("diagram")) return "vision";
    if (lower.includes("architect") || lower.includes("design") || lower.includes("complex") || lower.includes("reason") || lower.includes("analyze")) return "reasoning";
    if (isCodingTask(lower)) return "coding";
    if (lower.length < 50) return "fast";
    return "general";
  }

  /**
   * Estimate context size for a request.
   * In production, this would measure the actual prompt + repo context.
   */
  estimateContext(request: string): number {
    const lower = request.toLowerCase();
    // Rough estimate: 4 chars per token for the request itself
    const requestTokens = Math.ceil(request.length / 4);
    // Base overhead for system prompt + tools
    let base = 4_000;

    // Detect requests that imply large context usage
    if (lower.includes("entire repo") || lower.includes("entire repository") ||
        lower.includes("whole project") || lower.includes("all files") ||
        lower.includes("every file") || lower.includes("whole codebase")) {
      base = 50_000; // Large repo context
    }
    if (lower.includes("entire repository architecture") || lower.includes("redesign")) {
      base = 80_000; // Very large context
    }

    return requestTokens + base;
  }

  /**
   * Route a model for a request, producing full telemetry.
   */
  route(
    request: string,
    availableModelIds: string[] | null,
    selectedModel: string | null,
    routingMode: string,
  ): { choice: ModelChoice; telemetry: RoutingTelemetry } {
    const taskType = this.classifyTask(request);
    const requiredCaps = TASK_REQUIREMENTS[taskType] ?? [];
    const estimatedContext = this.estimateContext(request);
    const available = availableModelIds ?? this.registry.getAvailableModelIds();

    // Filter catalog to available models
    const allModels = this.catalog;
    const candidates = available.length > 0
      ? allModels.filter((m) => available.includes(m.id))
      : allModels;

    // Check per-task override BEFORE capability filtering — if the user
    // explicitly chose a model for this task type, respect it even if it
    // doesn't have every required capability. The user knows what they want.
    const overrideKey = taskType;
    const overrideModelId = this.prefs.capabilityOverrides[overrideKey];
    if (overrideModelId) {
      const overrideChoice = candidates.find((m) => m.id === overrideModelId);
      if (overrideChoice) {
        return {
          choice: overrideChoice,
          telemetry: this.buildTelemetry(request, taskType, routingMode, estimatedContext, requiredCaps, candidates.map(m => m.id), [], overrideChoice, available),
        };
      }
    }

    // Apply capability filter
    let filtered = candidates;
    const rejected: Array<{ modelId: string; reason: string }> = [];

    if (requiredCaps.length > 0) {
      filtered = candidates.filter((m) => {
        const hasAllCaps = requiredCaps.every((cap) => m.strengths.includes(cap));
        if (!hasAllCaps) {
          rejected.push({ modelId: m.id, reason: `Missing capability: ${requiredCaps.find(c => !m.strengths.includes(c))}` });
          return false;
        }
        return true;
      });
    }

    // Apply context filter — reject models with too-small context window
    if (estimatedContext > 0) {
      filtered = filtered.filter((m) => {
        const modelContextTokens = m.contextK * 1000;
        if (modelContextTokens < estimatedContext) {
          rejected.push({ modelId: m.id, reason: `Context too small (${m.contextK}K < ${Math.ceil(estimatedContext / 1000)}K)` });
          return false;
        }
        return true;
      });
    }

    // Apply routing mode
    let selected: ModelChoice | null = null;

    if (routingMode === "fixed" && selectedModel) {
      selected = filtered.find((m) => m.id === selectedModel) ?? null;
    }

    if (routingMode === "budget") {
      // Mathematical: cheapest capable + available + context-compatible
      selected = [...filtered].sort((a, b) => {
        const costA = getModelCost(a.id).inputPer1M + getModelCost(a.id).outputPer1M;
        const costB = getModelCost(b.id).inputPer1M + getModelCost(b.id).outputPer1M;
        return costA - costB;
      })[0] ?? null;
    }

    if (routingMode === "max") {
      selected = [...filtered].sort((a, b) => b.power - a.power)[0] ?? null;
    }

    // Auto: best match by task type
    if (!selected) {
      selected = this.autoSelect(taskType, filtered, request, selectedModel);
    }

    // Fallback: if nothing matched, use first available
    if (!selected) {
      selected = filtered[0] ?? candidates[0] ?? this.catalog[0];
    }

    return {
      choice: selected,
      telemetry: this.buildTelemetry(request, taskType, routingMode, estimatedContext, requiredCaps, candidates.map(m => m.id), rejected, selected, available),
    };
  }

  private autoSelect(
    taskType: TaskType,
    filtered: ModelChoice[],
    request: string,
    selectedModel: string | null,
  ): ModelChoice | null {
    // Respect explicit selection if available
    if (selectedModel && selectedModel !== "openrouter/auto") {
      const found = filtered.find((m) => m.id === selectedModel);
      if (found) return found;
    }

    // Task-specific preferences
    switch (taskType) {
      case "reasoning":
        return filtered.find((m) => m.id === "openai/gpt-5.6-sol") ??
               filtered.find((m) => m.strengths.includes("reasoning")) ??
               filtered[0] ?? null;
      case "coding":
        return filtered.find((m) => m.id === "qwen/qwen3-coder") ??
               filtered.find((m) => m.id === "anthropic/claude-sonnet-5") ??
               filtered.find((m) => m.strengths.includes("coding")) ??
               filtered[0] ?? null;
      case "vision":
        return filtered.find((m) => m.id === "google/gemini-2.5-pro") ??
               filtered.find((m) => m.strengths.includes("vision")) ??
               filtered[0] ?? null;
      case "local":
        return filtered.find((m) => m.strengths.includes("local")) ??
               filtered[0] ?? null;
      case "fast":
        return filtered.find((m) => m.id === "google/gemini-2.5-flash") ??
               filtered.find((m) => m.strengths.includes("fast")) ??
               filtered[0] ?? null;
      default:
        return filtered.find((m) => m.id === "anthropic/claude-sonnet-5") ??
               filtered[0] ?? null;
    }
  }

  private buildTelemetry(
    request: string,
    taskType: TaskType,
    routingMode: string,
    estimatedContext: number,
    requiredCaps: Capability[],
    candidateIds: string[],
    rejected: Array<{ modelId: string; reason: string }>,
    selected: ModelChoice,
    availableModelIds: string[],
  ): RoutingTelemetry {
    const servedBy = this.registry.getModelServedBy(selected.id) ?? "unknown";
    const estimatedCost = estimateRunCost(selected.id, estimatedContext, 1000);

    // Find credential source
    const provider = PROVIDERS.find((p) => p.label.toLowerCase() === selected.provider.toLowerCase());
    const credSource = provider ? credentialSource(provider) ?? "unknown" : "unknown";

    return {
      request,
      taskType,
      routingMode,
      estimatedContextTokens: estimatedContext,
      requiredCapabilities: requiredCaps,
      candidates: candidateIds,
      rejected,
      selectedModel: selected.id,
      servedBy,
      credentialSource: credSource,
      fallbackAttempts: [],
      estimatedCost,
      actualCost: null,
      timestamp: Date.now(),
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function isCodingTask(lower: string): boolean {
  return lower.includes("code") || lower.includes("function") ||
    lower.includes("bug") || lower.includes("fix") || lower.includes("test") ||
    lower.includes("build") || lower.includes("implement") || lower.includes("edit") ||
    lower.includes("write") || lower.includes("refactor") || lower.includes("file");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Telemetry store ───────────────────────────────────────────────

/**
 * In-memory telemetry store for /route explain.
 * In production, this could be persisted to disk.
 */
export class TelemetryStore {
  private records: RoutingTelemetry[] = [];
  private maxRecords: number = 50;

  record(telemetry: RoutingTelemetry): void {
    this.records.push(telemetry);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
  }

  getLast(): RoutingTelemetry | null {
    return this.records[this.records.length - 1] ?? null;
  }

  getAll(): RoutingTelemetry[] {
    return [...this.records];
  }

  clear(): void {
    this.records = [];
  }
}
