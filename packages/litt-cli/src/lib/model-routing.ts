/**
 * Model routing — LiTT chooses the best model per task.
 *
 * Routing modes:
 *   auto   — LiTT analyzes the request and picks the best model
 *   fixed  — always use the user-selected model
 *   budget — prefer cheapest capable model
 *   max    — prefer strongest available model
 *
 * The user talks to LiTT, not "Claude" or "GPT."
 * Claude/GPT/Gemini/Qwen are interchangeable engines underneath LiTT.
 *
 * CREDENTIAL-AWARE ROUTING:
 *   routeModel() now accepts an optional list of available model IDs.
 *   If provided, it only routes to models in that list. Models whose
 *   provider isn't configured are never selected.
 *
 *   If no available list is provided, it falls back to the full catalog
 *   (for backward compatibility and tests).
 */

import type { RoutingMode } from "../ink/cockpit-store.js";
export type { RoutingMode };

export interface ModelChoice {
  id: string;
  label: string;
  provider: string;
  description: string;
  /** Tags for routing: what this model is good at */
  strengths: string[];
  /** Relative cost: 1=cheap, 5=expensive */
  cost: number;
  /** Relative power: 1=basic, 5=frontier */
  power: number;
  /** Context window in K tokens */
  contextK: number;
  /** Provider-native model ID (e.g. "gpt-5.6-sol", "claude-sonnet-5"). Separate from the OpenRouter slug in `id`. */
  providerModelId?: string;
  /** Whether the provider-native ID was verified against the official provider catalog. Unverified models are not selectable in production. */
  verified?: boolean;
  /** ISO date string when the model ID was last verified. */
  verifiedAt?: string;
  /** Source of verification. */
  source?: "provider-catalog" | "openrouter-catalog" | "unverified";
}

/**
 * The verified V1 model catalog.
 *
 * Every entry has been checked against the official provider catalog
 * (developers.openai.com, platform.claude.com, ai.google.dev, openrouter.ai).
 * Phantom or deprecated IDs are excluded. The `providerModelId` field stores
 * the provider-native ID separately from the OpenRouter slug in `id`.
 *
 * V1 scope: Core 7 cloud models + Local + Auto.
 * Additional providers (Grok, DeepSeek, Kimi, Mistral) deferred to V2
 * pending live OpenRouter /models slug verification.
 */
export const MODEL_CATALOG: ModelChoice[] = [
  {
    id: "openrouter/auto",
    label: "Auto — LiTT chooses",
    provider: "LiTT",
    description: "LiTT routes based on task type",
    strengths: ["auto", "routing"],
    cost: 2,
    power: 4,
    contextK: 200,
    providerModelId: "openrouter/auto",
    verified: true,
    verifiedAt: "2026-08-14",
    source: "openrouter-catalog",
  },
  {
    id: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    provider: "OpenAI",
    description: "Frontier reasoning + coding",
    strengths: ["coding", "reasoning", "tools", "structuredOutput"],
    cost: 4,
    power: 5,
    contextK: 200,
    providerModelId: "gpt-5.6-sol",
    verified: true,
    verifiedAt: "2026-08-14",
    source: "provider-catalog",
  },
  {
    id: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    provider: "OpenAI",
    description: "Balanced intelligence + cost",
    strengths: ["general", "reasoning", "tools", "fast"],
    cost: 3,
    power: 4,
    contextK: 200,
    providerModelId: "gpt-5.6-terra",
    verified: true,
    verifiedAt: "2026-08-14",
    source: "provider-catalog",
  },
  {
    id: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    provider: "OpenAI",
    description: "Cost-sensitive high-volume",
    strengths: ["fast", "general", "tools"],
    cost: 2,
    power: 3,
    contextK: 200,
    providerModelId: "gpt-5.6-luna",
    verified: true,
    verifiedAt: "2026-08-14",
    source: "provider-catalog",
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "Anthropic",
    description: "Fast + strong coding + reasoning",
    strengths: ["coding", "fast", "general", "reasoning", "tools"],
    cost: 3,
    power: 4,
    contextK: 200,
    providerModelId: "claude-sonnet-5",
    verified: true,
    verifiedAt: "2026-08-14",
    source: "provider-catalog",
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "Google",
    description: "Large-context multimodal",
    strengths: ["multimodal", "large-context", "vision", "reasoning"],
    cost: 3,
    power: 4,
    contextK: 1000,
    providerModelId: "gemini-2.5-pro",
    verified: true,
    verifiedAt: "2026-08-14",
    source: "provider-catalog",
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "Google",
    description: "Fast multimodal",
    strengths: ["fast", "vision", "multimodal"],
    cost: 1,
    power: 3,
    contextK: 1000,
    providerModelId: "gemini-2.5-flash",
    verified: true,
    verifiedAt: "2026-08-14",
    source: "provider-catalog",
  },
  {
    id: "qwen/qwen3-coder",
    label: "Qwen3 Coder",
    provider: "Local",
    description: "Local / OpenRouter coding model",
    strengths: ["coding", "local", "tools"],
    cost: 1,
    power: 3,
    contextK: 262,
    providerModelId: "qwen3-coder",
    verified: true,
    verifiedAt: "2026-08-14",
    source: "openrouter-catalog",
  },
];

