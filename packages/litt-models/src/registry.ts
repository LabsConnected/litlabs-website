/**
 * ModelRegistry — the real multi-model LiTT provider layer.
 *
 * This is what turns LiTT from a hardcoded model picker into a real multi-model
 * operating system. Instead of a stale const array, the registry:
 *
 *   1. Holds the canonical ModelDefinition catalog (verified V1 lineup).
 *   2. Filters by credential availability (don't route to Claude if no key).
 *   3. Reports source truth (who actually serves a model — direct vs OpenRouter).
 *   4. Supports dynamic discovery (merge models discovered from provider /models).
 *   5. Feeds the LiTT Auto router.
 *
 * MODEL TRUTH (same philosophy as VerificationGate):
 *   available ≠ configured ≠ active ≠ proven
 *     available  — provider has credentials and is routable
 *     configured — user/project selected this model
 *     active     — runtime actually executed a request with it
 *     proven     — a live call succeeded (availability flips to "online")
 *
 * The registry never reads process.env. The consumer injects a
 * CredentialResolver so the package stays pure, SSR-safe, and testable.
 */

import { MODEL_CATALOG, LITT_DEFAULTS } from "./catalog";
import type {
  Availability,
  CredentialInfo,
  CredentialResolver,
  LiTTTier,
  ModelDefinition,
  ProviderId,
  RoutingMode,
  VerificationSource,
} from "./types";

export class ModelRegistry {
  private models: Map<string, ModelDefinition> = new Map();
  private resolver: CredentialResolver;

  constructor(
    catalog: ModelDefinition[] = MODEL_CATALOG,
    resolver: CredentialResolver,
  ) {
    this.resolver = resolver;
    for (const m of catalog) this.models.set(m.canonicalId, m);
  }

  /** Replace the credential resolver (e.g. after a key is added at runtime). */
  setCredentialResolver(resolver: CredentialResolver): void {
    this.resolver = resolver;
  }

  /** Get a model by canonical id. */
  getById(id: string): ModelDefinition | undefined {
    return this.models.get(id);
  }

  /** All models in the registry (no filtering). */
  getAll(): ModelDefinition[] {
    return [...this.models.values()];
  }

  /** Models tagged littRecommended (top of the picker). */
  getRecommended(): ModelDefinition[] {
    return this.getAll().filter((m) => m.littRecommended);
  }

  /** Models for a given provider. */
  getByProvider(provider: ProviderId): ModelDefinition[] {
    return this.getAll().filter((m) => m.provider === provider);
  }

  /** Models for a curated LiTT tier. */
  getByTier(tier: LiTTTier): ModelDefinition[] {
    return this.getAll().filter((m) => m.littTier === tier);
  }

  /** Filter models by a single capability flag. */
  filterByCapability<K extends keyof ModelDefinition["capabilities"]>(
    cap: K,
  ): ModelDefinition[] {
    return this.getAll().filter((m) => m.capabilities[cap] === true);
  }

  /**
   * Credential info for a model's provider (source truth).
   */
  credentialFor(model: ModelDefinition): CredentialInfo {
    return this.resolver(model.provider);
  }

  /**
   * Models that are routable right now: have a credential AND are not
   * offline/deprecated. Availability "unverified" is still routable — the
   * failover chain tolerates a 404.
   */
  getAvailable(): ModelDefinition[] {
    return this.getAll().filter((m) => this.isRoutable(m));
  }

  /** Available models tagged littRecommended. */
  getAvailableRecommended(): ModelDefinition[] {
    return this.getAvailable().filter((m) => m.littRecommended);
  }

  /**
   * Is a model routable? Has credential + not offline/deprecated.
   * Free-priced models (pricing.unit === "free") are always routable —
   * they require no user credentials (the server holds the OpenRouter key).
   */
  isRoutable(model: ModelDefinition): boolean {
    if (model.availability === "offline" || model.availability === "deprecated") return false;
    if (model.pricing?.unit === "free") return true;
    return this.resolver(model.provider).hasCredential;
  }

