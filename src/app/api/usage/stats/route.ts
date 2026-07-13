import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { isAdmin } from "@/lib/roles";
import { checkUsageLimit } from "@/lib/usage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface DailyBucket {
  date: string;
  commands: number;
  agentTasks: number;
  generations: number;
}

function buildEmptyBuckets(days: number): DailyBucket[] {
  const buckets: DailyBucket[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    buckets.push({
      date: d.toISOString().slice(0, 10),
      commands: 0,
      agentTasks: 0,
      generations: 0,
    });
  }
  return buckets;
}

function bucketize(
  rows: { created_at: string }[] | null,
  buckets: DailyBucket[],
  field: keyof DailyBucket,
) {
  if (!rows) return;
  const map = new Map(buckets.map((b) => [b.date, b]));
  for (const row of rows) {
    const day = (row.created_at || "").slice(0, 10);
    const bucket = map.get(day);
    if (bucket) (bucket[field] as number) += 1;
  }
}

/**
 * GET /api/usage/stats
 *
 * Returns a 14-day rolling summary of terminal commands, agent tasks,
 * and agent runs for the current user, plus hourly usage. Used by the
 * Dashboard usage panel.
 *
 * Resilience improvements vs. the prior version:
 *  - Each of the 3 Supabase queries is wrapped in its own try/catch
 *    via Promise.allSettled so a single failed table can't take down
 *    the whole response — partial data is better than no data.
 *  - No data + a configured Supabase yields a `partial: true` flag so
 *    the UI can show a "limited data" hint.
 *  - `dynamic = "force-dynamic"` makes auth() resolve at request time
 *    (it was already implicit, but explicit is safer across runtimes).
 *  - Short Cache-Control header prevents stale usage between requests.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin();
  const usage = await checkUsageLimit(userId);

  // Demo data path — when Supabase isn't configured, return plausible
  // sample buckets so the UI can still render.
  if (!isAdminSupabaseConfigured()) {
    const buckets = buildEmptyBuckets(14);
    buckets.forEach((b, i) => {
      b.commands = Math.floor(Math.random() * 30) + 5 + i;
      b.agentTasks = Math.floor(Math.random() * 10) + 1;
      b.generations = Math.floor(Math.random() * 8);
    });
    return NextResponse.json(
      {
        summary: {
          totalCommands: buckets.reduce((s, b) => s + b.commands, 0),
          totalAgentTasks: buckets.reduce((s, b) => s + b.agentTasks, 0),
          totalGenerations: buckets.reduce((s, b) => s + b.generations, 0),
          hourlyUsed: admin ? 0 : usage.used,
          hourlyLimit: admin ? Infinity : usage.limit,
          role: admin ? "admin" : "user",
          plan: admin ? "Admin" : "Free",
        },
        daily: buckets,
        demo: true,
        partial: false,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  }

  const sb = getAdminSupabase();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const buckets = buildEmptyBuckets(14);

  // Run all three queries independently so a failure in one table
  // doesn't kill the whole panel.
  const [cmdRes, taskRes, genRes] = await Promise.allSettled([
    sb
      .from("terminal_command_history")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", since),
    sb
      .from("agent_tasks")
      .select("created_at")
      .eq("owner_id", userId)
      .gte("created_at", since),
    sb
      .from("agent_runs")
      .select("created_at")
      .eq("owner_id", userId)
      .gte("created_at", since),
  ]);

  const failed: string[] = [];
  if (cmdRes.status === "fulfilled") {
    bucketize(cmdRes.value.data, buckets, "commands");
    if (cmdRes.value.error) failed.push("terminal_command_history");
  } else {
    console.error("usage/stats: terminal_command_history failed:", cmdRes.reason);
    failed.push("terminal_command_history");
  }
  if (taskRes.status === "fulfilled") {
    bucketize(taskRes.value.data, buckets, "agentTasks");
    if (taskRes.value.error) failed.push("agent_tasks");
  } else {
    console.error("usage/stats: agent_tasks failed:", taskRes.reason);
    failed.push("agent_tasks");
  }
  if (genRes.status === "fulfilled") {
    bucketize(genRes.value.data, buckets, "generations");
    if (genRes.value.error) failed.push("agent_runs");
  } else {
    console.error("usage/stats: agent_runs failed:", genRes.reason);
    failed.push("agent_runs");
  }

  const totalCommands = buckets.reduce((s, b) => s + b.commands, 0);
  const totalAgentTasks = buckets.reduce((s, b) => s + b.agentTasks, 0);
  const totalGenerations = buckets.reduce((s, b) => s + b.generations, 0);

  return NextResponse.json(
    {
      summary: {
        totalCommands,
        totalAgentTasks,
        totalGenerations,
        hourlyUsed: admin ? 0 : usage.used,
        hourlyLimit: admin ? Infinity : usage.limit,
        role: admin ? "admin" : "user",
        plan: admin ? "Admin" : "Free",
      },
      daily: buckets,
      demo: false,
      partial: failed.length > 0,
      failedSources: failed,
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    },
  );
}
