/**
 * Shared Capability Contract — single source of truth for capability status vocabulary.
 *
 * Reconciles the three historical vocabularies:
 *  - legacy 3-state: available | unavailable | misconfigured  (src/lib/capability-registry.ts)
 *  - canonical 8-state: ready | offline | connecting | limited | requires_approval | degraded | unavailable | unknown
 *    (src/lib/litt/types.ts, src/lib/litt-kernel/types.ts)
 *  - legacy deploy adapter: ready | running | unavailable | not_configured | degraded | limited
 *
 * All new code MUST use CanonicalCapabilityState. The legacy 3-state is kept
 * for marketplace code but now maps through this contract.
 */

export type CanonicalCapabilityState =
  | "ready"
  | "offline"
  | "connecting"
  | "limited"
  | "requires_approval"
  | "degraded"
  | "unavailable"
  | "unknown";

export type LegacyCapabilityStatus = "available" | "unavailable" | "misconfigured";
export type LegacyDeployStatus = "ready" | "running" | "unavailable" | "not_configured" | "degraded" | "limited";

export const CANONICAL_STATES: readonly CanonicalCapabilityState[] = [
  "ready",
  "offline",
  "connecting",
  "limited",
  "requires_approval",
  "degraded",
  "unavailable",
  "unknown",
] as const;

export function isCanonicalState(value: string): value is CanonicalCapabilityState {
  return (CANONICAL_STATES as readonly string[]).includes(value);
}

/** Map the legacy 3-state marketplace status to canonical 8-state. */
export function legacyToCanonical(status: LegacyCapabilityStatus): CanonicalCapabilityState {
  switch (status) {
    case "available":
      return "ready";
    case "unavailable":
      return "unavailable";
    case "misconfigured":
      return "degraded";
    default:
      return "unknown";
  }
}

/** Map canonical 8-state back to legacy 3-state for backwards compat. */
export function canonicalToLegacy(state: CanonicalCapabilityState): LegacyCapabilityStatus {
  switch (state) {
    case "ready":
    case "limited":
      return "available";
    case "unavailable":
    case "offline":
      return "unavailable";
    case "degraded":
    case "connecting":
    case "requires_approval":
    case "unknown":
      return "misconfigured";
    default:
      return "misconfigured";
  }
}

/** Map the old deploy adapter statuses to canonical. */
export function deployStatusToCanonical(status: LegacyDeployStatus): CanonicalCapabilityState {
  const map: Record<LegacyDeployStatus, CanonicalCapabilityState> = {
    ready: "ready",
    running: "connecting",
    unavailable: "unavailable",
    not_configured: "unknown",
    degraded: "degraded",
    limited: "limited",
  };
  return map[status] ?? "unknown";
}

export function canonicalToDeployStatus(state: CanonicalCapabilityState): LegacyDeployStatus {
  const map: Record<CanonicalCapabilityState, LegacyDeployStatus> = {
    ready: "ready",
    offline: "unavailable",
    connecting: "running",
    limited: "limited",
    requires_approval: "not_configured",
    degraded: "degraded",
    unavailable: "unavailable",
    unknown: "not_configured",
  };
  return map[state] ?? "not_configured";
}
