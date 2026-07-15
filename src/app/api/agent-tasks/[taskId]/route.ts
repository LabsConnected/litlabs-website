import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logAgentEvent } from "@/lib/agent-logger";
import { sanitizeProviderError } from "@/lib/provider-error";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;

    const { data: task, error } = await supabaseAdmin
      .from("agent_tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    if (error || !task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ task });
  } catch (error) {
    console.error("Task fetch failed:", error);
    const { status, error: message } = sanitizeProviderError(error);
    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await request.json();

    const allowedStatuses = ["queued", "processing", "success", "failed"];
    const updates: Record<string, unknown> = {};

    if (
      typeof body.status === "string" &&
      allowedStatuses.includes(body.status)
    ) {
      updates.status = body.status;
    }

    if (body.task_output && typeof body.task_output === "object") {
      updates.task_output = body.task_output;
    }

    if (body.assigned_to && typeof body.assigned_to === "string") {
      updates.assigned_to = body.assigned_to;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    const { data: task, error } = await supabaseAdmin
      .from("agent_tasks")
      .update(updates)
      .eq("id", taskId)
      .select("*")
      .single();

    if (error || !task) {
      console.error("agent_tasks update failed", error);
      return NextResponse.json(
        { error: "Failed to update agent task" },
        { status: 500 },
      );
    }

    const agentName =
      typeof task.assigned_to === "string" ? task.assigned_to : "unknown";

    await logAgentEvent(
      agentName,
      "info",
      `Task status updated to ${task.status}`,
      {
        taskId: task.id,
        sessionId: task.session_id,
        previousStatus: body.previousStatus,
      },
    ).catch(() => { });

    return NextResponse.json({ ok: true, task });
  } catch (error) {
    console.error("Critical Task Update Exception:", error);
    const { status, error: message } = sanitizeProviderError(error);
    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
