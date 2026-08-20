/**
 * Latency-aware auto routing — extends the existing ModelRuntime routing
 * with task-complexity awareness.
 *
 * The existing @litt/models routeModel() already considers:
 *   - model quality (profile: fast/smart/long)
 *   - provider health
 *   - cost (budget/max preferences)
 *   - availability (verified models)
 *
 * This module adds:
 *   - task complexity → model profile preference
 *   - historical latency tracking (telemetry, no secrets)
 *
 * Routing classes:
 *   LOCAL       → no model (deterministic fast lane)
 *   READ_FAST   → bounded read-only tools, optional fast synthesis
 *   CHAT_FAST   → fast model for casual conversation
 *   MISSION_STANDARD → standard model for simple missions
 *   MISSION_DEEP → strong model for complex missions
 *
 * Explicit model selection (FIXED mode) is ALWAYS preserved —
 * latency-aware routing only applies to AUTO/BUDGET/MAX modes.
 */

import type { RoutingMode } from "../ink/cockpit-store.js";
import type { RoutedModel } from "./model-runtime.js";
import { classifyMissionComplexity } from "./mission-complexity.js";

// ─── Types ─────────────────────────────────────────────────────────

export type RoutingClass =
  | "LOCAL"
  | "READ_FAST"
  | "CHAT_FAST"
  | "MISSION_STANDARD"
  | "MISSION_DEEP";

export interface LatencyAwareRouteResult {
  /** The routing class that was selected. */
  routingClass: RoutingClass;
  /** The original routed model from ModelRuntime.route(). */
  routed: RoutedModel;
  /** Whether the routing class influenced model selection. */
  influenced: boolean;
}

// ─── Telemetry (no secrets) ────────────────────────────────────────

interface LatencyRecord {
  modelId: string;
  routingClass: RoutingClass;
  durationMs: number;
  success: boolean;
  ts: number;
}

const latencyHistory: LatencyRecord[] = [];
const MAX_HISTORY = 100;

/**
 * Record a latency observation for future routing decisions.
 * No secrets are stored — only model ID, routing class, duration, and success.
 */
export function recordLatency(
  modelId: string,
  routingClass: RoutingClass,
  durationMs: number,
  success: boolean,
): void {
  latencyHistory.push({
    modelId,
    routingClass,
    durationMs,
    success,
    ts: Date.now(),
  });
  if (latencyHistory.length > MAX_HISTORY) {
    latencyHistory.shift();
  }
}

/**
 * Get average latency for a routing class, or null if no history.
 */
export function getAverageLatency(routingClass: RoutingClass): number | null {
  const records = latencyHistory.filter((r) => r.routingClass === routingClass);
  if (records.length === 0) return null;
  return records.reduce((sum, r) => sum + r.durationMs, 0) / records.length;
}

/**
 * Get the latency history (for diagnostics/telemetry).
 */
export function getLatencyHistory(): readonly LatencyRecord[] {
  return latencyHistory;
}

// ─── Routing class determination ───────────────────────────────────

/**
 * Determine the routing class for a given input + intent.
 *
 * This does NOT override the user's explicit model selection (FIXED mode).
 * It only provides a classification that AUTO/BUDGET/MAX modes can use
 * to prefer fast vs strong models.
 */
export function determineRoutingClass(
  intent: "chat" | "read" | "mission",
  input: string,
): RoutingClass {
  if (intent === "chat") return "CHAT_FAST";
  if (intent === "read") return "READ_FAST";
  // Mission — use complexity to pick standard vs deep.
  const complexity = classifyMissionComplexity(input);
  return complexity === "simple" ? "MISSION_STANDARD" : "MISSION_DEEP";
}

/**
 * Get a model profile preference based on routing class.
 *
 * Fast models: classification, simple synthesis, small explanation.
 * Strong models: architecture, repair, complex reasoning, multi-file.
 *
 * This is a HINT to the routing system — the actual model selection
 * still happens in @litt/models routeModel(), which considers health,
 * availability, and cost alongside the preference.
 */
export function profilePreference(routingClass: RoutingClass): "fast" | "smart" | "long" | null {
  switch (routingClass) {
    case "LOCAL": return null; // no model
    case "READ_FAST": return "fast"; // bounded read, fast synthesis
    case "CHAT_FAST": return "fast"; // casual conversation
    case "MISSION_STANDARD": return "smart"; // standard mission
    case "MISSION_DEEP": return "long"; // complex mission, strong model
  }
}
