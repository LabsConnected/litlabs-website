/**
 * Growth Engine — provider registry.
 *
 * Maps provider IDs to provider instances. In Phase 1a, all providers
 * are in manual mode. Mirrors the pattern in
 * src/lib/connectors/provider-registry.ts.
 */

import "server-only";

import type { GrowthProvider, GrowthProviderId } from "./types";
import { isGrowthProviderId } from "./types";
import { XProvider } from "./providers/x-provider";
import { RedditProvider } from "./providers/reddit-provider";
import { HackernewsProvider } from "./providers/hackernews-provider";
import { ProductHuntProvider } from "./providers/producthunt-provider";

export const GROWTH_PROVIDERS: Record<GrowthProviderId, GrowthProvider> = {
  x: XProvider,
  reddit: RedditProvider,
  hackernews: HackernewsProvider,
  producthunt: ProductHuntProvider,
};

/**
 * Get a provider by ID. Returns null if the ID is not a known provider.
 */
export function getProvider(id: string): GrowthProvider | null {
  if (!isGrowthProviderId(id)) return null;
  return GROWTH_PROVIDERS[id];
}

/**
 * List all registered provider IDs.
 */
export function listProviderIds(): GrowthProviderId[] {
  return Object.keys(GROWTH_PROVIDERS) as GrowthProviderId[];
}

/**
 * List all providers with their label + mode (for display / tool summaries).
 */
export function listProviders(): Array<{
  id: GrowthProviderId;
  label: string;
  mode: "manual" | "api";
}> {
  return Object.values(GROWTH_PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    mode: p.mode,
  }));
}
