/**
 * Sentinel → repair pipeline bridge.
 *
 * Critical incidents become `sentinel_repair_candidates` rows —
 * proposed engineering repair jobs that an operator or agent picks
 * up. This module NEVER executes code, never calls `litt repair`, and
 * never touches production. It only records, deduplicates, budgets,
 * and audits the lifecycle.
 *
 * Lifecycle (all transitions owner/agent-driven except 'proposed'):
 *   proposed → approved → running → pr_open → resolved
 *                    ↘ rejected / cancelled / failed
 *
 * Guards (P1 requirements):
 *   - Duplicate prevention: unique partial index on
 *     (service_id, signature) for in-flight states + a pre-check.
 *   - Max retries: attempt_count < max_attempts (default 3).
 *   - Cooldown: after a failed/cancelled candidate, the same signature
 *     cannot re-propose until cooldown_until passes (default 24h).
 *   - Budget: budget_units capped at max_budget_units; every
 *     transition increments it — runaway loops hit the cap.
 *   - Cancellation: 'cancelled' is terminal and always allowed.
 *   - Audit: every transition appends {at, from, to, actor, note}.
 *   - No recursion: candidates never create incidents or other
 *     candidates; Sentinel only proposes, never approves.
 *   - Injection safety: summary/diagnostics are stored as DATA.
 *     Nothing in this pipeline is ever interpolated into a shell
 *     command, eval'd, or sent to a model as instructions.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SentinelServiceId } from "./types";

export type RepairCandidateState =
  | "proposed"
  | "approved"
  | "running"
  | "pr_open"
  | "resolved"
  | "rejected"
  | "cancelled"
  | "failed";

export interface RepairCandidate {
  id: string;
  incidentId: string | null;
  serviceId: SentinelServiceId;
  signature: string;
  state: RepairCandidateState;
  severity: "warning" | "critical";
  summary: string;
  diagnostics: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  cooldownUntil: string | null;
  budgetUnits: number;
  maxBudgetUnits: number;
  prUrl: string | null;
  audit: { at: string; from: string | null; to: string; actor: string; note?: string }[];
  createdAt: string;
  updatedAt: string;
}

const IN_FLIGHT: RepairCandidateState[] = ["proposed", "approved", "running", "pr_open"];

/** Allowed transitions. 'proposed' can only be approved/rejected/cancelled. */
const TRANSITIONS: Record<RepairCandidateState, RepairCandidateState[]> = {
  proposed: ["approved", "rejected", "cancelled"],
  approved: ["running", "cancelled", "rejected"],
  running: ["pr_open", "failed", "cancelled"],
  pr_open: ["resolved", "failed", "cancelled"],
  resolved: [],
  rejected: [],
  cancelled: [],
  failed: [],
};

export const REPAIR_COOLDOWN_MS = 24 * 60 * 60_000;

/** Deterministic dedup signature for an incident class. */
export function repairSignature(serviceId: SentinelServiceId, detail: string): string {
  const normalized = detail.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
  return createHash("sha256").update(`${serviceId}|${normalized}`).digest("hex").slice(0, 16);
}

/** Strip anything that looks like a credential from diagnostic text. */
export function sanitizeDiagnosticText(input: string): string {
  return input
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .replace(/(api[_-]?key|token|secret|password|authorization)[=:]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 500);
}

interface CandidateRow {
  id: string;
  incident_id: string | null;
  service_id: string;
  signature: string;
  state: string;
  severity: string;
  summary: string;
  diagnostics: Record<string, unknown> | null;
  attempt_count: number;
  max_attempts: number;
  cooldown_until: string | null;
  budget_units: number;
  max_budget_units: number;
  pr_url: string | null;
  audit: RepairCandidate["audit"] | null;
  created_at: string;
  updated_at: string;
}

