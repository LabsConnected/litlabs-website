/**
 * Provider discovery + health verification.
 *
 * This module performs REAL model discovery against provider /models endpoints
 * (OpenRouter, OpenAI, Google, Ollama, LM Studio) and REAL health checks,
 * then merges the results into the ModelRegistry.
 *
 * Design rules:
 *   - Never reads process.env. The consumer injects an EnvAccessor.
 *   - Network access is isolated behind a fetcher (testable with fixtures).
 *   - Health is cached with a TTL — opening /models shows last-known instantly.
 *   - Discovery flips catalog models from "unverified" → "online" when the
 *     exact openRouterModelId / providerModelId is found in the live catalog.
 *   - A model present in LiTT's catalog but NOT in the live provider catalog
 *     is marked "offline" with a reason — it is NOT shown as available.
 *
 * Health tiers (spec section 8):
 *   CONFIGURED       — env key exists, no check yet
 *   AUTHENTICATED    — health endpoint returned 200
 *   DISCOVERY OK     — /models returned a parseable model list
 *   INFERENCE VERIFIED — a real completion succeeded (optional, expensive)
 *   DEGRADED         — rate limited or slow
 *   DOWN             — health check failed / network error / auth error
 */

import { getProvider, type ProviderDefinition } from "./providers.js";
import type { CredentialResolver, ModelDefinition, ProviderId } from "./types.js";

// ─── Env accessor (injected, never reads process.env) ──────────────

export interface EnvAccessor {
  get(key: string): string | undefined;
}

/**
 * Build an EnvAccessor from a record (tests) or process.env (runtime).
 */
export function envAccessorFromMap(map: Record<string, string | undefined>): EnvAccessor {
  return {
    get: (key) => map[key],
  };
}

export function envAccessorFromProcess(): EnvAccessor {
  return {
    get: (key) => process.env[key],
  };
}

// ─── Fetcher (injectable network) ──────────────────────────────────

export interface FetchResponse {
  ok: boolean;
  status: number;
  /** Parsed JSON body, or null if not JSON / parse failed. */
  json: unknown | null;
  /** Latency in ms. */
  latencyMs: number;
}

export interface Fetcher {
  /**
   * Fetch a URL with an optional Authorization header and timeout.
   * Implementations must not throw on network errors — return a DOWN response.
   */
  fetch(url: string, options: { headers?: Record<string, string>; timeoutMs?: number }): Promise<FetchResponse>;
}

/**
 * Default production fetcher using global fetch.
 */
export function createDefaultFetcher(): Fetcher {
  return {
    async fetch(url, options) {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
        const headers: Record<string, string> = { ...(options.headers ?? {}) };
        const res = await fetch(url, { headers, signal: controller.signal });
        clearTimeout(timeout);
        const latencyMs = Date.now() - start;
        let json: unknown | null = null;
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          try { json = await res.json(); } catch { json = null; }
        }
        return { ok: res.ok, status: res.status, json, latencyMs };
      } catch {
        return { ok: false, status: 0, json: null, latencyMs: Date.now() - start };
      }
    },
  };
}

// ─── Health status ─────────────────────────────────────────────────

export type HealthTier =
  | "configured"      // key exists, no check
  | "authenticated"   // health endpoint 200
  | "discovery-ok"    // /models returned a model list
  | "inference-verified" // a real completion succeeded
  | "degraded"        // rate limited or slow
  | "down";           // check failed

export interface ProviderHealthResult {
  providerId: ProviderId;
  tier: HealthTier;
  /** True if a credential (direct or via OpenRouter) grants access. */
  hasCredential: boolean;
  /** Which provider actually serves requests (source truth). */
  servedBy: ProviderId;
  /** Latency of the health check in ms, or null if not checked. */
  latencyMs: number | null;
  /** Number of models discovered (0 if discovery not run / failed). */
  discoveredCount: number;
  /** Human-readable reason for the tier (for UI display). */
  reason: string;
  /** When this result was recorded (epoch ms). */
  checkedAt: number;
  /** Error message if tier is down/degraded. */
  error: string | null;
}

