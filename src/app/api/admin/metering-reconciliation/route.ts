// Admin metering reconciliation — READ-ONLY JSON report.
//
// Aggregates canonical metering over the trailing window (default 30d),
// computed in JS so it does not depend on the metering reconciliation SQL
// migration being applied. Grain: one row per UTC day x plan x capability.
//
// P0 invariant (Larry): per logical action there are N cost_events (one
// per provider attempt) but exactly ONE billable usage_event
// (billable=true). Failed attempts are recorded billable=false.
// The report therefore distinguishes:
//   providerCostMicros — SUM over cost_events (LiTT's REAL cost, every attempt)
//   chargedBits        — SUM over credit_ledger debits behind BILLABLE
//                        usage_events only (customer consumption)
//   multiBillableActions — per-bucket count of logical actions
//                        (original_request_id) with MORE THAN ONE billable
//                        usage_event — a P0 invariant violation.
// marginMicrosModeled values charged bits at the $1/1K-bit PRICING MODEL
// (1 bit = 1000 micros) — modeled, never exposed as fact.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminSupabase } from "@/lib/supabase-admin";

const ADMIN_USER_ID = process.env.ADMIN_CLERK_ID || process.env.ADMIN_USER_ID || "";

const WINDOW_DAYS = 30;
const PAGE = 5000;

export interface MeteringReconciliationRow {
  day: string;
  plan: string;
  capability: string;
  usageEvents: number;
  billableUsageEvents: number;
  costEvents: number;
  /** SUM over cost_events (all attempts) — LiTT's real cost. */
  providerCostMicros: number;
  /** SUM over ledger debits behind billable events — customer consumption. */
  chargedBits: number;
  /** Charged bits at $1/1K-bit PRICING MODEL minus provider cost (micros). */
  marginMicrosModeled: number;
  /** Distinct original_request_ids with >1 billable event (P0 violation). */
  multiBillableActions: number;
  p0Violation: boolean;
}

type UsageEventRow = {
  usage_event_id: string;
  user_id: string | null;
  capability: string | null;
  billable: boolean | null;
  original_request_id: string | null;
  created_at: string;
};

async function fetchAll<T>(
  // Supabase's query builder is thenable (PromiseLike), not a real Promise.
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await fetchPage(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId || userId !== ADMIN_USER_ID) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sb = getAdminSupabase();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  try {
    const events = await fetchAll<UsageEventRow>((from, to) =>
      sb
        .from("usage_events")
        .select("usage_event_id, user_id, capability, billable, original_request_id, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .range(from, to)
        .then((r) => ({ data: r.data, error: r.error })),
    );

    // Plan per user: latest active/trialing subscription, else 'starter'.
    const plans = new Map<string, string>();
    if (events.some((e) => e.user_id)) {
      const subs = await fetchAll<{ user_id: string; plan: string | null; status: string | null; updated_at: string | null }>(
        (from, to) =>
          sb
            .from("subscriptions")
            .select("user_id, plan, status, updated_at")
            .in("status", ["active", "trialing"])
            .order("updated_at", { ascending: false, nullsFirst: false })
            .range(from, to)
            .then((r) => ({ data: r.data, error: r.error })),
      );
      for (const s of subs) {
        if (s.user_id && !plans.has(s.user_id)) {
          plans.set(s.user_id, s.plan && s.plan.trim() ? s.plan : "starter");
        }
      }
    }

    const eventIds = events.map((e) => e.usage_event_id);
    const costByEvent = new Map<string, { micros: number; count: number }>();
    const chargedByEvent = new Map<string, number>();
    if (eventIds.length > 0) {
      for (const ids of chunk(eventIds, 500)) {
        const [{ data: costs, error: costErr }, { data: charges, error: chargeErr }] =
          await Promise.all([
            sb.from("cost_events").select("usage_event_id, provider_cost_micros").in("usage_event_id", ids),
            sb
              .from("credit_ledger")
              .select("usage_event_id, amount, direction")
              .in("usage_event_id", ids)
              .eq("direction", "debit"),
          ]);
        if (costErr) throw costErr;
        if (chargeErr) throw chargeErr;
        for (const c of (costs ?? []) as { usage_event_id: string; provider_cost_micros: number | null }[]) {
          const agg = costByEvent.get(c.usage_event_id) ?? { micros: 0, count: 0 };
          agg.micros += Number(c.provider_cost_micros ?? 0);
          agg.count += 1;
          costByEvent.set(c.usage_event_id, agg);
        }
        for (const l of (charges ?? []) as { usage_event_id: string; amount: number | null }[]) {
          chargedByEvent.set(l.usage_event_id, (chargedByEvent.get(l.usage_event_id) ?? 0) + Number(l.amount ?? 0));
        }
      }
    }

    // Aggregate: day x plan x capability.
    const buckets = new Map<string, MeteringReconciliationRow>();
    const billableKeys = new Map<string, Map<string, number>>(); // bucket -> original_request_id -> billable count
    for (const e of events) {
      const day = new Date(e.created_at).toISOString().slice(0, 10);
      const plan = (e.user_id && plans.get(e.user_id)) || "starter";
      const capability = e.capability || "unknown";
      const key = `${day}||${plan}||${capability}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          day, plan, capability,
          usageEvents: 0, billableUsageEvents: 0, costEvents: 0,
          providerCostMicros: 0, chargedBits: 0, marginMicrosModeled: 0,
          multiBillableActions: 0, p0Violation: false,
        };
        buckets.set(key, b);
      }
      b.usageEvents += 1;
      if (e.billable) {
        b.billableUsageEvents += 1;
        b.chargedBits += chargedByEvent.get(e.usage_event_id) ?? 0;
        if (e.original_request_id) {
          let m = billableKeys.get(key);
          if (!m) { m = new Map(); billableKeys.set(key, m); }
          m.set(e.original_request_id, (m.get(e.original_request_id) ?? 0) + 1);
        }
      }
      const cost = costByEvent.get(e.usage_event_id);
      if (cost) {
        b.costEvents += cost.count;
        b.providerCostMicros += cost.micros;
      }
    }

    let p0Violations = 0;
    for (const [key, counts] of billableKeys) {
      let multi = 0;
      for (const n of counts.values()) if (n > 1) multi += 1;
      const b = buckets.get(key);
      if (b && multi > 0) {
        b.multiBillableActions = multi;
        b.p0Violation = true;
        p0Violations += multi;
      }
    }

    const rows = [...buckets.values()].sort((a, b2) =>
      a.day === b2.day ? (a.plan === b2.plan ? a.capability.localeCompare(b2.capability) : a.plan.localeCompare(b2.plan)) : a.day.localeCompare(b2.day),
    );
    for (const r of rows) {
      // $1/1K-bit PRICING MODEL (1 bit = 1000 micros) — modeled, not fact.
      r.marginMicrosModeled = r.chargedBits * 1000 - r.providerCostMicros;
    }

    const totals = rows.reduce(
      (t, r) => ({
        usageEvents: t.usageEvents + r.usageEvents,
        billableUsageEvents: t.billableUsageEvents + r.billableUsageEvents,
        costEvents: t.costEvents + r.costEvents,
        providerCostMicros: t.providerCostMicros + r.providerCostMicros,
        chargedBits: t.chargedBits + r.chargedBits,
        marginMicrosModeled: t.marginMicrosModeled + r.marginMicrosModeled,
      }),
      { usageEvents: 0, billableUsageEvents: 0, costEvents: 0, providerCostMicros: 0, chargedBits: 0, marginMicrosModeled: 0 },
    );

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      windowDays: WINDOW_DAYS,
      rows,
      totals,
      p0Violations,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
