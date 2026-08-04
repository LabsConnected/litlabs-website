import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";
import { requiresApproval, type ToolPermissionLevel } from "@/lib/litt-intelligence/types";

/**
 * POST /api/litt/tools/execute
 *
 * Executes a registered LiTT tool. Checks permissions, approval status,
 * and records the execution in tool_executions.
 *
 * Request body:
 *   {
 *     toolId: string,
 *     inputs: Record<string, unknown>,
 *     runId?: string,
 *     stepId?: string,
 *     projectId?: string,
 *     hasApproval?: boolean
 *   }
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    toolId: string;
    inputs?: Record<string, unknown>;
    runId?: string;
    stepId?: string;
    projectId?: string;
    hasApproval?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.toolId) {
    return NextResponse.json({ error: "Missing toolId" }, { status: 400 });
  }

  // Check if the tool exists and is enabled
  const tool = toolRegistry.get(body.toolId);
  if (!tool) {
    return NextResponse.json({ error: `Tool "${body.toolId}" is not registered` }, { status: 404 });
  }

  if (!tool.enabled) {
    return NextResponse.json({ error: `Tool "${body.toolId}" is disabled` }, { status: 403 });
  }

  // Check if approval is required
  const needsApproval = requiresApproval(tool.permissionLevel);
  if (needsApproval && !body.hasApproval) {
    // Record the approval request
    if (supabaseAdmin) {
      const { data: user } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("clerk_id", userId)
        .maybeSingle();

      if (user) {
        await supabaseAdmin.from("tool_executions").insert({
          tool_id: body.toolId,
          run_id: body.runId ?? null,
          step_id: body.stepId ?? null,
          user_id: user.id,
          project_id: body.projectId ?? null,
          inputs: body.inputs ?? {},
          status: "pending",
          started_at: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      error: "Approval required",
      toolId: body.toolId,
      permissionLevel: tool.permissionLevel,
      requiresApproval: true,
    }, { status: 202 });
  }

  // Execute the tool
  const result = await toolRegistry.execute(
    body.toolId,
    body.inputs ?? {},
    {
      hasApproval: body.hasApproval,
    },
  );

  // Record the execution
  if (supabaseAdmin) {
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("clerk_id", userId)
      .maybeSingle();

    if (user) {
      await supabaseAdmin.from("tool_executions").insert({
        tool_id: body.toolId,
        run_id: body.runId ?? null,
        step_id: body.stepId ?? null,
        user_id: user.id,
        project_id: body.projectId ?? null,
        inputs: body.inputs ?? {},
        outputs: result.ok ? { result: result.result } : { error: result.error },
        status: result.ok ? "completed" : "failed",
        error_message: result.ok ? null : result.error,
        completed_at: new Date().toISOString(),
      });

      // Audit event for external-write and above
      if (needsApproval) {
        await supabaseAdmin.from("audit_events").insert({
          user_id: user.id,
          event_type: "tool_call",
          event_category: "info",
          description: `Tool "${body.toolId}" executed (${tool.permissionLevel})`,
          metadata: { toolId: body.toolId, permissionLevel: tool.permissionLevel, success: result.ok },
          related_id: body.runId,
          related_type: "agent_run",
        });
      }
    }
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error, toolId: body.toolId }, { status: 500 });
  }

  return NextResponse.json({
    toolId: body.toolId,
    result: result.result,
    status: "completed",
  });
}