// ─── Discovery result ──────────────────────────────────────────────

/**
 * A raw model entry discovered from a provider /models endpoint.
 * This is normalized into a ModelDefinition by the discovery pipeline.
 */
export interface DiscoveredModelEntry {
  /** The model id as reported by the provider (e.g. "openai/gpt-5.6-luna"). */
  id: string;
  /** Optional display name. */
  name?: string;
  /** Optional context window in tokens. */
  contextLength?: number;
  /** Optional pricing (per 1M tokens). */
  pricing?: { prompt?: number; completion?: number };
}

export interface DiscoveryResult {
  providerId: ProviderId;
  /** Raw entries from the /models endpoint. */
  models: DiscoveredModelEntry[];
  /** Catalog model canonicalIds that were confirmed present. */
  confirmedCanonicalIds: string[];
  /** Catalog model canonicalIds that were NOT found (now offline). */
  missingCanonicalIds: string[];
}

// ─── Credential resolution (reused from providers.ts) ──────────────

import { createEnvCredentialResolver } from "./providers.js";

// ─── ProviderDiscoveryOrchestrator ─────────────────────────────────

/**
 * Holds cached health results with a TTL. Opening /models shows last-known
 * instantly; refresh() updates in the background.
 */
export class HealthCache {
  private results = new Map<ProviderId, ProviderHealthResult>();
  private ttlMs: number;
  private lastRefresh = 0;

  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs;
  }

  get(providerId: ProviderId): ProviderHealthResult | null {
    return this.results.get(providerId) ?? null;
  }

  set(result: ProviderHealthResult): void {
    this.results.set(result.providerId, result);
  }

  getAll(): ProviderHealthResult[] {
    return [...this.results.values()];
  }

  isFresh(): boolean {
    return Date.now() - this.lastRefresh < this.ttlMs;
  }

  markRefreshed(): void {
    this.lastRefresh = Date.now();
  }

  clear(): void {
    this.results.clear();
    this.lastRefresh = 0;
  }
}

// ─── The orchestrator ──────────────────────────────────────────────

export interface DiscoveryOptions {
  /** Which providers to check. Defaults to all known providers. */
  providers?: ProviderId[];
  /** Per-request timeout. Default 5000ms. */
  timeoutMs?: number;
  /** Skip discovery (only health check). Default false. */
  skipDiscovery?: boolean;
}

export interface DiscoveryReport {
  health: ProviderHealthResult[];
  discovery: DiscoveryResult[];
  /** Total models confirmed across all providers. */
  totalConfirmed: number;
  /** Catalog canonicalIds now confirmed available. */
  confirmedCanonicalIds: string[];
}

/**
 * ProviderDiscoveryOrchestrator — runs real discovery + health checks,
 * merges results into a ModelRegistry, and caches health.
 *
 * The registry is mutated: confirmed models flip to availability "online"
 * + verified true; missing models flip to "offline".
 */
export class ProviderDiscoveryOrchestrator {
  private env: EnvAccessor;
  private fetcher: Fetcher;
  private cache: HealthCache;
  private resolver: CredentialResolver;

  constructor(
    env: EnvAccessor,
    fetcher: Fetcher = createDefaultFetcher(),
    cache: HealthCache = new HealthCache(),
  ) {
    this.env = env;
    this.fetcher = fetcher;
    this.cache = cache;
    this.resolver = createEnvCredentialResolver(env.get);
  }

  get healthCache(): HealthCache {
    return this.cache;
  }

  get credentialResolver(): CredentialResolver {
    return this.resolver;
  }

