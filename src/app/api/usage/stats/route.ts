import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { isAdmin } from "@/lib/roles";
import { checkUsageLimit } from "@/lib/usage";

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

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin();
  const usage = await checkUsageLimit(userId);

  if (!isAdminSupabaseConfigured()) {
    // Return demo data when Supabase isn't configured
    const buckets = buildEmptyBuckets(14);
    buckets.forEach((b, i) => {
      b.commands = Math.floor(Math.random() * 30) + 5 + i;
      b.agentTasks = Math.floor(Math.random() * 10) + 1;
      b.generations = Math.floor(Math.random() * 8);
    });
    return NextResponse.json({
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
    });
  }

  const sb = getAdminSupabase();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const buckets = buildEmptyBuckets(14);

  const [cmdRes, taskRes, genRes] = await Promise.all([
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

  bucketize(cmdRes.data, buckets, "commands");
  bucketize(taskRes.data, buckets, "agentTasks");
  bucketize(genRes.data, buckets, "generations");

  const totalCommands = buckets.reduce((s, b) => s + b.commands, 0);
  const totalAgentTasks = buckets.reduce((s, b) => s + b.agentTasks, 0);
  const totalGenerations = buckets.reduce((s, b) => s + b.generations, 0);

  return NextResponse.json({
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
  });
}
