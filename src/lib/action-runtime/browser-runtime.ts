import "server-only";

import {
  attachBrowserSessionToRun,
  findActiveActionRunForConversation,
  findOrCreateBrowserActionRun,
  getActionRun,
  getActionRunByBrowserSession,
  patchActionRun,
  recordActionEventActivity,
  transitionActionRun,
  transitionActionRunEventActivity,
} from "./run-store";
import { canTransitionActionRun, isTerminalActionRunStatus } from "./state-machine";
import { mapBrowserFailure } from "./safe-errors";
import {
  ActionRuntimeError,
  type ActionRun,
  type BrowserActionContext,
  type BrowserToolExecutionResult,
  type CreateActionRunInput,
} from "./types";
import type { BrowserSession } from "@/lib/litt-intelligence/browser-session-manager";

/**
 * Legacy/recovery-only lookup. Canonical execution carries an explicit
 * actionRunId in its ActionExecutionContext; this exists so reconnect and
 * pre-runtime callers can rediscover a run through the durable
 * session -> run association or, as a last resort, the conversation.
 * It must never be the primary identity mechanism for new work.
 */
export async function findLegacyBrowserActionRunForRecovery(
  userId: string,
  options: { conversationId?: string; browserSessionId?: string },
): Promise<ActionRun | null> {
  if (options.browserSessionId) return getActionRunByBrowserSession(userId, options.browserSessionId);
  if (options.conversationId) return findActiveActionRunForConversation(userId, options.conversationId);
  return null;
}

/**
 * @deprecated Boundary/recovery fallback only. Never call from low-level
 * browser tool handlers — run identity comes from ActionExecutionContext.
 */
export const findActiveBrowserActionRun = findLegacyBrowserActionRunForRecovery;

function assertBrowserRun(run: ActionRun | null, context: BrowserActionContext): ActionRun {
  if (!run) throw new ActionRuntimeError("Action run not found", "ACTION_RUN_NOT_FOUND");
  if (isTerminalActionRunStatus(run.status)) {
    throw new ActionRuntimeError("Action run is terminal", "ACTION_RUN_TERMINAL");
  }
  if (run.browserSessionId !== context.browserSessionId) {
    throw new ActionRuntimeError("Action run is not attached to this browser session", "ACTION_BROWSER_SESSION_MISMATCH");
  }
  return run;
}

async function getBrowserRun(context: BrowserActionContext): Promise<ActionRun> {
  return assertBrowserRun(await getActionRun(context.actionRunId, context.userId), context);
}

/**
 * Boundary fallback only: creates the outer browser ActionRun when a caller
 * genuinely has no parent run (legacy entry points, recovery). Callers that
 * already hold an ActionExecutionContext must use that run instead — one user
 * task is one ActionRun, and browser tool calls are events inside it.
 */
export async function startBrowserActionRun(
  input: Omit<CreateActionRunInput, "kind">,
): Promise<ActionRun> {
  const run = await findOrCreateBrowserActionRun(input);
  if (run.status !== "queued") return run;
  return transitionActionRun(run.id, run.userId, "starting", {
    currentActivity: "Starting browser session",
  });
}

export async function attachBrowserSession(run: ActionRun, session: BrowserSession): Promise<ActionRun> {
  if (isTerminalActionRunStatus(run.status)) {
    throw new ActionRuntimeError("Cannot attach a browser session to a terminal run", "ACTION_RUN_TERMINAL");
  }
  if (run.browserSessionId && run.browserSessionId !== session.id) {
    throw new ActionRuntimeError("Action run is already attached to another browser session", "ACTION_BROWSER_SESSION_MISMATCH");
  }
  return attachBrowserSessionToRun(run.id, run.userId, session.id, session.browserbaseSessionId);
}

/** Records browser failure without terminating composite/agent/studio parents. */
export async function recordBrowserFailure(
  context: BrowserActionContext,
  error: unknown,
  fallbackCode = "BROWSER_ACTION_FAILED",
): Promise<ActionRun> {
  const run = await getBrowserRun(context);
  const failure = mapBrowserFailure(error, fallbackCode);
  return recordActionEventActivity({
    runId: run.id,
    userId: context.userId,
    type: "browser.action.failed",
    payload: { toolId: "browser", browserSessionId: context.browserSessionId, outcome: "failed", failureCode: failure.code },
    message: failure.message,
  });
}

