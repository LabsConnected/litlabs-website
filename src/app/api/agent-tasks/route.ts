import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin, getSupabaseAdmin } from "@/lib/supabase";
import {
  validateAgentTaskInput,
  checkPromptSafety,
} from "@/lib/agent-validation";
import { logAgentEvent } from "@/lib/agent-logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Graceful degradation when Supabase service role is not configured
  // (local dev, preview deploys without secrets). Avoids a 500 that
  // surfaces as console noise in Lighthouse/captures.
  if (!getSupabaseAdmin()) {
    return NextResponse.json({ tasks: [], configured: false });
  }

  const { data, error } = await supabaseAdmin
    .from("agent_tasks")
    .select("id, session_id, assigned_to, dispatcher, task_input, task_output, status, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { error: `Failed to load missions: ${error.message}`, configured: true },
      { status: 500 },
    );
  }

  return NextResponse.json({ tasks: data || [], configured: true });
}

export async function POST(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();

    const {
      sessionId,
      workflowId,
      assignedTo,
      dispatcher,
      taskInput,
      meta = {},
    } = body as {
      sessionId: string;
      workflowId?: string;
      assignedTo: string;
      dispatcher: string;
      taskInput: Record<string, unknown>;
      meta?: Record<string, unknown>;
    };

    // 1. Run structural schema validation checks on the task input payload
    const validation = validateAgentTaskInput(taskInput);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.errors.join(", ") },
        { status: 400 },
      );
    }

    // 2. Scan prompt for destructive or hallucinated execution flags
    const prompt = (taskInput?.prompt as string) || "";
    const safety = checkPromptSafety(prompt);
    if (!safety.ok) {
      return NextResponse.json(
        { error: `Security Intercept: ${safety.reason}` },
        { status: 403 },
      );
    }

    // 3. Resolve sequence order mapping
    const { count, error: countError } = await supabaseAdmin
      .from("agent_tasks")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);

    if (countError) {
      return NextResponse.json(
        { error: "Failed to assign sequence order" },
        { status: 500 },
      );
    }

    const nextOrder = (count || 0) + 1;

    // 4. Commit the validated record to the live cluster
    const taskPayload = {
      user_id: userId,
      session_id: sessionId,
      workflow_id: workflowId || null,
      assigned_to: assignedTo,
      dispatcher,
      task_input: taskInput,
      task_output: {},
      status: "queued",
      sequence_order: nextOrder,
    };

    const { data: task, error: txError } = await supabaseAdmin
      .from("agent_tasks")
      .insert([taskPayload])
      .select("*")
      .single();

    if (txError || !task) {
      return NextResponse.json(
        { error: "Failed to create agent task" },
        { status: 500 },
      );
    }

    // 5. Log initialization tracking milestone
    await logAgentEvent(
      dispatcher,
      "info",
      "Task successfully validated and queued",
      {
        taskId: task.id,
        sessionId: task.session_id,
        assignedTo,
        meta,
      },
    ).catch(() => {});

    return NextResponse.json(
      {
        ok: true,
        taskId: task.id,
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal Execution Interruption",
      },
      { status: 500 },
    );
  }
}
