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
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  gemini: "Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
  ollama: "Ollama (local)",
};

const PROVIDER_HEALTH_WORDS: Record<ProviderHealth, string> = {
  available: "Available",
  degraded: "Degraded",
  unavailable: "Unavailable",
  locked: "Not configured",
};

export interface ProviderHealthSummary {
  /** False until at least one provider's health has been recorded. */
  known: boolean;
  /** Providers usable right now ("available" or "degraded"). */
  availableCount: number;
  /** Providers with a recorded health — the "Auto" roll-up excluded. */
  totalCount: number;
  /** "Gemini: Available · Groq: Unavailable · …" — empty while unknown. */
  detail: string;
}

/**
 * Summarize the per-provider health map for display.
 *
 * The map is keyed by provider id (gemini, groq, openrouter, ollama) from
 * /api/llm/health, plus an "Auto" roll-up that re-states those same routes
 * as one chain verdict. "Auto" is a routing alias, NOT a provider —
 * counting it would double-count. Workspace subsystem capabilities
 * (auth, project, repository, runtime.sandbox) never appear in this map
 * and must never be presented as AI providers.
 */
export function summarizeProviderHealth(
  providerHealth: Record<string, ProviderHealth>,
): ProviderHealthSummary {
  const entries = Object.entries(providerHealth).filter(([key]) => key !== "Auto");
  if (entries.length === 0) {
    return { known: false, availableCount: 0, totalCount: 0, detail: "" };
  }
  const availableCount = entries.filter(
    ([, health]) => health === "available" || health === "degraded",
  ).length;
  const detail = entries
    .map(
      ([key, health]) =>
        `${PROVIDER_DISPLAY_NAMES[key] ?? key}: ${PROVIDER_HEALTH_WORDS[health]}`,
    )
    .join(" · ");
  return { known: true, availableCount, totalCount: entries.length, detail };
}

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
