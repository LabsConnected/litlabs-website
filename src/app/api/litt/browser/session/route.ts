import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  startSession,
  closeSession,
  pauseSession,
  takeControl,
  returnControl,
  getSession,
  dbGetActiveSessionsStrict,
  dbGetActions,
  takeScreenshot,
  closeIdleSessions,
} from "@/lib/litt-intelligence/browser-session-manager";
import type { BrowserSession } from "@/lib/litt-intelligence/browser-session-manager";
import { preflightBrowserStart } from "@/lib/litt-intelligence/browser-billing";
import { mapBrowserFailure } from "@/lib/action-runtime/safe-errors";
import {
  attachBrowserSession,
  createActionRun,
  failBrowserActionRun,
  getActionRun,
  listActionRunsForBrowserSessions,
  markBrowserSessionControl,
  markBrowserSessionPaused,
  recordBrowserSessionClosed,
  resolveBrowserActionRun,
  startBrowserActionRun,
} from "@/lib/action-runtime";
import { getProject } from "@/lib/projects/project-repository";
import { getConversation } from "@/lib/studio/conversation-service";
import { isTerminalActionRunStatus } from "@/lib/action-runtime/state-machine";

export const runtime = "nodejs";

/**
 * POST /api/litt/browser/session
 * Start a new browser session.
 * Body: { action: "start", task?, projectId?, conversationId?, model?, useProxies? }
 *
 * POST /api/litt/browser/session
 * Control an existing session.
 * Body: { action: "pause"|"take_control"|"return_control"|"close"|"screenshot", sessionId }
 *
 * GET /api/litt/browser/session
 * List active sessions for the authenticated user.
 *
 * GET /api/litt/browser/session?sessionId=xxx
 * Get a specific session with recent actions.
 */
function stringField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return value === undefined ? null : typeof value === "string" && value.trim() ? value : null;
}

async function resolveRunForRequest(
  userId: string,
  actionRunId: string | null,
  sessionId: string,
  options: { allowTerminal?: boolean } = {},
) {
  const run = await resolveBrowserActionRun(userId, {
    actionRunId: actionRunId ?? undefined,
    browserSessionId: actionRunId ? undefined : sessionId,
  });
  if (actionRunId && !run) {
    return { error: NextResponse.json({ error: "Action run not found" }, { status: 404 }) };
  }
  if (run?.browserSessionId && run.browserSessionId !== sessionId) {
    return { error: NextResponse.json({ error: "Action run is not attached to this session" }, { status: 409 }) };
  }
  if (run && !options.allowTerminal && isTerminalActionRunStatus(run.status)) {
    return { error: NextResponse.json({ error: "Action run is terminal", code: "ACTION_RUN_TERMINAL" }, { status: 409 }) };
  }
  if (actionRunId && run?.browserSessionId !== sessionId) {
    return { error: NextResponse.json({ error: "Action run is not attached to this session", code: "ACTION_BROWSER_SESSION_MISMATCH" }, { status: 409 }) };
  }
  return { run };
}

function isReusableBrowserSession(session: BrowserSession | null): session is BrowserSession {
  return !!session && !session.closedAt && ["active", "paused", "human_control", "agent_control"].includes(session.status);
}

function runtimeAfterExecutionResponse(
  operation: string,
  userId: string,
  sessionId: string,
  actionRunId: string | null,
  error: unknown,
): NextResponse {
  const failure = mapBrowserFailure(error, "ACTION_RUNTIME_PERSISTENCE_FAILED_AFTER_EXECUTION");
  console.error("[browser-session] runtime persistence failed after provider execution", {
    code: failure.code,
    operation,
    userId,
    sessionId,
    actionRunId,
  });
  return NextResponse.json(
    {
      code: "ACTION_RUNTIME_PERSISTENCE_FAILED_AFTER_EXECUTION",
      message: "The browser action completed, but LiTT couldn't persist the task state.",
      operation,
      actionRunId,
    },
    { status: 500 },
  );
}

function safeErrorResponse(error: unknown, fallbackCode: string, status = 500): NextResponse {
  const failure = mapBrowserFailure(error, fallbackCode);
  return NextResponse.json({ code: failure.code, message: failure.message }, { status });
}

