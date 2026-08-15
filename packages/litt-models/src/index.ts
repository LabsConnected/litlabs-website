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
