/**
 * Sentinel pass — probe every service, evaluate state transitions,
 * persist status, open/resolve incidents, apply bounded remediation,
 * and escalate via alertLog.
 *
 * Safety contract:
 *   - Probes are read-only and timeout-bounded.
 *   - The ONLY automatic actions are cache clears and owner alerts.
 *   - Sentinel never restarts services, mutates customer data,
 *     touches billing, or deploys anything. Those remain owner
 *     decisions — Sentinel's job is to detect and escalate.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { alertLog } from "@/lib/alerts";
import { _clearAiHealthCache } from "@/lib/system-health";
import { getSupabaseAdmin } from "@/lib/supabase";
import { defaultProbes, type ProbeFn } from "./probes";
import { evaluateTransition, initialServiceState, SENTINEL_SERVICE_IDS, SERVICE_LABELS } from "./state";
import {
  findOpenIncidentId,
  loadRecentIncidents,
  loadServiceStates,
  openIncident,
  resolveIncident,
  saveServiceState,
} from "./store";
import type {
  ProbeResult,
  SentinelEvent,
  SentinelIncident,
  SentinelRemediation,
  SentinelServiceId,
  SentinelSnapshot,
  ServiceState,
} from "./types";

/** In-memory state — authoritative within this process, mirrored to DB. */
const memoryStates = new Map<SentinelServiceId, ServiceState>();
let lastIncidents: SentinelIncident[] = [];
let lastPassAt: string | null = null;
let passInFlight = false;

/** Bounded remediation chosen per transition event. */
export function planRemediation(
  serviceId: SentinelServiceId,
  event: SentinelEvent,
): SentinelRemediation[] {
  const actions: SentinelRemediation[] = ["alert-owner"];
  if (event.type === "recovered" && (serviceId === "ai-gemini" || serviceId === "ai-openrouter")) {
    // A recovered provider may have been skipped by health caching —
    // clearing it lets the next request probe fresh. Safe and local.
    actions.push("clear-ai-health-cache");
  }
  return actions;
}

function applyRemediation(actions: SentinelRemediation[]): void {
  for (const action of actions) {
    if (action === "clear-ai-health-cache") {
      try {
        _clearAiHealthCache();
      } catch {
        // Cache clear is best-effort.
      }
    }
    // "alert-owner" is handled by the caller via alertLog.
  }
}

async function handleEvent(
  client: SupabaseClient | null,
  serviceId: SentinelServiceId,
  state: ServiceState,
  probe: ProbeResult,
  event: SentinelEvent,
): Promise<ServiceState> {
  const actions = planRemediation(serviceId, event);
  applyRemediation(actions);

  const meta = {
    service: serviceId,
    level: state.level,
    detail: state.detail,
    latencyMs: state.lastLatencyMs,
    remediation: actions,
  };

  if (event.type === "opened") {
    // Reuse an existing open incident if one is already recorded —
    // multi-replica deployments can race here; duplicates are resolved
    // together on recovery, so this is cosmetic at worst.
    const existing = state.openIncidentId ?? (await findOpenIncidentId(client, serviceId));
    const id =
      existing ??
      (await openIncident(client, {
        serviceId,
        severity: event.severity,
        summary: event.summary,
        detail: probe.detail,
        remediation: actions,
      }));
    void alertLog(`sentinel.incident.opened.${serviceId}`, { ...meta, summary: event.summary });
    return { ...state, openIncidentId: id ?? existing };
  }

  if (event.type === "escalated") {
    void alertLog(`sentinel.incident.escalated.${serviceId}`, { ...meta, summary: event.summary });
    return state;
  }

  // recovered
  if (state.openIncidentId) {
    await resolveIncident(client, state.openIncidentId);
  }
  void alertLog(`sentinel.incident.recovered.${serviceId}`, { ...meta, summary: event.summary });
  return { ...state, openIncidentId: null };
}

export interface SentinelPassResult {
  passAt: string;
  states: ServiceState[];
  events: { serviceId: SentinelServiceId; event: SentinelEvent }[];
  persisted: boolean;
}

/**
 * Run one Sentinel pass. Injectable probes + client for tests.
 * Never throws — a failed pass is itself logged and skipped.
 */
