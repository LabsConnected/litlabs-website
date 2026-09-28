/**
 * Station Control Bridge — delegate helper for chunks B/C (server-only).
 *
 * Lets a station action reuse an EXISTING tool-registry handler (e.g. the
 * real `files.write`, `browser.screenshot`, image pipeline) behind the
 * StationAction interface, per contract §19.1 ("adapt it").
 *
 * Approval note: hasApproval=true is CORRECT here. The toolRegistry.execute
 * path enforces requireExplicitForMutations before any handler runs, and the
 * agent loop pauses for approval BEFORE invoking a station action — by the
 * time delegateToTool runs, approval (if required) has already been granted
 * through the station action's own requiresApproval/hasApproval gate.
 */
import "server-only";
import type { ActionExecutionContext } from "@/lib/action-runtime/types";
import { toolRegistry } from "../litt-intelligence/tool-registry";
import type { StationExecutionContext, StationResult } from "./types";

/** Narrow the station ctx actionContext to the trusted ActionExecutionContext shape. */
function toActionContext(
  ctx: StationExecutionContext,
): ActionExecutionContext | undefined {
  const ac = ctx.actionContext;
  if (ac && typeof ac.userId === "string" && typeof ac.actionRunId === "string") {
    return {
      actionRunId: ac.actionRunId,
      userId: ac.userId,
      ...(ac.projectId ? { projectId: ac.projectId } : null),
    };
  }
  return undefined;
}

/**
 * Build a StationAction `execute` implementation that delegates to a
 * registered tool-registry tool.
 *
 * @param toolId the tool-registry id (e.g. "files.write")
 * @param mapInputs optional mapping from station args to tool inputs;
 *   defaults to passing args through unchanged
 */
export function delegateToTool(
  toolId: string,
  mapInputs?: (args: Record<string, unknown>) => Record<string, unknown>,
): (args: Record<string, unknown>, ctx: StationExecutionContext) => Promise<StationResult> {
  return async (args, ctx): Promise<StationResult> => {
    const mapped = mapInputs ? mapInputs(args) : args;
    const outcome = await toolRegistry.execute(toolId, mapped, {
      transport: ctx.transport,
      actionContext: toActionContext(ctx),
      hasApproval: true,
      signal: ctx.signal,
    });
    if (outcome.ok) {
      return { success: true, result: outcome.result };
    }
    return { success: false, error: outcome.error };
  };
}