  /**
   * Run discovery + health for the given (or all) providers.
   * Mutates the registry: flips availability + verification.
   * Returns a report for UI display.
   */
  async refresh(
    registry: import("./registry.js").ModelRegistry,
    options: DiscoveryOptions = {},
  ): Promise<DiscoveryReport> {
    const targetProviders = options.providers ?? allProviderIds();
    const timeoutMs = options.timeoutMs ?? 5000;
    const skipDiscovery = options.skipDiscovery ?? false;

    const healthResults: ProviderHealthResult[] = [];
    const discoveryResults: DiscoveryResult[] = [];

    // Run all provider checks in parallel
    const checks = targetProviders.map((pid) =>
      this.checkProvider(pid, registry, timeoutMs, skipDiscovery),
    );
    const settled = await Promise.allSettled(checks);

    for (const s of settled) {
      if (s.status === "fulfilled") {
        const { health, discovery } = s.value;
        healthResults.push(health);
        if (discovery) discoveryResults.push(discovery);
      }
    }

    this.cache.markRefreshed();

    const confirmedSet = new Set<string>();
    for (const d of discoveryResults) {
      for (const id of d.confirmedCanonicalIds) confirmedSet.add(id);
    }

    return {
      health: healthResults,
      discovery: discoveryResults,
      totalConfirmed: confirmedSet.size,
      confirmedCanonicalIds: [...confirmedSet],
    };
  }

  /**
   * Refresh in the background without blocking. Safe to call from UI.
   * No-op if cache is fresh.
   */
  refreshAsync(registry: import("./registry.js").ModelRegistry, options?: DiscoveryOptions): void {
    if (this.cache.isFresh()) return;
    this.refresh(registry, options).catch(() => {
      // Swallow — background refresh failures are non-fatal.
    });
  }

  // ─── Per-provider check ──────────────────────────────────────────

  private async checkProvider(
    providerId: ProviderId,
    registry: import("./registry.js").ModelRegistry,
    timeoutMs: number,
    skipDiscovery: boolean,
  ): Promise<{ health: ProviderHealthResult; discovery: DiscoveryResult | null }> {
    const def = getProvider(providerId);
    if (!def) {
      return {
        health: downResult(providerId, this.resolver, `Unknown provider ${providerId}`),
        discovery: null,
      };
    }

    const cred = this.resolver(providerId);
    if (!cred.hasCredential) {
      const health: ProviderHealthResult = {
        providerId,
        tier: "configured",
        hasCredential: false,
        servedBy: cred.servedBy,
        latencyMs: null,
        discoveredCount: 0,
        reason: "No credential",
        checkedAt: Date.now(),
        error: null,
      };
      this.cache.set(health);
      return { health, discovery: null };
    }

    // Local providers: check reachability via /models or /tags
    if (providerId === "ollama" || providerId === "lmstudio") {
      return this.checkLocalProvider(def, providerId, cred.servedBy, registry, timeoutMs, skipDiscovery);
    }

    // OpenRouter: discovery is the primary signal
    if (providerId === "openrouter") {
      return this.checkOpenRouter(def, cred.servedBy, registry, timeoutMs, skipDiscovery);
    }

    // Direct providers (OpenAI, Google, etc.): health check + optional discovery
    return this.checkDirectProvider(def, providerId, cred.servedBy, registry, timeoutMs, skipDiscovery);
  }

  // ─── OpenRouter ──────────────────────────────────────────────────

  private async checkOpenRouter(
    def: ProviderDefinition,
    servedBy: ProviderId,
    registry: import("./registry.js").ModelRegistry,
    timeoutMs: number,
    skipDiscovery: boolean,
  ): Promise<{ health: ProviderHealthResult; discovery: DiscoveryResult | null }> {
    const apiKey = this.env.get("OPENROUTER_API_KEY");
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    if (skipDiscovery || !def.modelsUrl) {
      const res = await this.fetcher.fetch(def.modelsUrl ?? "https://openrouter.ai/api/v1/models", { headers, timeoutMs });
      const health = healthFromResponse("openrouter", servedBy, res, "OpenRouter health check");
      this.cache.set(health);
      return { health, discovery: null };
    }

    const res = await this.fetcher.fetch(def.modelsUrl, { headers, timeoutMs });
    if (!res.ok || !res.json) {
      const health = healthFromResponse("openrouter", servedBy, res, "OpenRouter discovery failed");
      this.cache.set(health);
      return { health, discovery: null };
    }

    const entries = parseOpenRouterModels(res.json);
    const discovery = matchAgainstCatalog(registry, "openrouter", entries);
    applyDiscoveryToRegistry(registry, discovery);

    const health: ProviderHealthResult = {
      providerId: "openrouter",
      tier: "discovery-ok",
      hasCredential: true,
      servedBy,
      latencyMs: res.latencyMs,
      discoveredCount: entries.length,
      reason: `${entries.length} models discovered`,
      checkedAt: Date.now(),
      error: null,
    };
    this.cache.set(health);
    return { health, discovery };
  }

