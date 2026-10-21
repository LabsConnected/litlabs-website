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
import { evaluateMutationAuthorization } from "./permissions";

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
    //
    // Repair R5-A: the permission decision is evaluated WITH the
    // context's approval state, not before it. The previous check ran
    // first and treated "ask" (the deploy station's default) as a hard
    // denial, so an explicitly approved publish could never execute —
    // the approval gate below was unreachable for every "ask" station.
    // Now: "deny" (or an unmapped station) is a hard permission_denied
    // even with an approval; "ask" without an approval defers to the
    // approval gate below, which answers approval_required; "ask" WITH
    // a genuine approval satisfies the permission. The approval gate
    // still runs afterwards for requiresApproval actions, so nothing
    // executes unapproved that was gated before.
    if (action.mutating) {
      if (ctx.missionMode === "plan") {
        return {
          success: false,
          error: `Permission denied: "${id}" mutates state and the mission is in PLAN mode`,
          errorCode: "permission_denied",
        };
      }
      const authorization = evaluateMutationAuthorization(
        action,
        ctx.permissions,
        ctx.hasApproval === true,
      );
      if (!authorization.allowed && authorization.reason === "denied") {
        return {
          success: false,
          error: `Permission denied: "${id}" mutates the ${action.station} station and the permission is not "allow"`,
          errorCode: "permission_denied",
        };
      }
      // reason "approval_required": fall through to the approval gate.
    }

    // (c) Approval gate — emit and pause; do NOT execute.
    // Repair R1a-2 (Diagnosis E2 S4): the gate covers EVERY mutating
    // action, not only those flagged requiresApproval. A mutating action
    // without the flag previously executed on whatever approval state
    // the context happened to carry — and delegate paths manufactured
    // that state as a hardcoded true, so an unapproved caller could
    // reach real mutations (e.g. files.create → files.write) with no
    // gate anywhere. Mutations now require the context to carry a
    // genuine approval: a granted gate decision, or the agent loop's
    // non-gated auto-approval (the loop invokes unapproved non-gated
    // calls with hasApproval:true by design — see agent-loop-v2).
    if ((action.requiresApproval || action.mutating) && !ctx.hasApproval) {
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
