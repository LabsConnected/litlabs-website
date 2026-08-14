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
}

/**
 * The model catalog. In production, this could be fetched from OpenRouter API.
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
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    provider: "Anthropic",
    description: "Fast + strong",
    strengths: ["coding", "fast", "general", "reasoning"],
    cost: 3,
    power: 4,
    contextK: 200,
  },
  {
    id: "anthropic/claude-opus-4.6",
    label: "Claude Opus 4.6",
    provider: "Anthropic",
    description: "Deep reasoning",
    strengths: ["reasoning", "architecture", "complex"],
    cost: 5,
    power: 5,
    contextK: 200,
  },
  {
    id: "openai/gpt-5.6",
    label: "GPT-5.6",
    provider: "OpenAI",
    description: "General purpose",
    strengths: ["general", "reasoning", "fast"],
    cost: 3,
    power: 4,
    contextK: 128,
  },
  {
    id: "openai/gpt-5.6-codex",
    label: "GPT-5.6 Codex",
    provider: "OpenAI",
    description: "Coding specialist",
    strengths: ["coding", "repository"],
    cost: 3,
    power: 4,
    contextK: 128,
  },
  {
    id: "google/gemini-3-pro",
    label: "Gemini 3 Pro",
    provider: "Google",
    description: "Large-context / multimodal",
    strengths: ["multimodal", "large-context", "vision"],
    cost: 3,
    power: 4,
    contextK: 1000,
  },
  {
    id: "qwen/qwen3-coder",
    label: "Qwen3-Coder",
    provider: "Local",
    description: "Local coding model",
    strengths: ["coding", "local", "offline"],
    cost: 1,
    power: 3,
    contextK: 32,
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

  // Architecture/deep reasoning → Opus (if available)
  if (lower.includes("architect") || lower.includes("design") ||
      lower.includes("refactor") || lower.includes("complex") ||
      lower.includes("reason") || lower.includes("analyze")) {
    return catalog.find(m => m.id === "anthropic/claude-opus-4.6") ??
           catalog.find(m => m.strengths.includes("reasoning")) ??
           catalog[0];
  }

  // Coding tasks → Codex or Sonnet (whichever is available)
  if (isCodingTask(request)) {
    return catalog.find(m => m.id === "openai/gpt-5.6-codex") ??
           catalog.find(m => m.id === "anthropic/claude-sonnet-4.6") ??
           catalog.find(m => m.strengths.includes("coding")) ??
           catalog[0];
  }

  // Image/vision → Gemini (if available)
  if (lower.includes("image") || lower.includes("screenshot") ||
      lower.includes("visual") || lower.includes("diagram")) {
    return catalog.find(m => m.id === "google/gemini-3-pro") ??
           catalog.find(m => m.strengths.includes("vision")) ??
           catalog[0];
  }

  // Large context → Gemini (if available)
  if (lower.includes("large") || lower.includes("entire repo") ||
      lower.includes("whole project") || lower.includes("all files")) {
    return catalog.find(m => m.id === "google/gemini-3-pro") ??
           catalog.find(m => m.strengths.includes("large-context")) ??
           catalog[0];
  }

  // Simple questions → Sonnet (fast + strong, if available)
  return catalog.find(m => m.id === "anthropic/claude-sonnet-4.6") ??
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