  // ─── Direct providers (OpenAI, Google, xAI, etc.) ────────────────

  private async checkDirectProvider(
    def: ProviderDefinition,
    providerId: ProviderId,
    servedBy: ProviderId,
    registry: import("./registry.js").ModelRegistry,
    timeoutMs: number,
    skipDiscovery: boolean,
  ): Promise<{ health: ProviderHealthResult; discovery: DiscoveryResult | null }> {
    const apiKey = this.env.get(def.envKey ?? "");
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    // If served by OpenRouter (no direct key), we don't double-check the
    // native provider — OpenRouter's discovery already covered its models.
    if (servedBy === "openrouter") {
      const health: ProviderHealthResult = {
        providerId,
        tier: "configured",
        hasCredential: true,
        servedBy,
        latencyMs: null,
        discoveredCount: 0,
        reason: `Served via OpenRouter`,
        checkedAt: Date.now(),
        error: null,
      };
      this.cache.set(health);
      return { health, discovery: null };
    }

    if (!def.modelsUrl) {
      // No discovery endpoint — just mark configured.
      const health: ProviderHealthResult = {
        providerId,
        tier: "configured",
        hasCredential: true,
        servedBy,
        latencyMs: null,
        discoveredCount: 0,
        reason: "Configured (no discovery endpoint)",
        checkedAt: Date.now(),
        error: null,
      };
      this.cache.set(health);
      return { health, discovery: null };
    }

    if (skipDiscovery) {
      const res = await this.fetcher.fetch(def.modelsUrl, { headers, timeoutMs });
      const health = healthFromResponse(providerId, servedBy, res, `${def.label} health check`);
      this.cache.set(health);
      return { health, discovery: null };
    }

    const res = await this.fetcher.fetch(def.modelsUrl, { headers, timeoutMs });
    if (!res.ok || !res.json) {
      const health = healthFromResponse(providerId, servedBy, res, `${def.label} discovery failed`);
      this.cache.set(health);
      return { health, discovery: null };
    }

    const entries = parseOpenAICompatibleModels(res.json, providerId);
    const discovery = matchAgainstCatalog(registry, providerId, entries);
    applyDiscoveryToRegistry(registry, discovery);

    const health: ProviderHealthResult = {
      providerId,
      tier: "discovery-ok",
      hasCredential: true,
      servedBy,
      latencyMs: res.latencyMs,
      discoveredCount: entries.length,
      reason: `${entries.length} models discovered`,
      checkedAt: Date.now(),
      error: null,
    };
    this.cache.set(health);
    return { health, discovery };
  }

  // ─── Local providers (Ollama, LM Studio) ────────────────────────

