import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/agents/run
 *
 * DEPRECATED: This endpoint has been replaced by the canonical
 * entitlement-aware, project-scoped agent-run service at:
 *   POST /api/marketplace/agents/[id]/runs
 *
 * This endpoint now:
 *   1. Authenticates the user
 *   2. Resolves the agent by name/slug
 *   3. Redirects to the canonical run-creation endpoint
 *   4. NEVER returns fake queued success when persistence is unavailable
 *
 * The old behavior (inserting into agent_runs without entitlement
 * check, project scope, or tool management) has been removed.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const agentName = String(body.agentName || body.agentSlug || "");
  const task = String(body.task || body.prompt || "");
  const projectId = String(body.projectId || "");

  if (!agentName || !task) {
    return NextResponse.json(
      { error: "Missing agentName/slug or task/prompt" },
      { status: 400 },
    );
  }

  if (!projectId) {
    return NextResponse.json(
      { error: "Project ID is required. Use /api/marketplace/agents/[id]/runs to create a project-scoped run." },
      { status: 400 },
    );
  }

  // Resolve agent by slug
  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("id, slug")
    .or(`slug.eq.${agentName},name.eq.${agentName}`)
    .eq("is_public", true)
    .maybeSingle();

  if (!agent) {
    return NextResponse.json(
      { error: `Agent '${agentName}' not found` },
      { status: 404 },
    );
  }

  // Redirect to the canonical endpoint
  return NextResponse.json({
    error: "This endpoint is deprecated. Use the canonical run-creation endpoint.",
    canonicalEndpoint: `/api/marketplace/agents/${agent.id}/runs`,
    agentId: agent.id,
    projectId,
    prompt: task,
  }, { status: 308 });
}

/**
 * GET /api/agents/run
 *
 * Returns the user's run history from the canonical revenue_agent_runs
 * table. Does NOT return fake data when Supabase is unavailable.
 */
export async function GET(req: NextRequest) {
  const { clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || 20), 100);

  const { data: runs, error } = await supabaseAdmin
    .from("revenue_agent_runs")
    .select(`
      id, status, prompt, created_at, completed_at,
      deployment_url, deployment_status,
      agent:agents(name, slug)
    `)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ runs: runs ?? [] });
}
