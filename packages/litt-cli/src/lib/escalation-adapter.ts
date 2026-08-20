/**
 * Escalation adapter — bridges @litt/models EscalationTracker to
 * @litt/agent-core EscalationHook.
 *
 * agent-core stays pure (no litt-models dependency). This adapter lives
 * in litt-cli, which depends on both packages, and adapts the real
 * EscalationTracker to the EscalationHook interface the agent loop
 * expects.
 *
 * The ModelResolver (model id → ModelProvider) is also constructed
 * here, using the shared ModelRuntime's registry + OpenRouterModelProvider.
 */

import {
  EscalationTracker,
  DEFAULT_ESCALATION_POLICY,
  type TaskKind,
  type ModelDefinition,
} from "@litt/models";
import type { EscalationHook, ModelResolver, AgentFailureKind, ToolDefinition } from "@litt/agent-core";
import type { ModelProvider } from "@litt/agent-core";

import { OpenRouterModelProvider } from "./model-provider.js";
import type { ModelRuntime } from "./model-runtime.js";

/**
 * Map agent-core failure kinds to litt-models failure kinds.
 * They are structurally identical but live in different packages.
 */
function mapFailureKind(kind: AgentFailureKind): "tool" | "reasoning" | "network" | "rate-limit" | "auth" | "content" | "unknown" {
  return kind;
}

/**
 * Create an EscalationHook backed by a real EscalationTracker.
 *
 * The tracker is registry-aware: pickEscalatedModel uses the
 * ModelRuntime's registry to find a stronger verified model.
 */
export function createEscalationHook(
  tracker: EscalationTracker,
  runtime: ModelRuntime,
  taskKind: TaskKind = "coding",
): EscalationHook {
  return {
    startMission(missionId, modelId) {
      tracker.startMission(missionId, modelId);
    },
    recordFailure(missionId, kind, message) {
      tracker.recordFailure(missionId, mapFailureKind(kind), message);
    },
    recordSuccess(missionId) {
      tracker.recordSuccess(missionId);
    },
    shouldEscalate(missionId) {
      return tracker.shouldEscalate(missionId);
    },
    pickEscalatedModel(missionId) {
      const pick = tracker.pickEscalatedModel(missionId, runtime.registry, taskKind);
      if (!pick) return null;
      return { modelId: pick.model.canonicalId, reason: pick.reason };
    },
    commitEscalation(missionId, toModelId, reason, runId) {
      const event = tracker.commitEscalation(missionId, toModelId, reason, runId);
      if (!event) return null;
      return {
        fromModelId: event.fromModelId,
        toModelId: event.toModelId,
        reason: event.reason,
        at: event.at,
      };
    },
    currentModel(missionId) {
      return tracker.currentModel(missionId);
    },
    endMission(missionId) {
      tracker.endMission(missionId);
    },
  };
}

/**
 * Create a ModelResolver that maps a canonical model id to an
 * OpenRouterModelProvider. Uses the ModelRuntime's registry to
 * resolve the OpenRouter model id.
 *
 * `tools` (optional) are the native tool schemas to declare on every
 * escalated provider — the stronger model must see the SAME project
 * tools the original model had, or it will claim tools are unavailable.
 *
 * Returns null if the model is not in the registry or has no
 * OpenRouter model id (e.g. a native-provider-only model).
 */
export function createModelResolver(runtime: ModelRuntime, tools?: ToolDefinition[]): ModelResolver {
  return (modelId: string): ModelProvider | null => {
    const model: ModelDefinition | undefined = runtime.getModel(modelId);
    if (!model) return null;
    const orId = model.openRouterModelId;
    if (!orId) return null;
    try {
      return new OpenRouterModelProvider({ model: orId, tools });
    } catch {
      // OpenRouterModelProvider throws if no API key — can't escalate
      // to this model. Return null so the loop falls back.
      return null;
    }
  };
}

/**
 * Create a fresh EscalationTracker with the default policy.
 * The controller creates one per mission (or reuses across missions).
 */
export function createEscalationTracker(): EscalationTracker {
  return new EscalationTracker(DEFAULT_ESCALATION_POLICY);
}
