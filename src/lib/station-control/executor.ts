/**
 * Station Control — Action Executor
 *
 * The action executor with permission and mode checks.
 * This is the central dispatcher that validates and executes station actions.
 */

import type {
  StationAction,
  StationExecutionContext,
  StationId,
  PermissionSet,
  MissionMode,
  FollowMode,
  ExecutionEvent,
} from "./types";
import { getStationAction, STATION_ACTIONS } from "./registry";
import { canMutate, requiresApproval } from "./permissions";

export function checkPermission(
  action: StationAction<any, any>,
  permissions: PermissionSet,
): { allowed: boolean; reason?: string } {
  // Read actions are always allowed
  if (!action.mutating) {
    return { allowed: true };
  }

  // Check permission level
  const canWrite = canMutate(permissions, action.station);
  if (!canWrite) {
    return { allowed: false, reason: `Permission denied: cannot mutate ${action.station}` };
  }

  // Check approval requirement
  if (action.requiresApproval && requiresApproval(permissions, action.station)) {
    return { allowed: false, reason: `Approval required for ${action.id}` };
  }

  return { allowed: true };
}

export function checkMode(
  action: StationAction<any, any>,
  mode: MissionMode,
  permissions: PermissionSet,
): { allowed: boolean; reason?: string } {
  // Read actions are always allowed
  if (!action.mutating) {
    return { allowed: true };
  }

  // PLAN mode: no mutations allowed
  if (mode === "plan") {
    return { allowed: false, reason: `PLAN mode: cannot mutate` };
  }

  // Check permissions
  return checkPermission(action, permissions);
}

export interface ExecuteStationActionOptions {
  actionId: string;
  args: Record<string, unknown>;
  ctx: StationExecutionContext;
}

export interface ExecuteResult<T> {
  success: boolean;
  result?: T;
  error?: string;
  pendingApproval?: boolean;
}

/**
 * Execute a station action with permission and mode checks.
 */
export async function executeStationAction<T>(
  options: ExecuteStationActionOptions,
): Promise<ExecuteResult<T>> {
  const { actionId, args, ctx } = options;

  // Get the action
  const action = getStationAction(actionId);
  if (!action) {
    return { success: false, error: `Unknown action: ${actionId}` };
  }

  // Check mode and permissions
  const check = checkMode(action, ctx.mode, ctx.permissions);
  if (!check.allowed) {
    // If it needs approval in ACT mode, emit event and pause
    if (action.requiresApproval && !canMutate(ctx.permissions, action.station)) {
      ctx.emitEvent({
        type: "approval_required",
        summary: `Approval needed: ${action.id}`,
      });
      return { success: false, pendingApproval: true, error: check.reason };
    }
    return { success: false, error: check.reason };
  }

  // Validate args
  const parsed = action.argsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      success: false,
      error: `Invalid args: ${parsed.error.format()}`,
    };
  }

  // Emit event
  ctx.emitEvent({
    type: "phase",
    summary: `Executing ${action.id}`,
    phase: "editing" as any,
    step: 1,
  });

  // Execute the action
  try {
    const result = await action.execute(parsed.data, ctx);
    return { success: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action execution failed";
    ctx.emitEvent({
      type: "tool_error",
      summary: message,
      toolId: actionId,
    });
    return { success: false, error: message };
  }
}

/**
 * Get all registered station actions (for debugging/inspection).
 */
export function getAllActions(): StationAction<any, any>[] {
  return Object.values(STATION_ACTIONS);
}