  private async checkLocalProvider(
    def: ProviderDefinition,
    providerId: ProviderId,
    servedBy: ProviderId,
    registry: import("./registry.js").ModelRegistry,
    timeoutMs: number,
    skipDiscovery: boolean,
  ): Promise<{ health: ProviderHealthResult; discovery: DiscoveryResult | null }> {
    if (!def.modelsUrl) {
      const health = downResult(providerId, this.resolver, "No local endpoint configured");
      this.cache.set(health);
      return { health, discovery: null };
    }

    const res = await this.fetcher.fetch(def.modelsUrl, { timeoutMs });
    if (!res.ok) {
      const health: ProviderHealthResult = {
        providerId,
        tier: "down",
        hasCredential: true,
        servedBy,
        latencyMs: res.latencyMs,
        discoveredCount: 0,
        reason: "Local server not running",
        checkedAt: Date.now(),
        error: res.status === 0 ? "Connection refused" : `HTTP ${res.status}`,
      };
      this.cache.set(health);
      // Mark local catalog models offline
      for (const m of registry.getByProvider(providerId)) {
        registry.markOffline(m.canonicalId);
      }
      return { health, discovery: null };
    }

    if (skipDiscovery || !res.json) {
      const health: ProviderHealthResult = {
        providerId,
        tier: "authenticated",
        hasCredential: true,
        servedBy,
        latencyMs: res.latencyMs,
        discoveredCount: 0,
        reason: "Local server reachable",
        checkedAt: Date.now(),
        error: null,
      };
      this.cache.set(health);
      return { health, discovery: null };
    }

    const entries = parseLocalModels(res.json, providerId);
    const discovery = matchAgainstCatalog(registry, providerId, entries);
    applyDiscoveryToRegistry(registry, discovery);

    const health: ProviderHealthResult = {
      providerId,
      tier: "discovery-ok",
      hasCredential: true,
      servedBy,
      latencyMs: res.latencyMs,
      discoveredCount: entries.length,
      reason: `${entries.length} local models discovered`,
      checkedAt: Date.now(),
      error: null,
    };
    this.cache.set(health);
    return { health, discovery };
  }
}

// ─── Parsers ───────────────────────────────────────────────────────

/**
 * Parse OpenRouter's /api/v1/models response.
 * Shape: { data: [{ id, name, context_length, pricing: { prompt, completion } }] }
 */
export function parseOpenRouterModels(body: unknown): DiscoveredModelEntry[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const entries: DiscoveredModelEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    const name = (item as { name?: unknown }).name;
    const contextLength = (item as { context_length?: unknown }).context_length;
    const pricing = (item as { pricing?: unknown }).pricing;
    entries.push({
      id,
      name: typeof name === "string" ? name : undefined,
      contextLength: typeof contextLength === "number" ? contextLength : undefined,
      pricing: pricing && typeof pricing === "object"
        ? {
            prompt: numOrUndef((pricing as { prompt?: unknown }).prompt),
            completion: numOrUndef((pricing as { completion?: unknown }).completion),
          }
        : undefined,
    });
  }
  return entries;
}

/**
 * Parse an OpenAI-compatible /v1/models response (OpenAI, LM Studio, Ollama OpenAI compat).
 * Shape: { data: [{ id }] }
 */
export function parseOpenAICompatibleModels(body: unknown, _providerId: ProviderId): DiscoveredModelEntry[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const entries: DiscoveredModelEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    entries.push({ id });
  }
  return entries;
}

/**
 * Parse Ollama's /api/tags response.
 * Shape: { models: [{ name, context_window_size? }] }
 */
export function parseLocalModels(body: unknown, _providerId: ProviderId): DiscoveredModelEntry[] {
  if (!body || typeof body !== "object") return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const entries: DiscoveredModelEntry[] = [];
  for (const item of models) {
    if (!item || typeof item !== "object") continue;
    const name = (item as { name?: unknown }).name;
    if (typeof name !== "string") continue;
    entries.push({ id: name, name });
  }
  return entries;
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" ? v : typeof v === "string" ? Number(v) || undefined : undefined;
}

// ─── Catalog matching ──────────────────────────────────────────────

/**
 * Match discovered entries against the registry's catalog.
 * A catalog model is "confirmed" if its openRouterModelId (for openrouter)
 * or providerModelId (for direct providers) appears in the discovered list.
 *
 * For OpenRouter (a meta-provider), ALL catalog models are candidates —
 * OpenRouter can serve models from any native provider. For direct
 * providers, only that provider's models are candidates.
 */
