/**
 * Failure escalation + mission model affinity.
 *
 * Spec section 7: when a model fails repeatedly (tool/reasoning failures),
 * LiTT escalates to a stronger verified model and continues the same
 * mission/context — no invisible model swapping.
 *
 * Spec section 6: maintain model affinity during a coherent mission unless
 * escalation/fallback is triggered. Don't bounce models every turn.
 *
 * This module is pure state — it does NOT perform network calls. The runtime
 * calls recordFailure() / recordSuccess() and asks shouldEscalate() /
 * pickEscalatedModel(). The registry provides the candidate set.
 */

import type { ModelDefinition, ProviderId, TaskKind } from "./types.js";
import type { ModelRegistry } from "./registry.js";

// ─── Failure tracking ──────────────────────────────────────────────

export interface FailureRecord {
  modelId: string;
  /** What kind of failure: tool, reasoning, network, rate-limit, auth, content. */
  kind: FailureKind;
  /** ISO timestamp. */
  at: string;
  /** Optional error message snippet. */
  message?: string;
}

export type FailureKind = "tool" | "reasoning" | "network" | "rate-limit" | "auth" | "content" | "unknown";

/**
 * Classify a raw error into a failure kind. Used to decide whether to
 * escalate (tool/reasoning failures) vs fallback (network/rate-limit).
 */
export function classifyFailure(error: unknown): FailureKind {
  if (!(error instanceof Error)) return "unknown";
  const msg = error.message.toLowerCase();
  if (msg.includes("429") || msg.includes("rate limit")) return "rate-limit";
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden")) return "auth";
  if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("network") || msg.includes("econnreset") || msg.includes("timeout")) return "network";
  if (msg.includes("tool") || msg.includes("function call") || msg.includes("invalid arguments")) return "tool";
  if (msg.includes("invalid json") || msg.includes("parse") || msg.includes("malformed")) return "content";
  if (msg.includes("reason") || msg.includes("wrong") || msg.includes("incorrect")) return "reasoning";
  return "unknown";
}

// ─── Mission affinity ──────────────────────────────────────────────

export interface MissionAffinity {
  missionId: string;
  /** The model the mission started with. */
  modelId: string;
  /** Consecutive failures on the current model. */
  consecutiveFailures: number;
  /** All failure records for this mission. */
  failures: FailureRecord[];
  /** Escalation history: each entry is a model switch. */
  escalations: EscalationEvent[];
  /** When the mission started. */
  startedAt: string;
}

export interface EscalationEvent {
  /** ISO timestamp. */
  at: string;
  fromModelId: string;
  toModelId: string;
  reason: string;
  missionId: string;
  runId?: string;
}

// ─── EscalationPolicy ──────────────────────────────────────────────

export interface EscalationPolicy {
  /** Consecutive failures before escalating. Default 3. */
  threshold: number;
  /** Failure kinds that count toward escalation. */
  countedKinds: FailureKind[];
}

export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  threshold: 3,
  countedKinds: ["tool", "reasoning", "unknown"],
};

// ─── EscalationTracker ─────────────────────────────────────────────

/**
 * Tracks per-mission failures and decides when to escalate.
 *
 * The tracker is registry-aware: when escalating, it picks the next
 * stronger verified model from the registry's fallback chain.
 */
export class EscalationTracker {
  private missions = new Map<string, MissionAffinity>();
  private policy: EscalationPolicy;

  constructor(policy: EscalationPolicy = DEFAULT_ESCALATION_POLICY) {
    this.policy = policy;
  }

  /**
   * Start tracking a mission with a given model.
   */
  startMission(missionId: string, modelId: string): MissionAffinity {
    const affinity: MissionAffinity = {
      missionId,
      modelId,
      consecutiveFailures: 0,
      failures: [],
      escalations: [],
      startedAt: new Date().toISOString(),
    };
    this.missions.set(missionId, affinity);
    return affinity;
  }

  /**
   * Get the affinity for a mission (or null if not tracked).
   */
  getMission(missionId: string): MissionAffinity | null {
    return this.missions.get(missionId) ?? null;
  }

