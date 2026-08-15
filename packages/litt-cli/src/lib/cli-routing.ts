/**
 * CLI routing adapter — maps CLI routing modes to @litt/models routing.
 *
 * The CLI has four UI routing modes: auto, fixed, budget, max.
 * @litt/models has three spec-level modes: auto, pinned, ask, plus a
 * `preference` option for budget/max selection.
 *
 * This adapter bridges the two without duplicating any routing logic.
 * All actual model selection happens in @litt/models' routeModel().
 */

import {
  routeModel as modelsRouteModel,
  brainLabel as modelsBrainLabel,
  routingModeLabel as modelsRoutingModeLabel,
  type ModelRegistry,
  type ModelDefinition,
  type RoutingInput,
  type RoutingResult,
  type RouteOptions,
} from "@litt/models";

import type { RoutingMode as CliRoutingMode } from "../ink/cockpit-store.js";

export type { ModelDefinition };
export type RoutingMode = CliRoutingMode;

/**
 * Map a CLI routing mode to @litt/models route options.
 *   auto   → mode: auto
 *   fixed  → mode: pinned, pinnedModelId: selectedModel
 *   budget → mode: auto, preference: budget
 *   max    → mode: auto, preference: max
 */
export function cliModeToRouteOptions(
  mode: RoutingMode,
  selectedModel: string | null,
): RouteOptions {
  switch (mode) {
    case "fixed":
      return { mode: "pinned", pinnedModelId: selectedModel };
    case "budget":
      return { mode: "auto", preference: "budget" };
    case "max":
      return { mode: "auto", preference: "max" };
    case "auto":
    default:
      return { mode: "auto" };
  }
}

/**
 * Route a model using @litt/models, adapting CLI routing mode.
 */
export function routeModel(
  registry: ModelRegistry,
  input: RoutingInput,
  mode: RoutingMode,
  selectedModel: string | null,
): RoutingResult {
  return modelsRouteModel(registry, input, cliModeToRouteOptions(mode, selectedModel));
}

/**
 * Brain label — delegates to @litt/models.
 * In CLI "auto" mode, shows "LiTT Auto".
 * In CLI "fixed" mode, shows the selected model's display name.
 * In CLI "budget"/"max" mode, shows "LiTT Budget"/"LiTT Max".
 */
export function brainLabel(mode: RoutingMode, selectedModel: string | null, registry: ModelRegistry): string {
  if (mode === "auto") return "LiTT Auto";
  if (mode === "budget") return "LiTT Budget";
  if (mode === "max") return "LiTT Max";
  if (mode === "fixed" && selectedModel) {
    const model = registry.getById(selectedModel);
    return model?.displayName ?? selectedModel;
  }
  return "LiTT Auto";
}

/**
 * Routing mode label for display.
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
 * Routing reason for display — uses the @litt/models routing result reason.
 */
export function routingReason(result: RoutingResult, _mode: RoutingMode): string {
  return result.reason;
}
