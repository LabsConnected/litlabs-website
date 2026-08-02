import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import {
  isLaunchAgentToolAllowed,
  getApprovalGateForTool,
  type ApprovalGate,
} from "@/lib/revenue/launch-agent-manifest";

/**
 * Capability enforcement service.
 *
 * Before the agent can use any tool, this service verifies:
 *   1. The tool is in the run's allowed_tools list
 *   2. The tool is not in the forbidden list
 *   3. The required approval gate has been approved
 *   4. The run is in the correct state for the tool
 *
 * This is called by the agent execution pipeline before every
 * tool invocation. It logs the attempt to the run event log.
 */

export interface ToolCheckResult {
  allowed: boolean;
  reason?: string;
  approvalGate: ApprovalGate;
  approvalRequired: boolean;
}

/**
 * Check if a tool can be used in the current run state.
 */
export async function checkToolPermission(
  runId: string,
  userId: string,
  tool: string,
  runStatus: string,
  allowedTools: string[],
): Promise<ToolCheckResult> {
  const approvalGate = getApprovalGateForTool(tool);
  const approvalRequired = approvalGate !== "none";

  // 1. Check if tool is in the run's allowed list
  if (!allowedTools.includes(tool)) {
    await logToolDenied(runId, userId, tool, "tool_not_in_allowed_list");
    return {
      allowed: false,
      reason: `Tool '${tool}' is not in the allowed tools list for this run`,
      approvalGate,
      approvalRequired,
    };
  }

  // 2. Check if tool is forbidden (defense in depth)
  if (!isLaunchAgentToolAllowed(tool)) {
    await logToolDenied(runId, userId, tool, "tool_forbidden");
    return {
      allowed: false,
      reason: `Tool '${tool}' is forbidden`,
      approvalGate,
      approvalRequired,
    };
  }

  // 3. Check approval gate if required
  if (approvalRequired) {
    const approvalOk = await checkApprovalGranted(runId, userId, approvalGate);
    if (!approvalOk) {
      // Verify the run is in the correct awaiting state
      const expectedStatus = approvalGate === "plan" ? "awaiting_approval" : "awaiting_deploy_approval";
      if (runStatus !== expectedStatus && runStatus !== "executing" && runStatus !== "previewing") {
        await logToolDenied(runId, userId, tool, "run_not_in_awaiting_state");
        return {
          allowed: false,
          reason: `Run must be in '${expectedStatus}' state to use '${tool}'`,
          approvalGate,
          approvalRequired,
        };
      }
      await logToolDenied(runId, userId, tool, "approval_not_granted");
      return {
        allowed: false,
        reason: `Tool '${tool}' requires ${approvalGate} approval`,
        approvalGate,
        approvalRequired,
      };
    }
  }

  // 4. For write tools, verify run is in executing state
  if (tool === "project.files.write" && runStatus !== "executing") {
    await logToolDenied(runId, userId, tool, "run_not_executing");
    return {
      allowed: false,
      reason: `File writes require run to be in 'executing' state`,
      approvalGate,
      approvalRequired,
    };
  }

  // 5. For deployment trigger, verify run is in deploying state
  if (tool === "deployment.trigger" && runStatus !== "deploying") {
    await logToolDenied(runId, userId, tool, "run_not_deploying");
    return {
      allowed: false,
      reason: `Deployment trigger requires run to be in 'deploying' state`,
      approvalGate,
      approvalRequired,
    };
  }

  await logToolAllowed(runId, userId, tool);
  return {
    allowed: true,
    approvalGate,
    approvalRequired,
  };
}

/**
 * Check if an approval gate has been approved for a run.
 */
async function checkApprovalGranted(
  runId: string,
  userId: string,
  gate: ApprovalGate,
): Promise<boolean> {
  const approvalType = gate === "plan" ? "plan" : "deploy";
  const { data } = await supabaseAdmin
    .from("revenue_agent_approvals")
    .select("status")
    .eq("run_id", runId)
    .eq("user_id", userId)
    .eq("approval_type", approvalType)
    .eq("status", "approved")
    .maybeSingle();
  return !!data;
}

async function logToolAllowed(runId: string, userId: string, tool: string): Promise<void> {
  await supabaseAdmin.from("revenue_agent_run_events").insert({
    run_id: runId,
    user_id: userId,
    event_type: "tool.allowed",
    event_data: { tool },
  });
}

async function logToolDenied(
  runId: string,
  userId: string,
  tool: string,
  reason: string,
): Promise<void> {
  await supabaseAdmin.from("revenue_agent_run_events").insert({
    run_id: runId,
    user_id: userId,
    event_type: "tool.denied",
    event_data: { tool, reason },
  });
}
