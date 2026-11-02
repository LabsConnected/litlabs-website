import type { ProviderHealth, SelectedModel } from "../stores/useStudioModelStore";

/**
 * Resolve the truthful health for the selected model.
 *
 * LiTT-routed models (provider "LiTT" — LiTT Auto and the litt-alias family)
 * traverse the full fallback chain server-side, ending in the local Ollama
 * tail (llm.ts withOllamaTail). Their truth is the chain roll-up keyed
 * "Auto" — never the preferred apiProvider alone, which would read
 * "unavailable" while a fallback route (local or another cloud) still
 * serves the run.
 *
 * Explicit provider picks (incl. `ollama/<tag>`) resolve to that provider's
 * own health — a pin is honored or it isn't, no fallback rescues it.
 *
 * Returns undefined while health is unverified — callers render "checking",
 * never "unavailable".
 */
export function resolveSelectedModelHealth(
  model: Pick<SelectedModel, "provider" | "apiProvider" | "category">,
  providerHealth: Record<string, ProviderHealth>,
): ProviderHealth | undefined {
  const autoRouted =
    model.provider === "LiTT" || model.category === "auto" || model.category === "litt-alias";
  if (autoRouted) {
    return (
      providerHealth["Auto"] ?? providerHealth[model.apiProvider ?? ""] ?? providerHealth[model.provider]
    );
  }
  return providerHealth[model.provider] ?? providerHealth[model.apiProvider ?? ""];
}
