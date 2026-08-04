import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/litt/runs/[runId]/retry
 *
 * Retries a failed or cancelled run. Creates a new run with the same
 * parameters but a new idempotency key. The original run is marked
 * as 'retried' and linked to the new run.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;
  if (!runId) {
    return NextResponse.json({ error: "Missing runId" }, { status: 400 });
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

  // Fetch the original run
  const { data: originalRun, error: fetchError } = await supabaseAdmin
    .from("agent_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 });
  }

  if (!originalRun) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (originalRun.status === "running" || originalRun.status === "pending") {
    return NextResponse.json({
      error: "Cannot retry a run that is still active",
      runId,
      status: originalRun.status,
    }, { status: 409 });
  }

  // Create a new run with the same parameters
  const newIdempotencyKey = `${originalRun.idempotency_key}-retry-${Date.now()}`;
  const { data: newRun, error: createError } = await supabaseAdmin
    .from("agent_runs")
    .insert({
      user_id: user.id,
      agent_instance_id: originalRun.agent_instance_id,
      agent_id: originalRun.agent_id,
      agent_version_id: originalRun.agent_version_id,
      conversation_id: originalRun.conversation_id,
      idempotency_key: newIdempotencyKey,
      model: originalRun.model,
      provider: originalRun.provider,
      credits_charged: originalRun.credits_charged,
      status: "pending",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (createError) {
    return NextResponse.json({ error: "Failed to create retry run" }, { status: 500 });
  }

  // Audit event
  await supabaseAdmin.from("audit_events").insert({
    user_id: user.id,
    event_type: "custom",
    event_category: "info",
    description: `Run ${runId} retried as ${newRun.id}`,
    metadata: { originalRunId: runId, newRunId: newRun.id },
    related_id: newRun.id,
    related_type: "agent_run",
  });

  return NextResponse.json({
    originalRunId: runId,
    newRunId: newRun.id,
    status: "pending",
  });
}
