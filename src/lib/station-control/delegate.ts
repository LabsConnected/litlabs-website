/**
 * Station Control Bridge — delegate helper for chunks B/C (server-only).
 *
 * Lets a station action reuse an EXISTING tool-registry handler (e.g. the
 * real `files.write`, `browser.screenshot`, image pipeline) behind the
 * StationAction interface, per contract §19.1 ("adapt it").
 *
 * Approval note (Repair R1a-2, Diagnosis E2 S4): the inner execute
 * receives the station context's OWN approval state — the authorization
 * the outer call genuinely carried, threaded in by the advertisement /
 * caller. This used to be a hardcoded `hasApproval: true`, which let any
 * delegated mutation sail through the registry's
 * requireExplicitForMutations backstop on manufactured approval. With
 * threading, a mutation executes only when the approval behind the
 * outer call was real (a granted gate, or the loop's non-gated
 * auto-approval); the executor's approval gate and the registry
 * backstop now both see the same truth.
 */
import "server-only";
import type { ActionExecutionContext } from "@/lib/action-runtime/types";
import { toolRegistry } from "../litt-intelligence/tool-registry";
import type { StationExecutionContext, StationResult } from "./types";

/**
 * The error string of a structured tool failure, or null when the result
 * is not one. Mirrors actionToolResultFailed (action-runtime/tool-runtime.ts)
 * without importing it: delegate.ts is loaded by every station module, and
 * a value import of the tool runtime would drag the Supabase-backed
 * run-store into that whole module graph.
 */
function structuredToolFailure(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (record.success === false || record.ok === false) {
    return typeof record.error === "string" && record.error.trim()
      ? record.error
      : typeof record.message === "string" && record.message.trim()
        ? record.message
        : "tool_result_failed";
  }
  return null;
}

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
      hasApproval: ctx.hasApproval === true,
      signal: ctx.signal,
    });
    if (outcome.ok) {
      // A settled registry outcome is not necessarily a successful tool:
      // handlers report structured failures as { success: false, error }
      // VALUES (the canonical classification is actionToolResultFailed in
      // action-runtime/tool-runtime.ts — a structured { success:false } /
      // { ok:false } is a failed operation, not a completed one). Mapping
      // those to station-level success made delegated actions report
      // success for work that never happened (Defect-2: files.create
      // "succeeded" while the underlying files.write had failed and
      // nothing was persisted). Surface the failure honestly instead.
      const failure = structuredToolFailure(outcome.result);
      if (failure) {
        return { success: false, error: failure };
      }
      return { success: true, result: outcome.result };
    }
    return { success: false, error: outcome.error };
  };
}