/**
 * Route a model based on the routing mode and request.
 *
 * @param mode — the user's routing preference
 * @param selectedModel — the user's explicitly selected model (for "fixed")
 * @param request — the user's request text (for "auto" routing)
 * @param availableModelIds — IDs of models whose providers are credentialed + healthy.
 *   If provided, routing only selects from these. If null/empty, uses full catalog.
 * @returns the chosen ModelChoice
 */
export function routeModel(
  mode: RoutingMode,
  selectedModel: string | null,
  request: string,
  availableModelIds?: string[] | null,
): ModelChoice {
  // Filter catalog to available models if credential info provided
  const catalog = availableModelIds && availableModelIds.length > 0
    ? MODEL_CATALOG.filter(m => availableModelIds.includes(m.id))
    : MODEL_CATALOG;

  // If no models available, fall back to full catalog (let the provider
  // error at runtime rather than crashing the UI)
  const effectiveCatalog = catalog.length > 0 ? catalog : MODEL_CATALOG;

  // Fixed: always use the selected model (if available)
  if (mode === "fixed" && selectedModel) {
    const found = effectiveCatalog.find(m => m.id === selectedModel);
    if (found) return found;
    // Selected model not available — fall through to auto
  }

  // Budget: cheapest capable model
  if (mode === "budget") {
    if (isCodingTask(request)) {
      return effectiveCatalog.find(m => m.id === "qwen/qwen3-coder") ??
             effectiveCatalog.find(m => m.strengths.includes("coding")) ??
             effectiveCatalog[0];
    }
    return [...effectiveCatalog].sort((a, b) => a.cost - b.cost)[0];
  }

  // Max: strongest available model
  if (mode === "max") {
    return [...effectiveCatalog].sort((a, b) => b.power - a.power)[0];
  }

  // Auto: LiTT analyzes the request and picks the best model
  return autoRoute(request, selectedModel, effectiveCatalog);
}

/**
 * Auto routing — LiTT decides based on task type.
 *
 * Routing heuristics:
 *   simple question    → cheaper/faster model
 *   coding             → Codex or Sonnet
 *   hard architecture  → Opus or GPT-5.6
 *   image/vision       → multimodal model
 *   huge context       → high-context model
 *   offline/private    → local model
 */
