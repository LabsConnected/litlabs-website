import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/litt/usage
 *
 * Returns the user's LiTTBits usage summary: current balance,
 * recent credit transactions, and model usage stats.
 *
 * Query params:
 *   range — "day" | "week" | "month" (default: week)
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  // Resolve internal user ID
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", userId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const range = request.nextUrl.searchParams.get("range") ?? "week";
  const days = range === "day" ? 1 : range === "month" ? 30 : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Get current balance — credit_ledger is the authoritative system;
  // the legacy wallets table is not a balance source.
  const { data: balancesRaw } = await supabaseAdmin.rpc("get_user_balances", {
    p_user_id: user.id,
  });
  const balances = (Array.isArray(balancesRaw) ? balancesRaw[0] : balancesRaw) as
    | { total?: number }
    | undefined;

  // Get recent credit ledger entries
  const { data: recentTransactions } = await supabaseAdmin
    .from("credit_ledger")
    .select("*")
    .eq("user_id", user.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);

  // Get model usage stats from usage_events — the canonical metering store
  // written by src/lib/metering.ts (one row per user action, with model,
  // provider, and token counts). The legacy model_usage table has no writer
  // anywhere in the codebase, so aggregating it always produced zeros.
  // A usage_events row exists only for a completed user action (failed
  // provider attempts write cost_events only), so every row counts as a
  // success. usage_events carries no per-row charged-bits column, so
  // credits stays 0 — the same effective value the dead table produced;
  // actual charges live in credit_ledger (summarized above).
  const { data: modelStats } = await supabaseAdmin
    .from("usage_events")
    .select("model, provider, input_tokens, output_tokens")
    .eq("user_id", user.id)
    .gte("started_at", since);

  // Aggregate by model
  const byModel = new Map<string, { calls: number; tokens: number; credits: number; successes: number }>();
  for (const stat of modelStats ?? []) {
    const key = stat.model ?? stat.provider ?? "unknown";
    const existing = byModel.get(key) ?? { calls: 0, tokens: 0, credits: 0, successes: 0 };
    existing.calls += 1;
    existing.tokens += (stat.input_tokens ?? 0) + (stat.output_tokens ?? 0);
    existing.successes += 1;
    byModel.set(key, existing);
  }

  // Get recent agent runs
  const { data: recentRuns } = await supabaseAdmin
    .from("agent_runs")
    .select("id, status, model, provider, credits_charged, started_at, completed_at")
    .eq("user_id", user.id)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(20);

  // Studio agent runs are NOT in agent_runs: that table only gets a row
  // when a marketplace agent's credits are reserved (agent-billing.ts,
  // called from the Studio messages route only when a marketplace agent
  // instance is attached). Built-in Studio runs — the runs the Activity
  // panel shows — are durable ActionRuns in action_runs (run-store.ts),
  // created by the same messages route for every execution task. Counting
  // only agent_runs made "Agent runs" read 0 for users whose runs are all
  // Studio runs. Count both stores so the total reflects real run history.
  //
  // Identity differs per store: action_runs.user_id is TEXT holding the
  // Clerk user id — the messages route passes auth()'s userId (=== the
  // Clerk id) verbatim into action_runtime_create_run, and the column's
  // RLS compares auth.uid()::text = user_id. The internal users.id uuid
  // used for agent_runs / usage_events / credit_ledger above never
  // appears in action_runs, so counting by user.id matched zero rows for
  // every user. Key this count on the Clerk id (userId from auth()).
  const { count: actionRunCount } = await supabaseAdmin
    .from("action_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);

  // credit_ledger records direction (credit|debit) + category — the
  // previous t.type filter matched no rows, so both totals were always 0.
  const totalCreditsUsed = (recentTransactions ?? [])
    .filter((t) => t.direction === "debit")
    .reduce((sum, t) => sum + (t.amount ?? 0), 0);

  const totalCreditsRefunded = (recentTransactions ?? [])
    .filter((t) => t.direction === "credit" && t.category === "refund")
    .reduce((sum, t) => sum + (t.amount ?? 0), 0);

  return NextResponse.json({
    balance: balances?.total ?? 0,
    currency: "LiTTBits",
    range,
    summary: {
      totalCreditsUsed,
      totalCreditsRefunded,
      totalRuns: (recentRuns?.length ?? 0) + (actionRunCount ?? 0),
    },
    modelUsage: Array.from(byModel.entries()).map(([model, stats]) => ({
      model,
      calls: stats.calls,
      tokens: stats.tokens,
      credits: stats.credits,
      successRate: stats.calls > 0 ? (stats.successes / stats.calls) * 100 : 0,
    })),
    recentRuns: (recentRuns ?? []).map((r) => ({
      id: r.id,
      status: r.status,
      model: r.model,
      provider: r.provider,
      creditsCharged: r.credits_charged,
      startedAt: r.started_at,
      completedAt: r.completed_at,
    })),
    recentTransactions: (recentTransactions ?? []).map((t) => ({
      id: t.id,
      type: t.direction,
      category: t.category,
      amount: t.amount,
      description: t.description,
      createdAt: t.created_at,
    })),
  });
}
