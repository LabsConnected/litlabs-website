/**
 * Sentinel state machine — pure, dependency-free, unit-testable.
 *
 * Hysteresis rules (per service, consecutive probe results):
 *
 *   operational --fail--> degraded (open warning incident)
 *   degraded    --fail--> down      (critical; escalate same incident)
 *   warning-severity failures degrade but NEVER reach "down"
 *   down        --ok x3--> operational (resolve incident)
 *   degraded    --ok x2--> operational (resolve incident)
 *   unknown     --ok----> operational (no incident ever existed)
 *
 * A single success never clears a down state — that is what stops
 * flapping services from opening/closing incidents every probe.
 */

import type {
  ProbeResult,
  SentinelLevel,
  SentinelServiceId,
  ServiceState,
  SentinelTransition,
} from "./types";

export const DOWN_THRESHOLD = 2;
export const RECOVER_FROM_DOWN_SUCCESSES = 3;
export const RECOVER_FROM_DEGRADED_SUCCESSES = 2;

export const SENTINEL_SERVICE_IDS: SentinelServiceId[] = [
  "database",
  "ai-gemini",
  "ai-openrouter",
  "terminal-server",
  "stripe",
  "deployment",
  "studio-browser",
];

export const SERVICE_LABELS: Record<SentinelServiceId, string> = {
  database: "Database",
  "ai-gemini": "AI · Gemini",
  "ai-openrouter": "AI · OpenRouter",
  "terminal-server": "Terminal Server",
  stripe: "Stripe",
  deployment: "Deployment",
  "studio-browser": "Studio Browser",
};

export function initialServiceState(serviceId: SentinelServiceId): ServiceState {
  return {
    serviceId,
    level: "unknown",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    lastCheckedAt: null,
    lastChangeAt: null,
    lastLatencyMs: null,
    detail: "not yet probed",
    openIncidentId: null,
  };
}

function withLevel(
  prev: ServiceState,
  level: SentinelLevel,
  now: string,
  detail: string,
  latencyMs: number | null,
): ServiceState {
  const changed = level !== prev.level;
  return {
    ...prev,
    level,
    lastCheckedAt: now,
    lastChangeAt: changed ? now : prev.lastChangeAt,
    lastLatencyMs: latencyMs,
    detail,
  };
}

/**
 * Evaluate one probe result against the previous state.
 * `prev` may be null (first pass) — treated as a fresh "unknown" state.
 */
export function evaluateTransition(
  serviceId: SentinelServiceId,
  prev: ServiceState | null,
  probe: ProbeResult,
  now: string,
): SentinelTransition {
  const base = prev ?? initialServiceState(serviceId);

  // Service not applicable in this environment — report unknown,
  // reset failure streaks, never open an incident.
  if (probe.applicable === false) {
    return {
      state: withLevel(
        { ...base, consecutiveFailures: 0, consecutiveSuccesses: 0 },
        "unknown",
        now,
        probe.detail,
        probe.latencyMs,
      ),
      events: [],
    };
  }

  if (probe.ok) {
    const consecutiveSuccesses = base.consecutiveSuccesses + 1;
    const failures = 0;

    if (base.level === "down") {
      if (consecutiveSuccesses >= RECOVER_FROM_DOWN_SUCCESSES) {
        return {
          state: {
            ...withLevel(base, "operational", now, probe.detail, probe.latencyMs),
            consecutiveFailures: failures,
            consecutiveSuccesses,
          },
          events: [
            {
              type: "recovered",
              summary: `${SERVICE_LABELS[serviceId]} recovered after ${consecutiveSuccesses} consecutive healthy probes`,
            },
          ],
        };
      }
      // Still down — probing continues, incident stays open.
      return {
        state: {
          ...withLevel(base, "down", now, probe.detail, probe.latencyMs),
          consecutiveFailures: failures,
          consecutiveSuccesses,
        },
        events: [],
      };
    }

    if (base.level === "degraded") {
      if (consecutiveSuccesses >= RECOVER_FROM_DEGRADED_SUCCESSES) {
        return {
          state: {
            ...withLevel(base, "operational", now, probe.detail, probe.latencyMs),
            consecutiveFailures: failures,
            consecutiveSuccesses,
          },
          events: [
            {
              type: "recovered",
              summary: `${SERVICE_LABELS[serviceId]} recovered`,
            },
          ],
        };
      }
      return {
        state: {
          ...withLevel(base, "degraded", now, probe.detail, probe.latencyMs),
          consecutiveFailures: failures,
          consecutiveSuccesses,
        },
        events: [],
      };
    }

    // operational / unknown → healthy probe is just operational.
    return {
      state: {
        ...withLevel(base, "operational", now, probe.detail, probe.latencyMs),
        consecutiveFailures: failures,
        consecutiveSuccesses,
      },
      events: [],
    };
  }

  // ── Failure path ──────────────────────────────────────────────
  const consecutiveFailures = base.consecutiveFailures + 1;
  const severity = probe.severity ?? "critical";
  const detail = probe.detail;

  if (base.level === "down") {
    return {
      state: {
        ...withLevel(base, "down", now, detail, probe.latencyMs),
        consecutiveFailures,
        consecutiveSuccesses: 0,
      },
      events: [],
    };
  }

  if (base.level === "degraded") {
    // Warning-severity failures never escalate to down.
    if (severity === "warning" || consecutiveFailures < DOWN_THRESHOLD) {
      return {
        state: {
          ...withLevel(base, "degraded", now, detail, probe.latencyMs),
          consecutiveFailures,
          consecutiveSuccesses: 0,
        },
        events: [],
      };
    }
    return {
      state: {
        ...withLevel(base, "down", now, detail, probe.latencyMs),
        consecutiveFailures,
        consecutiveSuccesses: 0,
      },
      events: [
        {
          type: "escalated",
          to: "down",
          summary: `${SERVICE_LABELS[serviceId]} is down — ${detail}`,
        },
      ],
    };
  }

  // operational / unknown → first failure opens at degraded.
  return {
    state: {
      ...withLevel(base, "degraded", now, detail, probe.latencyMs),
      consecutiveFailures,
      consecutiveSuccesses: 0,
    },
    events: [
      {
        type: "opened",
        level: "degraded",
        severity,
        summary: `${SERVICE_LABELS[serviceId]} degraded — ${detail}`,
      },
    ],
  };
}

/**
 * Map an AI-provider health probe (system-health.ts shape) onto a
 * Sentinel ProbeResult. "missing" means no key is configured — the
 * provider is not expected here, so it reports inapplicable rather
 * than failed.
 */
export function mapAiProviderProbe(state: string, detail: string, latencyMs: number | null): ProbeResult {
  switch (state) {
    case "healthy":
      return { ok: true, latencyMs, detail };
    case "missing":
      return { ok: true, latencyMs, detail, applicable: false };
    case "rate_limited":
    case "degraded":
      return { ok: false, latencyMs, detail, severity: "warning" };
    default:
      // unauthorized / unavailable
      return { ok: false, latencyMs, detail, severity: "critical" };
  }
}