function rowToCandidate(row: CandidateRow): RepairCandidate {
  return {
    id: row.id,
    incidentId: row.incident_id,
    serviceId: row.service_id as SentinelServiceId,
    signature: row.signature,
    state: row.state as RepairCandidateState,
    severity: row.severity as RepairCandidate["severity"],
    summary: row.summary,
    diagnostics: row.diagnostics ?? {},
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    cooldownUntil: row.cooldown_until,
    budgetUnits: row.budget_units,
    maxBudgetUnits: row.max_budget_units,
    prUrl: row.pr_url,
    audit: Array.isArray(row.audit) ? row.audit : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Propose a repair candidate for a critical incident. Returns the
 * candidate id, or null when suppressed (duplicate in-flight,
 * cooldown, attempt/budget cap, or DB unavailable).
 */
export async function proposeRepairCandidate(
  client: SupabaseClient | null,
  input: {
    incidentId: string | null;
    serviceId: SentinelServiceId;
    severity: "warning" | "critical";
    summary: string;
    detail: string;
    diagnostics?: Record<string, unknown>;
  },
): Promise<string | null> {
  // Repairs are only proposed for critical incidents — warnings are
  // operator-attention items, not engineering jobs.
  if (input.severity !== "critical" || !client) return null;

  const signature = repairSignature(input.serviceId, input.detail || input.summary);
  const now = new Date();

  try {
    // Dedup: an in-flight candidate with the same signature already
    // covers this incident class.
    const { data: inflight } = await client
      .from("sentinel_repair_candidates")
      .select("id")
      .eq("service_id", input.serviceId)
      .eq("signature", signature)
      .in("state", IN_FLIGHT)
      .limit(1);
    if (inflight && inflight.length > 0) return null;

    // Cooldown + attempt cap: look at the most recent candidate for
    // this signature regardless of state.
    const { data: recent } = await client
      .from("sentinel_repair_candidates")
      .select("*")
      .eq("service_id", input.serviceId)
      .eq("signature", signature)
      .order("created_at", { ascending: false })
      .limit(1);
    const last = (recent?.[0] as CandidateRow | undefined) ?? null;
    if (last) {
      if (last.cooldown_until && Date.parse(last.cooldown_until) > now.getTime()) return null;
      if (last.attempt_count >= last.max_attempts) return null;
      if (last.budget_units >= last.max_budget_units) return null;
    }

    const diagnostics = {
      ...(input.diagnostics ?? {}),
      detail: sanitizeDiagnosticText(input.detail),
      summary: sanitizeDiagnosticText(input.summary).slice(0, 300),
      capturedAt: now.toISOString(),
      // Injection guard marker: consumers must treat these fields as
      // data, never as instructions.
      untrusted: true,
    };

    const { data, error } = await client
      .from("sentinel_repair_candidates")
      .insert({
        incident_id: input.incidentId,
        service_id: input.serviceId,
        signature,
        state: "proposed",
        severity: input.severity,
        summary: sanitizeDiagnosticText(input.summary).slice(0, 300),
        diagnostics,
        attempt_count: 0,
        max_attempts: 3,
        budget_units: 0,
        max_budget_units: 10,
        audit: [{ at: now.toISOString(), from: null, to: "proposed", actor: "sentinel" }],
      })
      .select("id")
      .single();

    if (error || !data) return null; // unique-index race → duplicate suppressed
    return String((data as { id: string }).id);
  } catch {
    return null;
  }
}

/**
 * Transition a candidate. Enforces the state machine, attempt cap,
 * budget cap, cooldown-on-fail, and appends an audit entry.
 * Returns the new state, or null when the transition is illegal.
 */
export async function transitionRepairCandidate(
  client: SupabaseClient | null,
  candidateId: string,
  to: RepairCandidateState,
  actor: string,
  note?: string,
): Promise<RepairCandidateState | null> {
  if (!client) return null;
  try {
    const { data } = await client
      .from("sentinel_repair_candidates")
      .select("*")
      .eq("id", candidateId)
      .maybeSingle();
    const row = data as CandidateRow | null;
    if (!row) return null;
    const from = row.state as RepairCandidateState;
    if (!TRANSITIONS[from]?.includes(to)) return null;
    if (row.budget_units >= row.max_budget_units && to !== "cancelled") return null;

    const now = new Date().toISOString();
    const audit = [
      ...((Array.isArray(row.audit) ? row.audit : []) as RepairCandidate["audit"]),
      { at: now, from, to, actor, ...(note ? { note: sanitizeDiagnosticText(note) } : {}) },
    ];

    const patch: Record<string, unknown> = {
      state: to,
      audit,
      budget_units: row.budget_units + 1,
      updated_at: now,
    };
    if (to === "running" || to === "pr_open") {
      patch.attempt_count = row.attempt_count + 1;
    }
    if (to === "failed" || to === "cancelled") {
      // Cooldown before the same signature may be proposed again.
      patch.cooldown_until = new Date(Date.now() + REPAIR_COOLDOWN_MS).toISOString();
    }
    if (to === "resolved" || to === "rejected") {
      patch.cooldown_until = null;
    }

    const { error } = await client
      .from("sentinel_repair_candidates")
      .update(patch)
      .eq("id", candidateId)
      .eq("state", from); // optimistic concurrency — lose gracefully
    if (error) return null;
    return to;
  } catch {
    return null;
  }
}

export async function loadRepairCandidates(
  client: SupabaseClient | null,
  limit = 20,
): Promise<RepairCandidate[]> {
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("sentinel_repair_candidates")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as CandidateRow[]).map(rowToCandidate);
  } catch {
    return [];
  }
}
