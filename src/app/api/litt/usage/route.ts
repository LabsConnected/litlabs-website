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

  // Get current wallet balance
  const { data: wallet } = await supabaseAdmin
    .from("wallets")
    .select("balance, currency")
    .eq("user_id", user.id)
    .maybeSingle();

  // Get recent credit ledger entries
  const { data: recentTransactions } = await supabaseAdmin
    .from("credit_ledger")
    .select("*")
    .eq("user_id", user.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);

  // Get model usage stats from model_usage (if table exists)
  const { data: modelStats } = await supabaseAdmin
    .from("model_usage")
    .select("litt_alias, model, provider, total_tokens, credits_cost, success")
    .eq("user_id", user.id)
    .gte("called_at", since);

  // Aggregate by model
  const byModel = new Map<string, { calls: number; tokens: number; credits: number; successes: number }>();
  for (const stat of modelStats ?? []) {
    const key = stat.litt_alias ?? stat.model ?? "unknown";
    const existing = byModel.get(key) ?? { calls: 0, tokens: 0, credits: 0, successes: 0 };
    existing.calls += 1;
    existing.tokens += stat.total_tokens ?? 0;
    existing.credits += stat.credits_cost ?? 0;
    if (stat.success) existing.successes += 1;
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

  const totalCreditsUsed = (recentTransactions ?? [])
    .filter((t) => t.type === "debit" || t.type === "charge")
    .reduce((sum, t) => sum + (t.amount ?? 0), 0);

  const totalCreditsRefunded = (recentTransactions ?? [])
    .filter((t) => t.type === "refund" || t.type === "credit")
    .reduce((sum, t) => sum + (t.amount ?? 0), 0);

  return NextResponse.json({
    balance: wallet?.balance ?? 0,
    currency: wallet?.currency ?? "LiTTBits",
    range,
    summary: {
      totalCreditsUsed,
      totalCreditsRefunded,
      totalRuns: recentRuns?.length ?? 0,
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
      type: t.type,
      amount: t.amount,
      description: t.description,
      createdAt: t.created_at,
    })),
  });
}
