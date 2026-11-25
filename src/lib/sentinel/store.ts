/**
 * Sentinel persistence — Supabase-backed service status and incident
 * log. Every function degrades gracefully: when the migration has not
 * been applied yet (or the DB is unreachable) the in-memory state in
 * run.ts still works and the API still reports live probe results.
 *
 * Tables (supabase/migrations/20261125120000_sentinel.sql):
 *   sentinel_service_status — one row per service, upserted each pass
 *   sentinel_incidents      — open/resolved incident history
 *
 * RLS is enabled with no public policies: only the service role
 * (getSupabaseAdmin) can read/write.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SentinelIncident, SentinelServiceId, ServiceState } from "./types";

export interface StatusRow {
  service_id: string;
  level: string;
  consecutive_failures: number;
  consecutive_successes: number;
  last_checked_at: string | null;
  last_change_at: string | null;
  last_latency_ms: number | null;
  detail: string;
  open_incident_id: string | null;
}

export function stateToRow(state: ServiceState): StatusRow {
  return {
    service_id: state.serviceId,
    level: state.level,
    consecutive_failures: state.consecutiveFailures,
    consecutive_successes: state.consecutiveSuccesses,
    last_checked_at: state.lastCheckedAt,
    last_change_at: state.lastChangeAt,
    last_latency_ms: state.lastLatencyMs,
    detail: state.detail.slice(0, 500),
    open_incident_id: state.openIncidentId,
  };
}

export function rowToState(row: StatusRow): ServiceState {
  return {
    serviceId: row.service_id as SentinelServiceId,
    level: (row.level as ServiceState["level"]) ?? "unknown",
    consecutiveFailures: row.consecutive_failures ?? 0,
    consecutiveSuccesses: row.consecutive_successes ?? 0,
    lastCheckedAt: row.last_checked_at,
    lastChangeAt: row.last_change_at,
    lastLatencyMs: row.last_latency_ms,
    detail: row.detail ?? "",
    openIncidentId: row.open_incident_id,
  };
}

function rowToIncident(row: Record<string, unknown>): SentinelIncident {
  return {
    id: String(row.id),
    serviceId: row.service_id as SentinelServiceId,
    severity: (row.severity as SentinelIncident["severity"]) ?? "warning",
    state: (row.state as SentinelIncident["state"]) ?? "open",
    summary: String(row.summary ?? ""),
    detail: String(row.detail ?? ""),
    remediation: Array.isArray(row.remediation) ? (row.remediation as string[]) : [],
    openedAt: String(row.opened_at ?? ""),
    resolvedAt: (row.resolved_at as string | null) ?? null,
  };
}

/** Load persisted service states. Returns empty map on any failure. */
export async function loadServiceStates(
  client: SupabaseClient,
): Promise<Map<SentinelServiceId, ServiceState>> {
  const map = new Map<SentinelServiceId, ServiceState>();
  try {
    const { data, error } = await client
      .from("sentinel_service_status")
      .select("*");
    if (error || !data) return map;
    for (const row of data as StatusRow[]) {
      map.set(row.service_id as SentinelServiceId, rowToState(row));
    }
  } catch {
    // Table may not exist yet — in-memory state takes over.
  }
  return map;
}

/** Upsert one service's status row. Best-effort. */
export async function saveServiceState(
  client: SupabaseClient | null,
  state: ServiceState,
): Promise<void> {
  if (!client) return;
  try {
    await client
      .from("sentinel_service_status")
      .upsert(stateToRow(state), { onConflict: "service_id" });
  } catch {
    // Non-fatal — next pass retries.
  }
}

/**
 * Find the currently open incident for a service, if one exists.
 * Returns null on any failure (caller treats as "no known incident").
 */
export async function findOpenIncidentId(
  client: SupabaseClient | null,
  serviceId: SentinelServiceId,
): Promise<string | null> {
  if (!client) return null;
  try {
    const { data, error } = await client
      .from("sentinel_incidents")
      .select("id")
      .eq("service_id", serviceId)
      .eq("state", "open")
      .order("opened_at", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return String((data[0] as { id: string }).id);
  } catch {
    return null;
  }
}

export async function openIncident(
  client: SupabaseClient | null,
  incident: {
    serviceId: SentinelServiceId;
    severity: "warning" | "critical";
    summary: string;
    detail: string;
    remediation: string[];
  },
): Promise<string | null> {
  if (!client) return null;
  try {
    const { data, error } = await client
      .from("sentinel_incidents")
      .insert({
        service_id: incident.serviceId,
        severity: incident.severity,
        state: "open",
        summary: incident.summary.slice(0, 500),
        detail: incident.detail.slice(0, 2000),
        remediation: incident.remediation,
      })
      .select("id")
      .single();
    if (error || !data) return null;
    return String((data as { id: string }).id);
  } catch {
    return null;
  }
}

export async function resolveIncident(
  client: SupabaseClient | null,
  incidentId: string,
): Promise<void> {
  if (!client) return;
  try {
    await client
      .from("sentinel_incidents")
      .update({ state: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", incidentId)
      .eq("state", "open");
  } catch {
    // Non-fatal.
  }
}

/** Recent incidents for the owner API (open first, then latest). */
export async function loadRecentIncidents(
  client: SupabaseClient | null,
  limit = 20,
): Promise<SentinelIncident[]> {
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("sentinel_incidents")
      .select("*")
      .order("opened_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(rowToIncident);
  } catch {
    return [];
  }
}
