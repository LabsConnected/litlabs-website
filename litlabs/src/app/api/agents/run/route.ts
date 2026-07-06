import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const agentName = String(body.agentName || "");
  const task = String(body.task || "");

  if (!agentName || !task) {
    return NextResponse.json({ error: "Missing agentName or task" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ queued: true, id: randomUUID(), note: "Supabase not configured, agent task logged locally" });
  }

  const { data, error } = await admin
    .from("active_tasks")
    .insert({
      user_id: userId,
      task_type: agentName,
      status: "queued",
      input: task,
      result: {},
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ queued: true, id: data.id });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ runs: [] });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || 20), 100);

  const { data, error } = await admin
    .from("active_tasks")
    .select("id, task_type, status, input, result, error, created_at, completed_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const runs = (data || []).map((row) => ({
    id: row.id,
    agent_name: row.task_type,
    task: row.input,
    status: row.status,
    logs: row.error || row.result || null,
    created_at: row.created_at,
    updated_at: row.completed_at,
  }));

  return NextResponse.json({ runs });
}