  /**
   * Resolve which provider will actually serve a model (source truth).
   * If the model's native provider has a direct key, it serves directly.
   * Otherwise the credential resolver reports the meta-provider (e.g. openrouter).
   */
  servedBy(model: ModelDefinition): ProviderId {
    return this.resolver(model.provider).servedBy;
  }

  /**
   * The API id to use when dispatching a model, given who serves it.
   * If servedBy === the model's native provider, use providerModelId (if set).
   * If servedBy === openrouter, use openRouterModelId.
   */
  apiIdFor(model: ModelDefinition): string | undefined {
    const servedBy = this.servedBy(model);
    if (servedBy === model.provider) return model.providerModelId ?? model.openRouterModelId;
    if (servedBy === "openrouter") return model.openRouterModelId ?? model.providerModelId;
    // Served by an unexpected meta-provider — prefer openrouter id as the
    // generic OpenAI-compatible path, fall back to direct.
    return model.openRouterModelId ?? model.providerModelId;
  }

  /**
   * Mark a model proven (a live call succeeded). Flips availability to
   * "online". Called by the runtime after a successful dispatch.
   */
  markProven(id: string): void {
    const m = this.models.get(id);
    if (m && m.availability !== "online") {
      this.models.set(id, { ...m, availability: "online" });
    }
  }

  /**
   * Mark a model offline (e.g. repeated 404s / provider down).
   */
  markOffline(id: string): void {
    const m = this.models.get(id);
    if (m && m.availability !== "offline") {
      this.models.set(id, { ...m, availability: "offline" });
    }
  }

  /**
   * Apply a discovery result for a single model. Used by the discovery
   * orchestrator to flip availability + verification based on a live
   * provider /models response.
   *
   *   "online"  → availability online, verified true, source = the discovery source
   *   "offline" → availability offline (model not found in live catalog)
   *   "unverified" → reset to unverified (e.g. discovery skipped)
   *
   * Catalog metadata (capabilities, pricing, etc.) is NEVER overwritten —
   * only availability + verification fields change.
   */
  markDiscovered(id: string, availability: Availability, source: VerificationSource): void {
    const m = this.models.get(id);
    if (!m) return;
    const verified = availability === "online";
    this.models.set(id, {
      ...m,
      availability,
      verified,
      verifiedAt: verified ? new Date().toISOString() : null,
      source: verified ? source : (availability === "offline" ? m.source : "unverified"),
    });
  }

  /**
   * Count of models currently confirmed available (availability "online").
   */
  getDiscoveredCount(): number {
    let n = 0;
    for (const m of this.models.values()) {
      if (m.availability === "online") n++;
    }
    return n;
  }

  /**
   * Count of models per provider with availability "online".
   */
  getDiscoveredCountByProvider(provider: ProviderId): number {
    let n = 0;
    for (const m of this.models.values()) {
      if (m.provider === provider && m.availability === "online") n++;
    }
    return n;
  }

  /**
   * Merge models discovered from a provider's /models endpoint.
   * New ids are added; known ids are kept as-is (catalog metadata wins).
   * This is how LiTT picks up GPT-5.7 / Gemini 4 / Kimi K4 without a rewrite.
   */
  mergeDiscovered(discovered: ModelDefinition[]): void {
    for (const m of discovered) {
      if (!this.models.has(m.canonicalId)) {
        this.models.set(m.canonicalId, m);
      }
    }
  }

  /** The LiTT default model ids (spec section 24). */
  get defaults() {
    return LITT_DEFAULTS;
  }

