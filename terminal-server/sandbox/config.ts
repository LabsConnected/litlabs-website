/**
 * Sandbox provider configuration — Phase 1 factory (SANDBOX-PLAN.md §4),
 * Phase 2 production enablement.
 *
 * Selection rules, deliberately boring:
 *   - The E2B provider is constructed ONLY when BOTH hold:
 *       SANDBOX_PROVIDER === "e2b"  AND  E2B_API_KEY is non-empty.
 *     Anything else — unset vars, a typo'd provider name, a missing
 *     key — yields the DisabledSandboxProvider, so every deployment
 *     that has not explicitly opted in behaves byte-identically to
 *     Phase 0 (which is to say, exactly like production today).
 *   - Configuration NEVER implies verified isolation. Constructing the
 *     E2B provider only makes the canary *runnable*; the exec gate
 *     (exec-router.ts) additionally requires a fresh green canary, the
 *     owner allowlist, and a routing-enabled environment before a
 *     single command is routed. A config claim is not proof
 *     (invariant 2).
 *
 * Routing enablement (the gate's environment condition):
 *   - Phase 1 routed on staging only, as a cohort gate: the Railway
 *     staging service carries RAILWAY_ENVIRONMENT_NAME=staging;
 *     SANDBOX_STAGING=true is the explicit equivalent for non-Railway
 *     staging rigs.
 *   - Phase 2 (Larry's production unlock, 2026-11-14): production
 *     routes only when SANDBOX_PRODUCTION_ENABLED=true is set
 *     explicitly on the production service. This is a separate,
 *     deliberate switch from SANDBOX_PROVIDER/E2B_API_KEY so that
 *     configuring the provider (which also starts the canary) can
 *     never by itself open production execution — the cutover sets
 *     the provider vars first, verifies the canary boot line, and
 *     flips this switch last.
 *   `routingEnabled` is the single boolean the gate consults:
 *   staging OR productionEnabled.
 */

import { DisabledSandboxProvider } from "./disabled-provider";
import {
  DEFAULT_E2B_TEMPLATE_ID,
  E2bSandboxProvider,
  type E2bClient,
} from "./e2b-provider";
import type { SandboxProvider } from "./provider";

export const SANDBOX_PROVIDER_VAR = "SANDBOX_PROVIDER";
export const E2B_API_KEY_VAR = "E2B_API_KEY";
export const E2B_TEMPLATE_ID_VAR = "E2B_TEMPLATE_ID";
export const SANDBOX_STAGING_VAR = "SANDBOX_STAGING";
export const SANDBOX_PRODUCTION_ENABLED_VAR = "SANDBOX_PRODUCTION_ENABLED";

export interface SandboxRuntimeConfig {
  /** Which provider the factory will construct. */
  providerName: "disabled" | "e2b";
  /** E2B template the provider boots. Meaningful only for e2b. */
  templateId: string;
  /** True when this process is a staging deployment (Phase 1 cohort gate). */
  staging: boolean;
  /** True when production routing was explicitly enabled (Phase 2). */
  productionEnabled: boolean;
  /**
   * The gate's environment condition: staging (Phase 1) OR explicit
   * production enablement (Phase 2). Nothing else opens routing.
   */
  routingEnabled: boolean;
}

type EnvLike = Record<string, string | undefined>;

export function isSandboxStagingEnv(env: EnvLike): boolean {
  return env.RAILWAY_ENVIRONMENT_NAME === "staging" || env[SANDBOX_STAGING_VAR] === "true";
}

export function isSandboxProductionEnabledEnv(env: EnvLike): boolean {
  return env[SANDBOX_PRODUCTION_ENABLED_VAR] === "true";
}

export function resolveSandboxRuntimeConfig(env: EnvLike): SandboxRuntimeConfig {
  const wantsE2b = env[SANDBOX_PROVIDER_VAR] === "e2b";
  const hasKey = Boolean(env[E2B_API_KEY_VAR]);
  const staging = isSandboxStagingEnv(env);
  const productionEnabled = isSandboxProductionEnabledEnv(env);
  return {
    providerName: wantsE2b && hasKey ? "e2b" : "disabled",
    templateId: env[E2B_TEMPLATE_ID_VAR] || DEFAULT_E2B_TEMPLATE_ID,
    staging,
    productionEnabled,
    routingEnabled: staging || productionEnabled,
  };
}

export interface CreateSandboxProviderDeps {
  /** SDK adapter override (tests). */
  e2bClient?: E2bClient;
}

/**
 * Construct the provider for this process from the environment.
 * The E2B API key is read here and ONLY here, passed straight into
 * the provider constructor, and never logged or returned.
 */
export function createSandboxProvider(
  env: EnvLike,
  deps: CreateSandboxProviderDeps = {},
): SandboxProvider {
  const config = resolveSandboxRuntimeConfig(env);
  if (config.providerName !== "e2b") {
    return new DisabledSandboxProvider();
  }
  return new E2bSandboxProvider({
    apiKey: env[E2B_API_KEY_VAR] as string,
    templateId: config.templateId,
    client: deps.e2bClient,
  });
}
