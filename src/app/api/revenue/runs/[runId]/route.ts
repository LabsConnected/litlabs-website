import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getRun } from "@/lib/revenue/agent-runs";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
) {
  const { clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await ctx.params;

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  const run = await getRun(runId, user.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Also fetch pending approvals
  const { data: approvals } = await supabaseAdmin
    .from("revenue_agent_approvals")
    .select("*")
    .eq("run_id", runId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ run, approvals: approvals ?? [] });
}