/** Legacy fallback only: a browser-kind run may be failed by the browser adapter. */
export async function failBrowserActionRun(run: ActionRun, error: unknown, fallbackCode = "BROWSER_ACTION_FAILED"): Promise<ActionRun> {
  const failure = mapBrowserFailure(error, fallbackCode);
  if (run.kind !== "browser") {
    return recordActionEventActivity({
      runId: run.id,
      userId: run.userId,
      type: "browser.session.failed",
      payload: { browserSessionId: run.browserSessionId ?? "unknown", outcome: "failed", failureCode: failure.code },
      message: failure.message,
    });
  }
  return transitionActionRun(run.id, run.userId, "failed", {
    failureCode: failure.code,
    failureMessage: failure.message,
    currentActivity: failure.message,
  });
}

/**
 * Records `browser.action.started` inside the supplied run. The context's
 * actionRunId is the run identity — it is required, never discovered.
 * Persistence failures propagate: a browser action that cannot be recorded
 * is a runtime-truth failure, not telemetry.
 */
export async function recordBrowserToolStarted(context: BrowserActionContext & { toolId: string }): Promise<ActionRun> {
  const { toolId } = context;
  const run = await getBrowserRun(context);
  const message = browserActivityForTool(toolId, "started");
  if (run.status === "paused" || run.status === "starting" || run.status === "queued") {
    return transitionActionRunEventActivity({
      runId: run.id,
      userId: context.userId,
      status: "working",
      eventType: "browser.action.started",
      payload: { toolId, browserSessionId: context.browserSessionId },
      message,
      patch: { currentActivity: message },
    });
  }
  if (run.status !== "working") {
    if (!canTransitionActionRun(run.status, "working")) {
      throw new ActionRuntimeError("Action run cannot start browser work from its current state", "INVALID_TRANSITION");
    }
    return transitionActionRunEventActivity({
      runId: run.id,
      userId: context.userId,
      status: "working",
      eventType: "browser.action.started",
      payload: { toolId, browserSessionId: context.browserSessionId },
      message,
      patch: { currentActivity: message },
    });
  }
  return recordActionEventActivity({
    runId: run.id,
    userId: context.userId,
    type: "browser.action.started",
    payload: { toolId, browserSessionId: context.browserSessionId },
    message,
  });
}

async function recordBrowserToolCompleted(context: BrowserActionContext & { toolId: string }): Promise<ActionRun> {
  const { toolId } = context;
  const run = await getBrowserRun(context);
  return recordActionEventActivity({
    runId: run.id,
    userId: context.userId,
    type: "browser.action.completed",
    payload: { toolId, browserSessionId: context.browserSessionId, outcome: "completed" },
    message: browserActivityForTool(toolId, "completed"),
  });
}

async function recordBrowserToolFailed(context: BrowserActionContext & { toolId: string }, error: unknown): Promise<ActionRun> {
  const { toolId } = context;
  const run = await getBrowserRun(context);
  const failure = mapBrowserFailure(error, "BROWSER_ACTION_FAILED");
  return recordActionEventActivity({
    runId: run.id,
    userId: context.userId,
    type: "browser.action.failed",
    payload: { toolId, browserSessionId: context.browserSessionId, outcome: "failed", failureCode: failure.code },
    message: failure.message,
  });
}

/**
 * Records the finished outcome of a browser tool call inside the supplied
 * run. `result.outcome` is the actual execution outcome — it is never
 * inferred from a handler's success-shaped payload. Persistence failures
 * propagate so callers can surface or mark the run degraded.
 */
export async function recordBrowserToolExecution(
  context: BrowserActionContext & { toolId: string; result: BrowserToolExecutionResult },
): Promise<ActionRun> {
  return context.result.success
    ? recordBrowserToolCompleted(context)
    : recordBrowserToolFailed(context, context.result.error ?? new Error("Browser action failed"));
}

/**
 * Best-effort degradation marker: when durable event persistence fails after
 * the browser action already executed, the run is stamped with a failure code
 * so run state does not claim clean progress. Never throws — the underlying
 * persistence failure is the caller's to surface.
 */
export async function markBrowserRunPersistenceDegraded(context: BrowserActionContext): Promise<void> {
  try {
    await patchActionRun(context.actionRunId, context.userId, {
      failureCode: "ACTION_RUNTIME_PERSISTENCE_FAILED",
      failureMessage: "Durable Action Runtime persistence failed during browser execution",
    });
  } catch (error) {
    console.error("[action-runtime] could not mark run persistence-degraded", {
      runId: context.actionRunId,
      userId: context.userId,
      errorType: error instanceof Error ? error.name : typeof error,
    });
  }
}

