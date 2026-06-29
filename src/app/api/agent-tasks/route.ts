import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  validateAgentTaskInput,
  checkPromptSafety,
} from "@/lib/agent-validation";
import { logAgentEvent } from "@/lib/agent-logger";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
      console.error("Failed to compute sequence order", countError);
      return NextResponse.json(
        { error: "Failed to assign sequence order" },
        { status: 500 },
      );
    }

    const nextOrder = (count || 0) + 1;

    // 4. Commit the validated record to the live cluster
    const taskPayload = {
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
      console.error("agent_tasks insert failed", txError);
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
  } catch (error: any) {
    console.error("Critical Gateway Router Exception:", error);
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
