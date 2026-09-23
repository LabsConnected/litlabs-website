import "server-only";

import {
  getActionRun,
  patchActionRun,
  recordActionEventActivity,
  transitionActionRunEventActivity,
} from "./run-store";
import { canTransitionActionRun, isTerminalActionRunStatus } from "./state-machine";
import {
  ActionRuntimeError,
  type ActionEventType,
  type ActionExecutionContext,
  type ActionRun,
} from "./types";

const DEPLOYMENT_TOOL_IDS = new Set(["deploy.execute", "deploy.verify", "project.deploy"]);

type ToolLifecyclePhase = "started" | "completed" | "failed";

function eventTypeFor(toolId: string, phase: ToolLifecyclePhase): ActionEventType {
  return `${DEPLOYMENT_TOOL_IDS.has(toolId) ? "deployment" : "tool"}.${phase}` as ActionEventType;
}

function activityFor(toolId: string, phase: ToolLifecyclePhase): string {
  return phase === "started"
    ? `Running ${toolId}`
    : phase === "completed"
      ? `${toolId} completed`
      : `${toolId} failed`;
}

async function getToolRun(context: ActionExecutionContext): Promise<ActionRun> {
  const run = await getActionRun(context.actionRunId, context.userId);
  if (!run) throw new ActionRuntimeError("Action run not found", "ACTION_RUN_NOT_FOUND");
  if (isTerminalActionRunStatus(run.status)) {
    throw new ActionRuntimeError("Action run is terminal", "ACTION_RUN_TERMINAL");
  }
  return run;
}

async function recordToolEvent(
  context: ActionExecutionContext,
  toolId: string,
  phase: ToolLifecyclePhase,
  payload: Record<string, unknown> = {},
): Promise<ActionRun> {
  const run = await getToolRun(context);
  const type = eventTypeFor(toolId, phase);
  const message = activityFor(toolId, phase);
  const eventPayload = { toolId, ...payload };

  if (phase === "started" && run.status !== "working") {
    if (!canTransitionActionRun(run.status, "working")) {
      throw new ActionRuntimeError("Action run cannot start tool work from its current state", "ACTION_RUN_INVALID_TRANSITION");
    }
    return transitionActionRunEventActivity({
      runId: run.id,
      userId: context.userId,
      status: "working",
      eventType: type,
      payload: eventPayload,
      message,
      patch: { currentActivity: message },
    });
  }

  return recordActionEventActivity({
    runId: run.id,
    userId: context.userId,
    type,
    payload: eventPayload,
    message,
  });
}

/** Structured { success:false } / { ok:false } is a failed operation, not a completed one. */
export function actionToolResultFailed(result: unknown): string | null {
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

export async function recordActionToolStarted(
  context: ActionExecutionContext,
  toolId: string,
): Promise<ActionRun> {
  return recordToolEvent(context, toolId, "started");
}

export async function recordActionToolCompleted(
  context: ActionExecutionContext,
  toolId: string,
  result?: unknown,
): Promise<ActionRun> {
  return recordToolEvent(context, toolId, "completed", {
    outcome: "completed",
    ...deploymentOutcomePayload(toolId, result),
  });
}

function deploymentOutcomePayload(toolId: string, result: unknown): Record<string, unknown> {
  if (!DEPLOYMENT_TOOL_IDS.has(toolId) || !result || typeof result !== "object" || Array.isArray(result)) {
    return {};
  }
  const payload = result as Record<string, unknown>;
  const deployment = payload.deployment && typeof payload.deployment === "object" && !Array.isArray(payload.deployment)
    ? payload.deployment as Record<string, unknown>
    : {};
  const pickString = (...values: unknown[]) =>
    values.find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null;
  const httpStatus = [payload.httpStatus, payload.statusCode, deployment.httpStatus, deployment.statusCode]
    .find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? null;

  return {
    deploymentId: pickString(payload.deploymentId, deployment.deploymentId, deployment.id),
    publicUrl: pickString(payload.publicUrl, payload.liveUrl, payload.url, deployment.publicUrl, deployment.liveUrl, deployment.url),
    providerStatus: pickString(payload.status, deployment.status),
    verified: payload.verified === true || deployment.verified === true || (httpStatus !== null && httpStatus >= 200 && httpStatus < 400),
    httpStatus,
  };
}

export async function recordActionToolFailed(
  context: ActionExecutionContext,
  toolId: string,
  error?: unknown,
): Promise<ActionRun> {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  return recordToolEvent(context, toolId, "failed", {
    outcome: "failed",
    ...(message ? { error: message.slice(0, 300) } : {}),
  });
}

/**
 * Best-effort degradation marker after a tool already executed but its
 * outcome could not be persisted. Never throws — the caller owns surfacing
 * the reconciliation error.
 */
export async function markActionToolRunPersistenceDegraded(
  context: ActionExecutionContext,
): Promise<void> {
  try {
    await patchActionRun(context.actionRunId, context.userId, {
      failureCode: "ACTION_RUNTIME_PERSISTENCE_FAILED",
      failureMessage: "Durable Action Runtime persistence failed during tool execution",
    });
  } catch (error) {
    console.error("[action-runtime] could not mark run persistence-degraded", {
      runId: context.actionRunId,
      userId: context.userId,
      errorType: error instanceof Error ? error.name : typeof error,
    });
  }
}