export async function runSentinelPass(
  client?: SupabaseClient | null,
  probes?: Record<SentinelServiceId, ProbeFn>,
): Promise<SentinelPassResult> {
  // Single-flight: an overlapping pass (slow probe + interval tick)
  // would double-count consecutive failures. Skip instead.
  if (passInFlight) {
    const states = SENTINEL_SERVICE_IDS.map(
      (id) => memoryStates.get(id) ?? initialServiceState(id),
    );
    return { passAt: new Date().toISOString(), states, events: [], persisted: !!client };
  }
  passInFlight = true;
  try {
    return await runSentinelPassInner(client, probes);
  } finally {
    passInFlight = false;
  }
}

async function runSentinelPassInner(
  client?: SupabaseClient | null,
  probes?: Record<SentinelServiceId, ProbeFn>,
): Promise<SentinelPassResult> {
  const db = client === undefined ? getSupabaseAdmin() : client;
  const now = new Date().toISOString();
  const probeMap = probes ?? defaultProbes(db);

  // Merge persisted states under in-memory ones: DB wins for fields
  // memory hasn't seen (fresh process), memory wins for live counters.
  const persisted = db ? await loadServiceStates(db) : new Map<SentinelServiceId, ServiceState>();
  const events: SentinelPassResult["events"] = [];
  const nextStates: ServiceState[] = [];

  await Promise.all(
    SENTINEL_SERVICE_IDS.map(async (serviceId) => {
      let probe: ProbeResult;
      try {
        probe = await probeMap[serviceId]();
      } catch (err) {
        probe = {
          ok: false,
          latencyMs: null,
          detail: err instanceof Error ? err.message : "probe threw",
        };
      }

      const prev =
        memoryStates.get(serviceId) ??
        persisted.get(serviceId) ??
        initialServiceState(serviceId);
      const transition = evaluateTransition(serviceId, prev, probe, now);

      let state = transition.state;
      for (const event of transition.events) {
        state = await handleEvent(db, serviceId, state, probe, event);
        events.push({ serviceId, event });
      }

      memoryStates.set(serviceId, state);
      await saveServiceState(db, state);
      nextStates.push(state);
    }),
  );

  if (db) {
    lastIncidents = await loadRecentIncidents(db, 20);
  }
  lastPassAt = now;

  return { passAt: now, states: nextStates, events, persisted: !!db };
}

/** Test hook — clears in-memory Sentinel state between cases. */
export function _resetSentinelForTests(): void {
  memoryStates.clear();
  lastIncidents = [];
  lastPassAt = null;
  passInFlight = false;
}

function overallFrom(states: ServiceState[]): SentinelSnapshot["overall"] {
  const applicable = states.filter((s) => s.level !== "unknown");
  if (applicable.length === 0) return "unknown";
  if (applicable.some((s) => s.level === "down")) return "critical";
  if (applicable.some((s) => s.level === "degraded")) return "degraded";
  return "healthy";
}

/** Snapshot for the owner API. Uses in-memory state; loads DB
 *  incidents fresh when a client is provided. */
export async function getSentinelSnapshot(
  client?: SupabaseClient | null,
): Promise<SentinelSnapshot> {
  const db = client === undefined ? getSupabaseAdmin() : client;

  // Cold start (no pass yet): seed from persisted states so the API
  // isn't empty after a deploy until the first interval fires.
  if (memoryStates.size === 0 && db) {
    const persisted = await loadServiceStates(db);
    for (const [id, state] of persisted) memoryStates.set(id, state);
  }

  const states = SENTINEL_SERVICE_IDS.map(
    (id) => memoryStates.get(id) ?? initialServiceState(id),
  );

  const incidents = db ? await loadRecentIncidents(db, 20) : lastIncidents;
  const openIncidents = incidents.filter((i) => i.state === "open");

  return {
    generatedAt: new Date().toISOString(),
    overall: overallFrom(states),
    services: states.map((s) => ({
      serviceId: s.serviceId,
      label: SERVICE_LABELS[s.serviceId],
      level: s.level,
      detail: s.detail,
      latencyMs: s.lastLatencyMs,
      lastCheckedAt: s.lastCheckedAt,
      consecutiveFailures: s.consecutiveFailures,
    })),
    openIncidents,
    recentIncidents: incidents,
    lastPassAt,
  };
}