async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── GET: list sessions or get specific session ───────────────
  if (req.method === "GET") {
    try {
      const url = new URL(req.url);
      const sessionId = url.searchParams.get("sessionId");

      if (sessionId) {
        const session = await getSession(sessionId, userId);
        if (!session) {
          return NextResponse.json({ error: "Session not found" }, { status: 404 });
        }
        const actions = await dbGetActions(sessionId, userId, 50);
        const actionRun = await resolveBrowserActionRun(userId, { browserSessionId: session.id });
        return NextResponse.json({
          session,
          actions,
          actionRun,
          actionRunId: actionRun?.id ?? null,
          runStatus: actionRun?.status ?? null,
          currentActivity: actionRun?.currentActivity ?? null,
        });
      }

      const sessions = await dbGetActiveSessionsStrict(userId);
      // Recovery truth per session: the ActionRun each browser resource is
      // attached to, so reconnecting clients restore server state instead of
      // reconstructing it from BrowserSession alone.
      const runs = await listActionRunsForBrowserSessions(userId, sessions.map((s) => s.id));
      const runBySession = new Map(runs.map((r) => [r.browserSessionId, r]));
      const actionRuns = sessions.map((s) => {
        const r = runBySession.get(s.id);
        return {
          sessionId: s.id,
          actionRunId: r?.id ?? null,
          runStatus: r?.status ?? null,
          currentActivity: r?.currentActivity ?? null,
        };
      });
      return NextResponse.json({ sessions, actionRuns });
    } catch (err) {
      const failure = mapBrowserFailure(err, "BROWSER_SESSION_RECOVERY_FAILED");
      console.error("[browser-session] recovery read failed", { code: failure.code, userId });
      return NextResponse.json({ code: failure.code, message: failure.message }, { status: 503 });
    }
  }

  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ─── POST: session control ────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.action === undefined) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }
  if (typeof body.action !== "string") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  const action = body.action;
  const actionRunId = body.actionRunId === undefined
    ? null
    : typeof body.actionRunId === "string" && body.actionRunId.trim()
      ? body.actionRunId
      : null;
  if (body.actionRunId !== undefined && !actionRunId) {
    return NextResponse.json({ error: "Invalid actionRunId" }, { status: 400 });
  }

  try {
    switch (action) {
      // ── Start new session ──────────────────────────────────────
      case "start": {
        const task = typeof body.task === "string" ? body.task : undefined;
        const requestedProjectId = typeof body.projectId === "string" ? body.projectId : undefined;
        const requestedConversationId = typeof body.conversationId === "string" ? body.conversationId : undefined;
        const idempotencyKey = stringField(body, "idempotencyKey") ?? undefined;
        const model = typeof body.model === "string" ? body.model : undefined;
        const useProxies = body.useProxies === true;

        // Client-supplied tenant associations are untrusted: they may only
        // flow into a run/session after server-side ownership verification.
        // (Canonical callers derive these from the ActionRun itself.)
        if (requestedProjectId && !(await getProject(requestedProjectId, userId))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        if (requestedConversationId && !(await getConversation(requestedConversationId, userId))) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        let actionRun = actionRunId ? await getActionRun(actionRunId, userId) : null;
        if (actionRunId && !actionRun) {
          return NextResponse.json({ error: "Action run not found" }, { status: 404 });
        }
        if (!actionRun) {
          // Standalone start fallback: an explicit idempotency key makes a
          // retried request return the same run instead of provisioning a
          // second run (and a second billable browser session).
          actionRun = idempotencyKey
            ? await createActionRun({
                userId,
                kind: "browser",
                projectId: requestedProjectId ?? null,
                conversationId: requestedConversationId ?? null,
                idempotencyKey,
              })
            : await startBrowserActionRun({
                userId,
                projectId: requestedProjectId ?? null,
                conversationId: requestedConversationId ?? null,
              });
        }
        if (isTerminalActionRunStatus(actionRun.status)) {
          return NextResponse.json({ error: "Action run is terminal", code: "ACTION_RUN_TERMINAL" }, { status: 409 });
        }

        // Start idempotency for the canonical path: the run already owns a
        // browser session — return it (retry) or reconcile a dead attachment.
        if (actionRun.browserSessionId) {
          const existingSession = await getSession(actionRun.browserSessionId, userId);
          if (isReusableBrowserSession(existingSession)) {
            return NextResponse.json({ session: existingSession, actionRunId: actionRun.id, actionRun });
          }
          try {
            await failBrowserActionRun(
              actionRun,
              new Error("Attached browser session is no longer active"),
              "BROWSER_SESSION_DEAD",
            );
          } catch (reconcileError) {
            console.error("[browser-session] dead-session reconcile failed", {
              userId,
              actionRunId: actionRun.id,
              browserSessionId: actionRun.browserSessionId,
              errorType: reconcileError instanceof Error ? reconcileError.name : typeof reconcileError,
            });
          }
          return NextResponse.json(
            {
              error: "Action run is attached to a browser session that is not active",
              code: "ACTION_BROWSER_SESSION_DEAD",
              actionRunId: actionRun.id,
            },
            { status: 409 },
          );
        }

        let activeSessionCount: number;
        try {
          activeSessionCount = (await dbGetActiveSessionsStrict(userId)).length;
        } catch {
          return NextResponse.json(
            { code: "BROWSER_SESSION_PREFLIGHT_UNAVAILABLE", message: "LiTT couldn't verify browser limits right now." },
            { status: 503 },
          );
        }

        const preflight = await preflightBrowserStart(userId, activeSessionCount);
        if (!preflight.ok) {
          const status =
            preflight.error === "insufficient_bits" || preflight.error === "spend_ceiling_exceeded"
              ? 402
              : preflight.error === "billing_unavailable"
                ? 503
                : 429;
          try {
            await failBrowserActionRun(actionRun, new Error(preflight.message), "BROWSER_SESSION_START_DENIED");
          } catch (persistenceError) {
            console.error("[action-runtime] preflight denial could not be persisted", {
              runId: actionRun?.id,
              userId,
              errorType: persistenceError instanceof Error ? persistenceError.name : typeof persistenceError,
            });
          }
          return NextResponse.json(
            { error: preflight.message, code: preflight.error },
            { status },
          );
        }

        try {
          await closeIdleSessions();
        } catch (error) {
          console.warn("[browser-session] idle cleanup failed", {
            errorType: error instanceof Error ? error.name : typeof error,
            userId,
          });
        }

        let session;
        try {
          session = await startSession({
            userId,
            projectId: actionRun.projectId ?? requestedProjectId,
            conversationId: actionRun.conversationId ?? requestedConversationId,
            task,
            model,
            useProxies,
          });
        } catch (error) {
          try {
            await failBrowserActionRun(actionRun, error, "BROWSER_SESSION_START_FAILED");
          } catch (persistenceError) {
            // Provider start failed AND the failure could not be persisted —
            // the durable run does not reflect reality. Flag reconciliation
            // explicitly instead of letting the client trust the run state.
            const persistenceFailure = mapBrowserFailure(persistenceError, "ACTION_RUNTIME_PERSISTENCE_FAILED");
            console.error("[action-runtime] browser start failure could not be persisted", {
              code: persistenceFailure.code,
              userId,
              actionRunId: actionRun.id,
            });
            return NextResponse.json(
              {
                code: "ACTION_RUNTIME_PERSISTENCE_FAILED",
                message: "The browser couldn't start, and LiTT couldn't record the failure — the task needs reconciliation.",
                actionRunId: actionRun.id,
                runtimeDegraded: true,
              },
              { status: 500 },
            );
          }
          throw error;
        }

        try {
          const linkedRun = await attachBrowserSession(actionRun, session);
          return NextResponse.json({ session, actionRunId: linkedRun.id });
        } catch (attachError) {
          let cleanupFailed = false;
          try {
            await closeSession(session.id, userId);
          } catch (cleanupError) {
            cleanupFailed = true;
            const cleanupFailure = mapBrowserFailure(cleanupError, "BROWSER_SESSION_CLEANUP_FAILED");
            console.error("[browser-session] attach failed and session cleanup failed", {
              code: cleanupFailure.code,
              operation: "attach",
              userId,
              actionRunId: actionRun.id,
              sessionId: session.id,
            });
          }
          const failure = mapBrowserFailure(attachError, "ACTION_RUNTIME_PERSISTENCE_FAILED_AFTER_EXECUTION");
          console.error("[browser-session] attach failed; provider session cleanup attempted", {
            code: failure.code,
            operation: "attach",
            userId,
            actionRunId: actionRun.id,
            sessionId: session.id,
            cleanupFailed,
          });
          return NextResponse.json(
            {
              code: "ACTION_RUNTIME_PERSISTENCE_FAILED_AFTER_EXECUTION",
              message: "The browser started, but LiTT couldn't attach it to the task state.",
              actionRunId: actionRun.id,
              sessionCleanup: cleanupFailed ? "failed" : "closed",
            },
            { status: 500 },
          );
        }
      }

      // ── Pause agent control ────────────────────────────────────
      case "pause": {
        const sessionId = stringField(body, "sessionId");
        if (!sessionId) return NextResponse.json({ error: body.sessionId === undefined ? "Missing sessionId" : "Invalid sessionId" }, { status: 400 });
        const resolved = await resolveRunForRequest(userId, actionRunId, sessionId);
        if (resolved.error) return resolved.error;

        const session = await pauseSession(sessionId, userId);
        if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
        try {
          const run = await markBrowserSessionPaused(userId, session, resolved.run?.id);
          return NextResponse.json({ session, actionRunId: run?.id ?? resolved.run?.id ?? null });
        } catch (error) {
          return runtimeAfterExecutionResponse("pause", userId, sessionId, resolved.run?.id ?? actionRunId, error);
        }
      }

      // ── Take control (human) ───────────────────────────────────
      case "take_control": {
        const sessionId = stringField(body, "sessionId");
        if (!sessionId) return NextResponse.json({ error: body.sessionId === undefined ? "Missing sessionId" : "Invalid sessionId" }, { status: 400 });
        const resolved = await resolveRunForRequest(userId, actionRunId, sessionId);
        if (resolved.error) return resolved.error;

        const session = await takeControl(sessionId, userId);
        if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
        try {
          const run = await markBrowserSessionControl(userId, session, resolved.run?.id);
          return NextResponse.json({ session, actionRunId: run?.id ?? resolved.run?.id ?? null });
        } catch (error) {
          return runtimeAfterExecutionResponse("take_control", userId, sessionId, resolved.run?.id ?? actionRunId, error);
        }
      }

      // ── Return control to agent ────────────────────────────────
      case "return_control": {
        const sessionId = stringField(body, "sessionId");
        if (!sessionId) return NextResponse.json({ error: body.sessionId === undefined ? "Missing sessionId" : "Invalid sessionId" }, { status: 400 });
        const resolved = await resolveRunForRequest(userId, actionRunId, sessionId);
        if (resolved.error) return resolved.error;

        const session = await returnControl(sessionId, userId);
        if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
        try {
          const run = await markBrowserSessionControl(userId, session, resolved.run?.id);
          return NextResponse.json({ session, actionRunId: run?.id ?? resolved.run?.id ?? null });
        } catch (error) {
          return runtimeAfterExecutionResponse("return_control", userId, sessionId, resolved.run?.id ?? actionRunId, error);
        }
      }

      // ── Close session ──────────────────────────────────────────
      case "close": {
        const sessionId = stringField(body, "sessionId");
        if (!sessionId) return NextResponse.json({ error: body.sessionId === undefined ? "Missing sessionId" : "Invalid sessionId" }, { status: 400 });
        const resolved = await resolveRunForRequest(userId, actionRunId, sessionId, { allowTerminal: true });
        if (resolved.error) return resolved.error;
        const owned = await getSession(sessionId, userId);
        if (!owned) return NextResponse.json({ error: "Session not found" }, { status: 404 });

        const closed = await closeSession(sessionId, userId);
        if (!closed) return NextResponse.json({ error: "Session not found" }, { status: 404 });

        const run = resolved.run;
        if (run) {
          try {
            await recordBrowserSessionClosed(
              { actionRunId: run.id, userId, browserSessionId: sessionId },
              "Browser session closed",
            );
          } catch (error) {
            return runtimeAfterExecutionResponse("close", userId, sessionId, run.id, error);
          }
        }
        return NextResponse.json({
          success: true,
          actionRunId: run?.id ?? null,
          run: run ?? null,
          runStatus: run?.status ?? null,
        });
      }

      // ── Screenshot ─────────────────────────────────────────────
      case "screenshot": {
        const sessionId = stringField(body, "sessionId");
        if (!sessionId) return NextResponse.json({ error: body.sessionId === undefined ? "Missing sessionId" : "Invalid sessionId" }, { status: 400 });

        // Phase 6 — owner check before serving session pixels: a caller
        // that doesn't own the session gets 404, never another user's
        // browser (takeScreenshot's own check is the second layer).
        const owned = await getSession(sessionId, userId);
        if (!owned) return NextResponse.json({ error: "Session not found" }, { status: 404 });

        const screenshot = await takeScreenshot(sessionId, userId);
        if (!screenshot) return NextResponse.json({ error: "Failed to capture screenshot" }, { status: 500 });

        return NextResponse.json({ screenshot });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const failure = mapBrowserFailure(err, "BROWSER_SESSION_REQUEST_FAILED");
    console.error("[browser-session] request failed", {
      code: failure.code,
      userId,
    });
    return safeErrorResponse(err, "BROWSER_SESSION_REQUEST_FAILED", 500);
  }
}

export const GET = withRateLimit(handler, 30, 60);
export const POST = withRateLimit(handler, 20, 60);
