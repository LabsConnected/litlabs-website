/**
 * Sentinel leader election — single-writer lease in Supabase.
 *
 * Multiple app replicas each run the Sentinel interval, but only the
 * lease holder executes probe passes. That prevents duplicate probes
 * (and their cost), duplicate alerts, and double-counted failure
 * streaks across replicas.
 *
 * Lease semantics:
 *   - holder_id is a random per-process id.
 *   - A pass may run while leased_until > now() for THIS holder, or
 *     when the lease is free/expired.
 *   - Acquire = upsert with a check-then-write; the partial unique
 *     nature of a single 'leader' row makes the last writer win, so
 *     acquisition re-reads to confirm it holds the lease.
 *   - Lease TTL is 3× the probe interval — a crashed leader's lease
 *     expires and another replica takes over without human action.
 *
 * When the sentinel_leader table does not exist yet (migration not
 * applied) acquisition reports "unmanaged" and the caller runs the
 * pass anyway — pre-migration behavior, single-process assumption.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const LEADER_LEASE_TTL_MS = 3 * 60_000;
const LEADER_ROW_ID = "leader";

export type LeaseResult =
  | { kind: "acquired"; holder: string }
  | { kind: "held-by-other" }
  | { kind: "unmanaged" };

const holderId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sentinel-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function sentinelHolderId(): string {
  return holderId;
}

interface LeaderRow {
  holder: string;
  leased_until: string;
}

/**
 * Attempt to acquire (or renew) the Sentinel leader lease.
 * Returns "unmanaged" when the table is missing so callers can fall
 * back to running without coordination.
 */
export async function acquireLeaderLease(
  client: SupabaseClient | null,
): Promise<LeaseResult> {
  if (!client) return { kind: "unmanaged" };
  const now = Date.now();
  const leasedUntil = new Date(now + LEADER_LEASE_TTL_MS).toISOString();

  try {
    // Fast path: we already hold a live lease — renew it.
    const { data: existing } = await client
      .from("sentinel_leader")
      .select("holder, leased_until")
      .eq("id", LEADER_ROW_ID)
      .maybeSingle();

    const row = existing as LeaderRow | null;
    const leaseLive = row && Date.parse(row.leased_until) > now;

    if (leaseLive && row!.holder === holderId) {
      await client
        .from("sentinel_leader")
        .update({ leased_until: leasedUntil, updated_at: new Date(now).toISOString() })
        .eq("id", LEADER_ROW_ID);
      return { kind: "acquired", holder: holderId };
    }
    if (leaseLive) {
      return { kind: "held-by-other" };
    }

    // Lease free or expired — claim it, then re-read to confirm we won
    // (another replica may have raced us; last writer wins the row).
    await client.from("sentinel_leader").upsert(
      { id: LEADER_ROW_ID, holder: holderId, leased_until: leasedUntil, updated_at: new Date(now).toISOString() },
      { onConflict: "id" },
    );

    const { data: confirm } = await client
      .from("sentinel_leader")
      .select("holder")
      .eq("id", LEADER_ROW_ID)
      .maybeSingle();

    const winner = (confirm as { holder: string } | null)?.holder;
    if (winner === holderId) return { kind: "acquired", holder: holderId };
    return { kind: "held-by-other" };
  } catch {
    // Table missing (42P01) or DB unreachable — run unmanaged rather
    // than silence monitoring entirely.
    return { kind: "unmanaged" };
  }
}