  /**
   * Record a failure for a mission's current model.
   * Returns the updated affinity.
   */
  recordFailure(missionId: string, kind: FailureKind, message?: string): MissionAffinity | null {
    const affinity = this.missions.get(missionId);
    if (!affinity) return null;
    const record: FailureRecord = {
      modelId: affinity.modelId,
      kind,
      at: new Date().toISOString(),
      message,
    };
    affinity.failures.push(record);
    if (this.policy.countedKinds.includes(kind)) {
      affinity.consecutiveFailures += 1;
    }
    return affinity;
  }

  /**
   * Record a success — resets consecutive failures for the current model.
   */
  recordSuccess(missionId: string): void {
    const affinity = this.missions.get(missionId);
    if (affinity) affinity.consecutiveFailures = 0;
  }

  /**
   * Should the mission escalate to a stronger model?
   * True when consecutive failures >= threshold.
   */
  shouldEscalate(missionId: string): boolean {
    const affinity = this.missions.get(missionId);
    if (!affinity) return false;
    return affinity.consecutiveFailures >= this.policy.threshold;
  }

  /**
   * Pick the next stronger model to escalate to.
   * Uses the registry's fallback chain, excluding the current model and
   * any already-tried models. Prefers frontier intelligence.
   *
   * Returns null if no stronger model is available.
   */
  pickEscalatedModel(
    missionId: string,
    registry: ModelRegistry,
    taskKind: TaskKind,
  ): { model: ModelDefinition; reason: string } | null {
    const affinity = this.missions.get(missionId);
    if (!affinity) return null;

    const triedIds = new Set<string>([
      affinity.modelId,
      ...affinity.escalations.map((e) => e.toModelId),
    ]);

    // Get available (routable + online) models, sorted strongest first
    const available = registry.getAvailable()
      .filter((m) => m.availability === "online")
      .filter((m) => !triedIds.has(m.canonicalId))
      .sort((a, b) => intelligenceRank(b) - intelligenceRank(a));

    if (available.length === 0) return null;

    const next = available[0];
    const reason = `Escalated from ${affinity.modelId} after ${affinity.consecutiveFailures} consecutive failures → ${next.canonicalId}`;
    return { model: next, reason };
  }

  /**
   * Commit an escalation: switch the mission's current model and record
   * the event. Resets consecutive failures.
   */
  commitEscalation(
    missionId: string,
    toModelId: string,
    reason: string,
    runId?: string,
  ): EscalationEvent | null {
    const affinity = this.missions.get(missionId);
    if (!affinity) return null;
    const event: EscalationEvent = {
      at: new Date().toISOString(),
      fromModelId: affinity.modelId,
      toModelId,
      reason,
      missionId,
      runId,
    };
    affinity.escalations.push(event);
    affinity.modelId = toModelId;
    affinity.consecutiveFailures = 0;
    return event;
  }

  /**
   * End mission tracking.
   */
  endMission(missionId: string): MissionAffinity | null {
    const affinity = this.missions.get(missionId);
    this.missions.delete(missionId);
    return affinity ?? null;
  }

  /**
   * Get the current model for a mission (affinity).
   */
  currentModel(missionId: string): string | null {
    return this.missions.get(missionId)?.modelId ?? null;
  }

  /**
   * All escalation events across missions (for audit).
   */
  allEscalations(): EscalationEvent[] {
    const events: EscalationEvent[] = [];
    for (const affinity of this.missions.values()) {
      events.push(...affinity.escalations);
    }
    return events;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Rank intelligence for escalation: frontier=3, balanced=2, light=1.
 */
export function intelligenceRank(model: ModelDefinition): number {
  switch (model.intelligence) {
    case "frontier": return 3;
    case "balanced": return 2;
    case "light": return 1;
  }
}

/**
 * Is a failure kind a "fallback" kind (transient — try the same model again
 * or a different transport) vs an "escalation" kind (the model is too weak)?
 */
export function isFallbackKind(kind: FailureKind): boolean {
  return kind === "network" || kind === "rate-limit" || kind === "auth";
}