export function matchAgainstCatalog(
  registry: import("./registry.js").ModelRegistry,
  providerId: ProviderId,
  entries: DiscoveredModelEntry[],
): DiscoveryResult {
  const discoveredIds = new Set(entries.map((e) => e.id));
  const confirmed: string[] = [];
  const missing: string[] = [];

  // OpenRouter is a meta-provider: it can serve any catalog model.
  // Direct/local providers only match their own models.
  const candidates = providerId === "openrouter"
    ? registry.getAll()
    : registry.getByProvider(providerId);

  for (const model of candidates) {
    const candidateIds = candidateModelIdsFor(model, providerId);
    const isConfirmed = candidateIds.some((id) => discoveredIds.has(id));
    if (isConfirmed) {
      confirmed.push(model.canonicalId);
    } else {
      missing.push(model.canonicalId);
    }
  }

  return {
    providerId,
    models: entries,
    confirmedCanonicalIds: confirmed,
    missingCanonicalIds: missing,
  };
}

/**
 * The ids to look up for a model, depending on which provider is doing discovery.
 * For OpenRouter discovery, match on openRouterModelId.
 * For direct provider discovery, match on providerModelId.
 */
function candidateModelIdsFor(model: ModelDefinition, discoveringProvider: ProviderId): string[] {
  const ids: string[] = [];
  if (discoveringProvider === "openrouter") {
    if (model.openRouterModelId) ids.push(model.openRouterModelId);
  } else {
    if (model.providerModelId) ids.push(model.providerModelId);
    if (model.openRouterModelId) ids.push(model.openRouterModelId);
  }
  return ids;
}

/**
 * Apply a discovery result to the registry:
 *   - confirmed models → availability "online", verified true, source openrouter-catalog/provider-catalog
 *   - missing models   → availability "offline"
 */
export function applyDiscoveryToRegistry(
  registry: import("./registry.js").ModelRegistry,
  discovery: DiscoveryResult,
): void {
  const source = discovery.providerId === "openrouter" ? "openrouter-catalog" : "provider-catalog";
  for (const canonicalId of discovery.confirmedCanonicalIds) {
    registry.markDiscovered(canonicalId, "online", source);
  }
  for (const canonicalId of discovery.missingCanonicalIds) {
    registry.markDiscovered(canonicalId, "offline", source);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function allProviderIds(): ProviderId[] {
  return PROVIDERS.map((p) => p.id);
}

// Import here to avoid circularity at module load
import { PROVIDERS } from "./providers.js";

function healthFromResponse(
  providerId: ProviderId,
  servedBy: ProviderId,
  res: FetchResponse,
  label: string,
): ProviderHealthResult {
  if (res.ok) {
    return {
      providerId,
      tier: "authenticated",
      hasCredential: true,
      servedBy,
      latencyMs: res.latencyMs,
      discoveredCount: 0,
      reason: label,
      checkedAt: Date.now(),
      error: null,
    };
  }
  if (res.status === 429) {
    return {
      providerId,
      tier: "degraded",
      hasCredential: true,
      servedBy,
      latencyMs: res.latencyMs,
      discoveredCount: 0,
      reason: "Rate limited",
      checkedAt: Date.now(),
      error: "429 Too Many Requests",
    };
  }
  return {
    providerId,
    tier: "down",
    hasCredential: true,
    servedBy,
    latencyMs: res.latencyMs,
    discoveredCount: 0,
    reason: label,
    checkedAt: Date.now(),
    error: res.status === 0 ? "Network error" : `HTTP ${res.status}`,
  };
}

function downResult(providerId: ProviderId, resolver: CredentialResolver, reason: string): ProviderHealthResult {
  const cred = resolver(providerId);
  return {
    providerId,
    tier: "down",
    hasCredential: cred.hasCredential,
    servedBy: cred.servedBy,
    latencyMs: null,
    discoveredCount: 0,
    reason,
    checkedAt: Date.now(),
    error: reason,
  };
}
