// Deployment status and listing API for revenue agent runs.
//
// GET /api/marketplace/agents/[id]/runs/[runId]/deployments
//   - Lists deployments for a specific run
//
// POST /api/marketplace/agents/[id]/runs/[runId]/deployments
//   - Creates a new deployment record (called by the build pipeline)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { listDeploymentsForRun, createDeployment } from "@/lib/revenue/deployment-repository";

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

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  const deployments = await listDeploymentsForRun(runId, user.id);
  return NextResponse.json({ deployments });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string }> },
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

  // Verify the run belongs to the user
  const { data: run } = await supabaseAdmin
    .from("revenue_agent_runs")
    .select("id, project_id")
    .eq("id", runId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  let body: {
    provider?: string;
    providerDeploymentId?: string;
    environment?: string;
    status?: string;
    previewUrl?: string;
    productionUrl?: string;
    sourceRevision?: string;
    checkpointId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const deployment = await createDeployment({
    user_id: user.id,
    project_id: run.project_id,
    agent_run_id: runId,
    provider: (body.provider as "vercel" | "railway" | "manual" | "system") ?? "vercel",
    provider_deployment_id: body.providerDeploymentId ?? null,
    environment: (body.environment as "production" | "preview" | "development") ?? "production",
    status: (body.status as "pending" | "queued" | "building" | "deploying" | "ready" | "live" | "failed" | "canceled") ?? "pending",
    preview_url: body.previewUrl ?? null,
    production_url: body.productionUrl ?? null,
    source_revision: body.sourceRevision ?? null,
    checkpoint_id: body.checkpointId ?? null,
  });

  if (!deployment) {
    return NextResponse.json({ error: "Failed to create deployment" }, { status: 500 });
  }

  return NextResponse.json(deployment, { status: 201 });
}
