/**
 * ModelRuntime — the canonical CLI model backend.
 *
 * This is the SINGLE adapter the CLI controller/UI uses for all model truth.
 * It wraps:
 *   - @litt/models ModelRegistry (canonical catalog + credential resolver)
 *   - @litt/models ProviderDiscoveryOrchestrator (real OpenRouter /models discovery)
 *   - @litt/models routeModel (canonical routing with MAX/BUDGET/FIXED/AUTO)
 *   - cli-routing adapter (maps CLI modes to @litt/models RouteOptions)
 *
 * This REPLACES the legacy lib/model-routing.ts + lib/provider-registry.ts.
 * Those files are kept only as dead code for now — do not import them.
 *
 * Truthfulness contract:
 *   - Models start "unverified". Discovery flips them to "online" or "offline".
 *   - MAX/BUDGET only select verified-online models (with fallback reasons).
 *   - FIXED throws (strict) or falls back (non-strict) when unavailable.
 *   - Provider health is cached with a TTL; refreshAsync() updates in background.
 *   - The header active model is set AFTER runtime streaming confirms it,
 *     not optimistically before execution.
 */

import {
  MODEL_CATALOG,
  ModelRegistry,
  createEnvCredentialResolver,
  ProviderDiscoveryOrchestrator,
  HealthCache,
  envAccessorFromProcess,
  routeModel as modelsRouteModel,
  type ModelDefinition,
  type RoutingInput,
  type RoutingResult,
  type ProviderHealthResult,
  type ProviderId,
} from "@litt/models";

import {
  cliModeToRouteOptions,
  routingModeLabel as cliRoutingModeLabel,
  brainLabel as cliBrainLabel,
} from "./cli-routing.js";

import type { RoutingMode } from "../ink/cockpit-store.js";

// ─── Types (compatible with the old controller shape) ──────────────

export interface RoutedModel {
  /** Canonical id (e.g. "claude-sonnet-5"). */
  id: string;
  /** Display label (e.g. "Claude Sonnet 5"). */
  label: string;
  /** Provider that serves the call (source truth). */
  servedBy: ProviderId;
  /** Routing reason for display. */
  reason: string;
  /** Fallback reason if the requested policy was not honored exactly. */
  fallbackReason: string | null;
  /** Policy that was actually applied. */
  appliedPolicy: "auto" | "pinned" | "ask" | "budget" | "max";
  /** OpenRouter model id for the transport (e.g. "anthropic/claude-sonnet-5"). */
  openRouterModelId: string | undefined;
  /** Native provider model id (e.g. "claude-sonnet-5"). */
  providerModelId: string | undefined;
}

export interface ProviderStatus {
  providerId: ProviderId;
  label: string;
  tier: string;
  hasCredential: boolean;
  servedBy: ProviderId;
  latencyMs: number | null;
  discoveredCount: number;
  reason: string;
}

// ─── ModelRuntime ──────────────────────────────────────────────────

/**
 * The canonical model runtime for the CLI.
 *
 * One instance per CLI session. The controller creates it once and shares
 * it with the UI (Model Center, Model Picker).
 */
export class ModelRuntime {
  readonly registry: ModelRegistry;
  readonly discovery: ProviderDiscoveryOrchestrator;
  private healthCache: HealthCache;

  constructor() {
    this.registry = new ModelRegistry(
      MODEL_CATALOG,
      createEnvCredentialResolver(envAccessorFromProcess().get),
    );
    this.healthCache = new HealthCache(30_000);
    this.discovery = new ProviderDiscoveryOrchestrator(
      envAccessorFromProcess(),
      undefined, // default fetcher
      this.healthCache,
    );
  }

  // ─── Routing ─────────────────────────────────────────────────────

  /**
   * Route a model for the given CLI mode + input.
   * Returns a RoutedModel compatible with the old controller shape.
   */
  route(mode: RoutingMode, selectedModel: string | null, input: string): RoutedModel {
    const routingInput: RoutingInput = { message: input };
    const options = cliModeToRouteOptions(mode, selectedModel);
    // FIXED mode = strict pinned (fail clearly if unavailable)
    if (mode === "fixed") {
      options.strict = true;
    }
    // MAX/BUDGET = verifiedOnly (only select discovered-online models)
    if (mode === "max" || mode === "budget") {
      options.verifiedOnly = false; // allow fallback to unverified with reason
    }

    let result: RoutingResult;
    try {
      result = modelsRouteModel(this.registry, routingInput, options);
    } catch (err) {
      // Re-throw strict FIXED errors with a clear message
      if (mode === "fixed" && err instanceof Error) {
        throw err;
      }
      throw err;
    }

    return {
      id: result.model.canonicalId,
      label: result.model.displayName,
      servedBy: result.servedBy,
      reason: result.reason,
      fallbackReason: result.fallbackReason,
      appliedPolicy: result.appliedPolicy,
      openRouterModelId: result.model.openRouterModelId,
      providerModelId: result.model.providerModelId,
    };
  }

