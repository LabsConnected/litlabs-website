/**
 * Sentinel — platform self-monitoring types.
 *
 * Sentinel periodically probes platform services, tracks per-service
 * health with hysteresis, opens/resolves incidents, applies a small set
 * of bounded safe remediations, and escalates everything else to the
 * owner. It never restarts services, mutates customer data, or deploys.
 */

export type SentinelServiceId =
  | "database"
  | "ai-gemini"
  | "ai-openrouter"
  | "terminal-server"
  | "stripe"
  | "deployment"
  | "backup";

export type SentinelLevel = "operational" | "degraded" | "down" | "unknown";

export type SentinelSeverity = "warning" | "critical";

/** Result of a single service probe. */
export interface ProbeResult {
  /** false = the probe failed (unreachable, error status, rejected key). */
  ok: boolean;
  latencyMs: number | null;
  detail: string;
  /**
   * When false the service is not expected in this environment
   * (e.g. no Stripe key in local dev) — reported as "unknown" and
   * never opens an incident.
   */
  applicable?: boolean;
  /**
   * Failure severity hint. "warning" failures degrade but never
   * escalate to "down" (rate limits, soft errors). Default "critical".
   */
  severity?: SentinelSeverity;
}

/** Persisted/in-memory health state for one service. */
export interface ServiceState {
  serviceId: SentinelServiceId;
  level: SentinelLevel;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt: string | null;
  lastChangeAt: string | null;
  lastLatencyMs: number | null;
  detail: string;
  /** UUID of the currently open incident, if any. */
  openIncidentId: string | null;
}

/** State-transition events emitted by the evaluator. */
export type SentinelEvent =
  | { type: "opened"; level: "degraded" | "down"; severity: SentinelSeverity; summary: string }
  | { type: "escalated"; to: "down"; summary: string }
  | { type: "recovered"; summary: string };

export interface SentinelTransition {
  state: ServiceState;
  events: SentinelEvent[];
}

export interface SentinelIncident {
  id: string;
  serviceId: SentinelServiceId;
  severity: SentinelSeverity;
  state: "open" | "resolved";
  summary: string;
  detail: string;
  remediation: string[];
  openedAt: string;
  resolvedAt: string | null;
}

/** Bounded automatic actions Sentinel may take. Anything not listed here
 *  is escalation-only: Sentinel alerts the owner and stops. */
export type SentinelRemediation =
  | "alert-owner"
  | "clear-ai-health-cache";

export interface SentinelServiceSnapshot {
  serviceId: SentinelServiceId;
  label: string;
  level: SentinelLevel;
  detail: string;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  consecutiveFailures: number;
}

export interface SentinelSnapshot {
  generatedAt: string;
  overall: "healthy" | "degraded" | "critical" | "unknown";
  services: SentinelServiceSnapshot[];
  openIncidents: SentinelIncident[];
  recentIncidents: SentinelIncident[];
  lastPassAt: string | null;
}
