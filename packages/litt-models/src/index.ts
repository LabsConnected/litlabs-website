/**
 * @litt/models — LiTT Model Registry, catalog, and LiTT Auto routing.
 *
 * Pure TypeScript, shared by the web runtime and the CLI. No React/Next/
 * Clerk/Supabase. No process.env reads at module load — credential resolution
 * is injected by the consumer via createEnvCredentialResolver.
 */

export type {
  ProviderId,
  CredentialSource,
  ModelCapabilities,
  SpeedTier,
  IntelligenceTier,
  Availability,
  VerificationSource,
  ModelDomain,
  ModelPricing,
  LiTTTier,
  ModelDefinition,
  CredentialInfo,
  CredentialResolver,
  RoutingMode,
  TaskKind,
  RoutingInput,
  RoutingResult,
  RunModelPin,
} from "./types";

export {
  PROVIDERS,
  getProvider,
  createEnvCredentialResolver,
} from "./providers";
export type { ProviderDefinition } from "./providers";

export { MODEL_CATALOG, LITT_DEFAULTS } from "./catalog";

// ─── Ollama endpoint resolver (ONE canonical source of truth) ──────
export type { EnvGetter } from "./ollama-endpoint";
export {
  DEFAULT_OLLAMA_URL,
  OLLAMA_ENDPOINT_ENV_VARS,
  normalizeOllamaEndpoint,
  resolveOllamaEndpoint,
  resolveOllamaTagsUrl,
  resolveOllamaChatUrl,
  resolveOllamaOpenAiChatUrl,
  ollamaEndpointSource,
} from "./ollama-endpoint";

// ─── Multi-endpoint Ollama route probing (local → LAN → Tailscale) ─
export type {
  OllamaRouteTier,
  OllamaRouteCandidate,
  OllamaRouteAttempt,
  OllamaRouteResult,
  ProbeOllamaRouteOptions,
} from "./ollama-route";
export {
  OLLAMA_ROUTE_LABELS,
  REMOTE_LITT_LABEL,
  OLLAMA_ROUTE_ENV_VARS,
  resolveOllamaRouteCandidates,
  probeOllamaRoute,
} from "./ollama-route";

export { ModelRegistry, shouldFallback } from "./registry";

export {
  classifyTask,
  routeModel,
  routingModeLabel,
  brainLabel,
  cockpitStatusLine,
} from "./router";
export type { RouteOptions } from "./router";

export { RunPinStore } from "./run-pin";

// ─── Discovery + health verification ───────────────────────────────
export type {
  EnvAccessor,
  FetchResponse,
  Fetcher,
  HealthTier,
  ProviderHealthResult,
  DiscoveredModelEntry,
  DiscoveryResult,
  DiscoveryOptions,
  DiscoveryReport,
} from "./discovery";
export {
  envAccessorFromMap,
  envAccessorFromProcess,
  createDefaultFetcher,
  HealthCache,
  ProviderDiscoveryOrchestrator,
  parseOpenRouterModels,
  parseOpenAICompatibleModels,
  parseLocalModels,
  matchAgainstCatalog,
  applyDiscoveryToRegistry,
} from "./discovery";

// ─── Escalation + mission affinity ─────────────────────────────────
export type {
  FailureRecord,
  FailureKind,
  MissionAffinity,
  EscalationEvent,
  EscalationPolicy,
} from "./escalation";
export {
  classifyFailure,
  DEFAULT_ESCALATION_POLICY,
  EscalationTracker,
  intelligenceRank,
  isFallbackKind,
} from "./escalation";