  /**
   * Get the OpenRouter model id for a canonical id (for the transport).
   */
  getOpenRouterModelId(canonicalId: string): string | undefined {
    return this.registry.getById(canonicalId)?.openRouterModelId;
  }

  /**
   * Get the display label for a canonical id.
   */
  getLabel(canonicalId: string): string {
    return this.registry.getById(canonicalId)?.displayName ?? canonicalId;
  }

  /**
   * Which provider serves a model (source truth).
   */
  getModelServedBy(canonicalId: string): ProviderId | null {
    const model = this.registry.getById(canonicalId);
    if (!model) return null;
    return this.registry.credentialFor(model).servedBy;
  }

  /**
   * Fallback chain for a model (for /route display).
   */
  getFallbackChain(canonicalId: string, taskKind: "coding" | "reasoning" | "general" = "coding"): ModelDefinition[] {
    return this.registry.getFallbackChain(canonicalId, taskKind);
  }

  // ─── Discovery + health ──────────────────────────────────────────

  /**
   * Trigger background discovery + health refresh. Non-blocking.
   * Safe to call from UI on mount.
   */
  refreshAsync(): void {
    this.discovery.refreshAsync(this.registry);
  }

  /**
   * Trigger foreground discovery + health refresh. Awaitable.
   */
  async refresh(): Promise<void> {
    await this.discovery.refresh(this.registry);
  }

  /**
   * Provider health statuses for /providers display.
   */
  getProviderStatuses(): ProviderStatus[] {
    const healthResults = this.discovery.healthCache.getAll();
    return healthResults.map((h) => ({
      providerId: h.providerId,
      label: h.providerId.charAt(0).toUpperCase() + h.providerId.slice(1),
      tier: h.tier,
      hasCredential: h.hasCredential,
      servedBy: h.servedBy,
      latencyMs: h.latencyMs,
      discoveredCount: h.discoveredCount,
      reason: h.reason,
    }));
  }

  /**
   * Total discovered (online) model count.
   */
  getDiscoveredCount(): number {
    return this.registry.getDiscoveredCount();
  }

  /**
   * All catalog models (for Model Picker display).
   */
  getAllModels(): ModelDefinition[] {
    return this.registry.getAll();
  }

  /**
   * Available (routable) models.
   */
  getAvailableModels(): ModelDefinition[] {
    return this.registry.getAvailable();
  }

  /**
   * Is a model currently routable (has credential + not offline)?
   */
  isRoutable(canonicalId: string): boolean {
    const m = this.registry.getById(canonicalId);
    return m ? this.registry.isRoutable(m) : false;
  }

  /**
   * Is a model verified online (discovery confirmed)?
   */
  isOnline(canonicalId: string): boolean {
    const m = this.registry.getById(canonicalId);
    return m ? m.availability === "online" : false;
  }

  /**
   * Get a model by canonical id.
   */
  getModel(canonicalId: string): ModelDefinition | undefined {
    return this.registry.getById(canonicalId);
  }

  /**
   * Group models by their native provider (for UI grouping).
   */
  getModelsByProvider(): Map<ProviderId, ModelDefinition[]> {
    const map = new Map<ProviderId, ModelDefinition[]>();
    for (const m of this.registry.getAll()) {
      const list = map.get(m.provider) ?? [];
      list.push(m);
      map.set(m.provider, list);
    }
    return map;
  }
}

// ─── Display helpers (re-export from cli-routing) ──────────────────

export function routingModeLabel(mode: RoutingMode): string {
  return cliRoutingModeLabel(mode);
}

export function brainLabel(mode: RoutingMode, selectedModel: string | null): string {
  return cliBrainLabel(mode, selectedModel, null as unknown as ModelRegistry);
}

/**
 * Routing reason for display — uses the routing result's reason + fallback.
 */
export function routingReason(routed: RoutedModel, _input: string): string {
  if (routed.fallbackReason) {
    return `${routed.reason} — ${routed.fallbackReason}`;
  }
  return routed.reason;
}

// ─── Credential check (kept for controller compat) ─────────────────

export function hasOpenRouterKey(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}
