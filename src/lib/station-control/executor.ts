/**
 * Station Control Bridge — executor (server-only).
 *
 * One call path for LiTT and the UI: permission → approval → validate →
 * execute. Honest failures only — this function NEVER throws.
 * Contract: docs/LITT-OS-IMPLEMENTATION-CONTRACT.md §3.4.
 */
import "server-only";
import type {
  ExecutionEvent,
  StationExecutionContext,
  StationResult,
} from "./types";
import { getStationAction } from "./registry";
import { canMutateAction } from "./permissions";

type StationEvent = Omit<ExecutionEvent, "id" | "seq" | "ts">;

/** Event emission must never break execution — presenter sinks may throw. */
function safeEmit(ctx: StationExecutionContext, event: StationEvent): void {
  try {
    ctx.emitEvent(event);
  } catch {
    // Swallow: execution correctness outranks telemetry.
  }
}

function toErrorString(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function summarizeResult(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  try {
    const s = typeof result === "string" ? result : JSON.stringify(result);
    return s.length > 500 ? `${s.slice(0, 500)}…` : s;
  } catch {
    return String(result).slice(0, 500);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize an action's raw result to a StationResult:
 * - a plain object already carrying a boolean `success` flag passes through
 *   (it may be a nested StationResult from a delegated tool adapter),
 * - a plain object without one becomes `{ success: true, ...result }`,
 * - anything else becomes `{ success: true, result }`.
 */
function normalizeResult(result: unknown): StationResult {
  if (isPlainObject(result)) {
    if (typeof result.success === "boolean") {
      return result as StationResult;
    }
    return { success: true, ...result };
  }
  return { success: true, result };
}

export async function executeStationAction(
  id: string,
  rawArgs: unknown,
  ctx: StationExecutionContext,
): Promise<StationResult> {
  try {
    const action = getStationAction(id);
    if (!action) {
      return {
        success: false,
        error: `Unknown station action: "${id}"`,
        errorCode: "unknown_action",
      };
    }

    // (b) Permission gate — PLAN mode denies every mutation.
    if (action.mutating) {
      if (ctx.missionMode === "plan") {
        return {
          success: false,
          error: `Permission denied: "${id}" mutates state and the mission is in PLAN mode`,
          errorCode: "permission_denied",
        };
      }
      if (!canMutateAction(action, ctx.permissions)) {
        return {
          success: false,
          error: `Permission denied: "${id}" mutates the ${action.station} station and the permission is not "allow"`,
          errorCode: "permission_denied",
        };
      }
    }

    // (c) Approval gate — emit and pause; do NOT execute.
    if (action.requiresApproval && !ctx.hasApproval) {
      safeEmit(ctx, {
        type: "approval_required",
        actionId: id,
        station: action.station,
        summary: `Approval required before executing "${id}" — ${action.description}`,
      });
      return {
        success: false,
        error: `Approval required for "${id}"`,
        errorCode: "approval_required",
      };
    }

    // (d) Arg validation.
    const parsed = action.argsSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid args for "${id}": ${parsed.error.message}`,
        errorCode: "invalid_args",
      };
    }

    // (e) Execute.
    safeEmit(ctx, {
      type: "action_started",
      actionId: id,
      station: action.station,
      summary: `Started "${id}"`,
    });

    // Presentation navigation must never break execution (§19.2).
    try {
      ctx.navigateToStation(action.station);
    } catch {
      // Swallow: navigation is optional presentation behavior.
    }

    let result: unknown;
    try {
      result = await action.execute(parsed.data, ctx);
    } catch (err) {
      const message = toErrorString(err);
      safeEmit(ctx, {
        type: "action_failed",
        actionId: id,
        station: action.station,
        summary: `Failed "${id}"`,
        error: message,
        errorCode: "execution_failed",
      });
      return { success: false, error: message, errorCode: "execution_failed" };
    }

    safeEmit(ctx, {
      type: "action_completed",
      actionId: id,
      station: action.station,
      summary: `Completed "${id}"`,
      resultSummary: summarizeResult(result),
    });

    return normalizeResult(result);
  } catch (err) {
    // Last-resort guard: the executor never throws.
    return { success: false, error: toErrorString(err), errorCode: "execution_failed" };
  }
}