function autoRoute(request: string, selectedModel: string | null, catalog: ModelChoice[]): ModelChoice {
  const lower = request.toLowerCase();

  // If user selected a specific model, respect it as a preference (if available)
  if (selectedModel && selectedModel !== "openrouter/auto") {
    const found = catalog.find(m => m.id === selectedModel);
    if (found) return found;
  }

  // Architecture/deep reasoning → GPT-5.6 Sol (frontier, if available)
  if (lower.includes("architect") || lower.includes("design") ||
      lower.includes("refactor") || lower.includes("complex") ||
      lower.includes("reason") || lower.includes("analyze")) {
    return catalog.find(m => m.id === "openai/gpt-5.6-sol") ??
           catalog.find(m => m.strengths.includes("reasoning")) ??
           catalog[0];
  }

  // Coding tasks → Qwen3 Coder or Claude Sonnet 5 (whichever is available)
  if (isCodingTask(request)) {
    return catalog.find(m => m.id === "qwen/qwen3-coder") ??
           catalog.find(m => m.id === "anthropic/claude-sonnet-5") ??
           catalog.find(m => m.strengths.includes("coding")) ??
           catalog[0];
  }

  // Image/vision → Gemini 2.5 Pro (if available)
  if (lower.includes("image") || lower.includes("screenshot") ||
      lower.includes("visual") || lower.includes("diagram")) {
    return catalog.find(m => m.id === "google/gemini-2.5-pro") ??
           catalog.find(m => m.strengths.includes("vision")) ??
           catalog[0];
  }

  // Large context → Gemini 2.5 Pro (1M context, if available)
  if (lower.includes("large") || lower.includes("entire repo") ||
      lower.includes("whole project") || lower.includes("all files")) {
    return catalog.find(m => m.id === "google/gemini-2.5-pro") ??
           catalog.find(m => m.strengths.includes("large-context")) ??
           catalog[0];
  }

  // Simple questions → Gemini 2.5 Flash (fast + cheap, if available)
  return catalog.find(m => m.id === "google/gemini-2.5-flash") ??
         catalog.find(m => m.strengths.includes("fast")) ??
         catalog[0];
}

function isCodingTask(request: string): boolean {
  const lower = request.toLowerCase();
  return lower.includes("code") || lower.includes("function") ||
    lower.includes("bug") || lower.includes("fix") || lower.includes("test") ||
    lower.includes("build") || lower.includes("implement") || lower.includes("edit") ||
    lower.includes("write") || lower.includes("refactor") || lower.includes("file");
}

/**
 * Get the routing reason for display.
 */
export function routingReason(choice: ModelChoice, request: string): string {
  const lower = request.toLowerCase();

  if (choice.strengths.includes("auto")) return "LiTT auto-routing";
  if (isCodingTask(request) && choice.strengths.includes("coding")) {
    return "Repository coding task";
  }
  if ((lower.includes("architect") || lower.includes("design")) && choice.strengths.includes("reasoning")) {
    return "Deep reasoning task";
  }
  if ((lower.includes("image") || lower.includes("screenshot")) && choice.strengths.includes("multimodal")) {
    return "Multimodal/vision task";
  }
  if (choice.strengths.includes("large-context")) return "Large context needed";
  if (choice.strengths.includes("local")) return "Local/offline mode";
  if (choice.strengths.includes("fast")) return "Fast response prioritized";
  return "General task";
}

/**
 * Display label for routing mode.
 */
export function routingModeLabel(mode: RoutingMode): string {
  switch (mode) {
    case "auto": return "AUTO";
    case "fixed": return "FIXED";
    case "budget": return "BUDGET";
    case "max": return "MAX";
  }
}

/**
 * Display label for the brain — what the user sees as "LiTT's brain."
 */
export function brainLabel(mode: RoutingMode, selectedModel: string | null): string {
  if (mode === "auto") return "LiTT Auto";
  if (mode === "fixed" && selectedModel) {
    const model = MODEL_CATALOG.find(m => m.id === selectedModel);
    return model?.label ?? selectedModel;
  }
  if (mode === "budget") return "LiTT Budget";
  if (mode === "max") return "LiTT Max";
  return "LiTT Auto";
}
