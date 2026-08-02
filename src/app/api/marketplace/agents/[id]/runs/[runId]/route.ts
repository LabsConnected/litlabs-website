// Get a single revenue agent run by ID.
//
// GET /api/marketplace/agents/[id]/runs/[runId]
//
// Returns the run state, plan, files changed, preview, deployment,
// and approval status. Only the run owner can access it.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRun } from "@/lib/revenue/agent-runs";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string }> },
) {
  const { clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await ctx.params;

  // Resolve internal user to verify ownership
  const { supabaseAdmin } = await import("@/lib/supabase");
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

  return NextResponse.json(run);
}