export async function resolveBrowserActionRun(
  userId: string,
  options: { actionRunId?: string; browserSessionId?: string },
): Promise<ActionRun | null> {
  if (options.actionRunId) return getActionRun(options.actionRunId, userId);
  return options.browserSessionId
    ? findLegacyBrowserActionRunForRecovery(userId, { browserSessionId: options.browserSessionId })
    : null;
}

export async function markBrowserSessionPaused(userId: string, session: BrowserSession, actionRunId?: string): Promise<ActionRun | null> {
  const run = await resolveBrowserActionRun(userId, { actionRunId, browserSessionId: session.id });
  if (!run) return actionRunId ? Promise.reject(new ActionRuntimeError("Action run not found", "ACTION_RUN_NOT_FOUND")) : null;
  const context = { actionRunId: run.id, userId, browserSessionId: session.id } satisfies BrowserActionContext;
  if (actionRunId) assertBrowserRun(run, context);
  return transitionActionRunEventActivity({
    runId: context.actionRunId,
    userId,
    status: "paused",
    eventType: "browser.session.updated",
    payload: { browserSessionId: session.id, status: "paused" },
    message: "Browser paused",
  });
}

export async function markBrowserSessionControl(userId: string, session: BrowserSession, actionRunId?: string): Promise<ActionRun | null> {
  const run = await resolveBrowserActionRun(userId, { actionRunId, browserSessionId: session.id });
  if (!run) return actionRunId ? Promise.reject(new ActionRuntimeError("Action run not found", "ACTION_RUN_NOT_FOUND")) : null;
  const context = { actionRunId: run.id, userId, browserSessionId: session.id } satisfies BrowserActionContext;
  if (actionRunId) assertBrowserRun(run, context);
  const human = session.controller === "human";
  const next = human ? "user_controlling" : "paused";
  const message = human ? "You're controlling this browser" : "Control returned to LiTT";
  return transitionActionRunEventActivity({
    runId: run.id,
    userId,
    status: next,
    eventType: human ? "browser.user_control_started" : "browser.user_control_returned",
    payload: { browserSessionId: session.id, controller: session.controller },
    message,
  });
}

export async function recordBrowserSessionClosed(
  context: BrowserActionContext,
  message = "Browser session closed",
): Promise<ActionRun> {
  const run = await getActionRun(context.actionRunId, context.userId);
  if (!run) throw new ActionRuntimeError("Action run not found", "ACTION_RUN_NOT_FOUND");
  if (run.browserSessionId !== context.browserSessionId) {
    throw new ActionRuntimeError("Action run is not attached to this browser session", "ACTION_BROWSER_SESSION_MISMATCH");
  }
  return recordActionEventActivity({
    runId: run.id,
    userId: context.userId,
    type: "browser.session.completed",
    payload: { browserSessionId: context.browserSessionId },
    message,
  });
}

/** Legacy browser-resource completion. Composite parents remain owned by the orchestrator. */
export async function completeBrowserActionRun(userId: string, sessionId: string, message = "Browser task complete"): Promise<ActionRun | null> {
  const run = await findLegacyBrowserActionRunForRecovery(userId, { browserSessionId: sessionId });
  if (!run) return null;
  if (run.kind !== "browser") {
    return recordActionEventActivity({ runId: run.id, userId, type: "browser.session.completed", payload: { browserSessionId: sessionId }, message });
  }
  return transitionActionRun(run.id, userId, "completed", { currentActivity: message });
}

function browserActivityForTool(toolId: string, phase: "started" | "completed"): string {
  if (phase === "started") {
    switch (toolId) {
      case "browser.navigate": return "Opening the requested website";
      case "browser.snapshot": return "Reading the current page";
      case "browser.click": return "Using the page";
      case "browser.type": return "Entering information";
      case "browser.wait": return "Waiting for the page to update";
      default: return "Working in the browser";
    }
  }
  switch (toolId) {
    case "browser.navigate": return "Opened the requested website";
    case "browser.snapshot": return "Read the current page";
    case "browser.screenshot": return "Captured a browser snapshot";
    case "browser.click": return "Used the page";
    case "browser.type": return "Entered information in the browser";
    case "browser.scroll": return "Reviewed more of the page";
    case "browser.wait": return "Page update complete";
    case "browser.extract": return "Read the requested page information";
    default: return "Browser action completed";
  }
}