  /**
   * Resolve the effective model id for a run given the routing mode.
   *   auto   → LiTT chooses (caller uses the router for the actual pick)
   *   pinned → the user's pinned id, if routable
   *   ask    → the supplied choice, if routable
   * Returns null if the chosen model is not routable (caller falls back to auto).
   */
  resolveForMode(
    mode: RoutingMode,
    pinnedModelId: string | null,
    askChoice: string | null,
  ): ModelDefinition | null {
    if (mode === "pinned" && pinnedModelId) {
      const m = this.getById(pinnedModelId);
      if (m && this.isRoutable(m)) return m;
    }
    if (mode === "ask" && askChoice) {
      const m = this.getById(askChoice);
      if (m && this.isRoutable(m)) return m;
    }
    return null;
  }

  // ─── Fallback chain ──────────────────────────────────────────────

  /**
   * Build a fallback chain for a primary model + task kind.
   * The primary is first (if routable), then other available models with
   * the relevant capability, sorted by intelligence (frontier first) then
   * by cost (cheaper first).
   *
   * This replaces the CLI's duplicate getFallbackChain. The registry owns
   * fallback selection because it has credential + availability truth.
   */
  getFallbackChain(
    primaryId: string,
    taskKind: string,
  ): ModelDefinition[] {
    const available = this.getAvailable();
    const primary = available.find((m) => m.canonicalId === primaryId);

    // Map task kind to a capability filter
    const capKey = taskKindToCapability(taskKind);

    const candidates = available
      .filter((m) => m.canonicalId !== primaryId)
      .filter((m) => !capKey || m.capabilities[capKey] || m.recommendedFor.includes(taskKind))
      .sort((a, b) => {
        // Frontier first, then balanced, then light
        const tierOrder = (m: ModelDefinition) =>
          m.intelligence === "frontier" ? 0 : m.intelligence === "balanced" ? 1 : 2;
        if (tierOrder(a) !== tierOrder(b)) return tierOrder(a) - tierOrder(b);
        // Then cheaper first
        const costA = a.pricing ? a.pricing.inputPer1M + a.pricing.outputPer1M : 999;
        const costB = b.pricing ? b.pricing.inputPer1M + b.pricing.outputPer1M : 999;
        return costA - costB;
      });

    const chain: ModelDefinition[] = [];
    if (primary) chain.push(primary);
    chain.push(...candidates);
    return chain;
  }

  /**
   * Get the next model to try after a failure, excluding already-tried ids.
   */
  getNextFallback(
    failedModelId: string,
    taskKind: string,
    triedIds: string[],
  ): ModelDefinition | null {
    const chain = this.getFallbackChain(failedModelId, taskKind);
    const next = chain.find((m) => !triedIds.includes(m.canonicalId));
    return next ?? null;
  }

  // ─── Cost estimation ─────────────────────────────────────────────

  /**
   * Estimate the cost of a run in USD.
   * Uses the model's pricing metadata. Returns 0 for local/free models.
   */
  estimateRunCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const model = this.getById(modelId);
    if (!model?.pricing) return 0;
    const input = (inputTokens / 1_000_000) * model.pricing.inputPer1M;
    const output = (outputTokens / 1_000_000) * model.pricing.outputPer1M;
    return input + output;
  }
}

// ─── Fallback error classification ─────────────────────────────────

/**
 * Determine whether an error should trigger a fallback to the next model.
 * Rate limits, server errors, network errors, and auth errors all trigger
 * fallback. Content errors (bad JSON, invalid response) do not — the model
 * worked, the output was just wrong.
 */
export function shouldFallback(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("429") || msg.includes("rate limit")) return true;
    if (msg.includes("500") || msg.includes("502") || msg.includes("503")) return true;
    if (msg.includes("network") || msg.includes("econnreset") || msg.includes("timeout")) return true;
    if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized")) return true;
  }
  return false;
}

/**
 * Map a task kind string to the capability key used for fallback filtering.
 */
function taskKindToCapability(taskKind: string): keyof ModelDefinition["capabilities"] | null {
  switch (taskKind) {
    case "coding": return "coding";
    case "reasoning": return "reasoning";
    case "vision": return "vision";
    case "agent": return "tools";
    case "large-context": return "longContext";
    case "fast": return null; // any model is fine for fast
    case "chat": return null;
    default: return null;
  }
}
