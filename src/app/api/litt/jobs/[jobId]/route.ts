import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/litt/jobs/[jobId]
 *
 * Returns the status of a background job. Jobs are long-running
 * operations that execute outside the browser request (video
 * generation, music generation, builds, etc.).
 *
 * The Studio polls this endpoint to show job progress and detect
 * completion. Run progress survives page refresh because the job
 * state is stored in the database.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
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

  // Check agent_work_queue first (the primary job table) — scoped to this user
  const { data: job, error } = await supabaseAdmin
    .from("agent_work_queue")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to fetch job" }, { status: 500 });
  }

  if (job) {
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      type: job.task_type,
      payload: job.payload,
      result: job.result,
      error: job.error,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      source: "agent_work_queue",
    });
  }

  // Fallback: check orchestration_jobs — scoped to this user
  const { data: orchJob } = await supabaseAdmin
    .from("orchestration_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (orchJob) {
    return NextResponse.json({
      jobId: orchJob.id,
      status: orchJob.status,
      type: orchJob.job_type,
      payload: orchJob.payload,
      result: orchJob.result,
      error: orchJob.error_message,
      createdAt: orchJob.created_at,
      startedAt: orchJob.started_at,
      completedAt: orchJob.completed_at,
      source: "orchestration_jobs",
    });
  }

  return NextResponse.json({ error: "Job not found" }, { status: 404 });
}
