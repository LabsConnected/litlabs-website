/**
 * Centralized feature flags for LiTTree v1.
 *
 * Flags are resolved from server-side env vars (for production control) with
 * safe defaults. The browser cannot override these — they are read-only.
 *
 * For the official v1 release, unfinished functionality is disabled here so
 * it does not appear in navigation, API routes, or UI surfaces.
 */

export type FeatureFlag =
  | "autonomousAgents"
  | "individualAgentPurchases"
  | "retroGameRuntime"
  | "hireServices"
  | "experimentalMediaProviders"
  | "communitySocial"
  | "founderCheckout"
  | "marketplaceAgentInstall"
  | "voiceMode"
  | "canvasTool"
  | "terminalRuntime";

export interface FeatureFlagDefinition {
  flag: FeatureFlag;
  description: string;
  enabled: boolean;
  /** If disabled, the UI should show "Coming soon" or hide the feature entirely */
  hideFromNav: boolean;
}

/**
 * v1 Launch Surface — features that are verified and ready.
 *
 * Everything listed as `enabled: false` is either:
 * - Unverified (not passed acceptance testing)
 * - Conflicted (pricing/duration not finalized)
 * - Experimental (not production-hardened)
 *
 * These are retained in code but hidden from navigation and rejected by
 * API routes until they pass the official release gates.
 */
export const FEATURE_FLAGS: Record<FeatureFlag, FeatureFlagDefinition> = {
  // ── ENABLED for v1 ──
  voiceMode: {
    flag: "voiceMode",
    description: "Voice mode for LiTT/Spark chat",
    enabled: true,
    hideFromNav: false,
  },
  canvasTool: {
    flag: "canvasTool",
    description: "Canvas tool for visual building",
    enabled: true,
    hideFromNav: false,
  },
  terminalRuntime: {
    flag: "terminalRuntime",
    description: "Terminal runtime for Pro Builder plan",
    enabled: true,
    hideFromNav: false,
  },

  // ── DISABLED for v1 — unfinished or unverified ──
  autonomousAgents: {
    flag: "autonomousAgents",
    description: "Autonomous background agent execution",
    enabled: false,
    hideFromNav: true,
  },
  individualAgentPurchases: {
    flag: "individualAgentPurchases",
    description: "Per-agent marketplace purchases (separate from plan-tier access)",
    enabled: false,
    hideFromNav: true,
  },
  retroGameRuntime: {
    flag: "retroGameRuntime",
    description:
      "Retro game runtime and emulator — not part of the public V1 product. " +
      "The implementation is retained (see tests/games-restoration.test.ts, " +
      "which still asserts the route files and libraries exist); while this " +
      "is disabled the /games routes return 404 and navigation hides them.",
    enabled: false,
    hideFromNav: true,
  },
  hireServices: {
    flag: "hireServices",
    description:
      "Productized agency services on /hire (Launch Sprint, Automation " +
      "Setup, Brand Pack). Not the V1 self-serve product: the offers carry " +
      "fixed prices, delivery timelines and revision promises that LiTT " +
      "cannot fulfil automatically. While disabled /hire redirects to " +
      "/studio; the implementation and the lead-capture API are retained.",
    enabled: false,
    hideFromNav: true,
  },
  experimentalMediaProviders: {
    flag: "experimentalMediaProviders",
    description: "Experimental media providers (SkyBox, HuggingFace, etc.)",
    enabled: false,
    hideFromNav: true,
  },
  communitySocial: {
    flag: "communitySocial",
    description: "Community and social features (Discover feed)",
    enabled: true,
    hideFromNav: false,
  },
  founderCheckout: {
    flag: "founderCheckout",
    description: "Founding Member checkout — disabled until approved $149 Stripe Price ID is configured",
    enabled: false,
    hideFromNav: false, // Visible as "Coming soon" on pricing page
  },
  marketplaceAgentInstall: {
    flag: "marketplaceAgentInstall",
    description: "Individual skill install from marketplace (delegated workers, not separate primary agents)",
    enabled: false,
    hideFromNav: true,
  },
};

/**
 * Check if a feature flag is enabled.
 * Server-side use only — do not expose to client unless through a safe API.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag]?.enabled ?? false;
}

/**
 * Get all enabled feature flags.
 */
export function getEnabledFeatures(): FeatureFlag[] {
  return (Object.values(FEATURE_FLAGS) as FeatureFlagDefinition[])
    .filter((f) => f.enabled)
    .map((f) => f.flag);
}

/**
 * Get all disabled feature flags (for debugging/audit).
 */
export function getDisabledFeatures(): FeatureFlagDefinition[] {
  return (Object.values(FEATURE_FLAGS) as FeatureFlagDefinition[]).filter((f) => !f.enabled);
}
