import "server-only";

import {
  getActionRunByBrowserSession,
  recordActionEventActivity,
  transitionActionRunEventActivity,
} from "./run-store";
import { isTerminalActionRunStatus } from "./state-machine";
import type { BrowserSession } from "@/lib/litt-intelligence/browser-session-manager";

export const BROWSER_SESSION_IDLE_TIMEOUT_CODE = "BROWSER_SESSION_IDLE_TIMEOUT";
const IDLE_TIMEOUT_MESSAGE = "The browser session expired after being idle.";

export type BrowserSweepReconcileOutcome =
  /** Session was attached to no run — nothing to reconcile. */
  | "no_run"
  /** Attached run is terminal — its lifecycle is immutable; only provider/billing cleanup applied. */
  | "terminal_preserved"
  /** Browser-kind run: the run IS the browser task and cannot continue — deliberately failed. */
  | "run_failed"
  /** Non-browser parent: resource loss recorded as an event; the parent owns its lifecycle. */
  | "event_recorded";

/**
 * Reconciles the Action Runtime after the idle sweeper closes a browser
 * session. Called once per closed session by the sweeper that won the
 * conditional close — losers reconcile nothing, so lifecycle events can't
 * duplicate across concurrent sweeps or replicas.
 *
 * Truth rules:
 *  - terminal runs are never rewritten (completed stays completed — the
 *    browser resource closing later must not resurrect or re-close it);
 *  - browser-kind runs cannot continue without their only resource, so
 *    they transition to failed with an explicit idle-timeout code;
 *  - composite/agent/studio parents may still be resumable or may no
 *    longer need the browser — the resource loss is recorded as
 *    `browser.session.completed { reason: "idle_timeout" }` and the
 *    orchestrator decides whether to pause, resume, or fail;
 *  - a browser resource closing NEVER marks a run completed.
 */
export async function reconcileSweptBrowserSession(
  session: Pick<BrowserSession, "id" | "userId">,
): Promise<BrowserSweepReconcileOutcome> {
  const run = await getActionRunByBrowserSession(session.userId, session.id);
  if (!run) return "no_run";
  if (isTerminalActionRunStatus(run.status)) return "terminal_preserved";

  if (run.kind === "browser") {
    await transitionActionRunEventActivity({
      runId: run.id,
      userId: session.userId,
      status: "failed",
      eventType: "browser.session.completed",
      payload: { browserSessionId: session.id, reason: "idle_timeout" },
      message: IDLE_TIMEOUT_MESSAGE,
      patch: {
        failureCode: BROWSER_SESSION_IDLE_TIMEOUT_CODE,
        failureMessage: IDLE_TIMEOUT_MESSAGE,
      },
    });
    return "run_failed";
  }

  await recordActionEventActivity({
    runId: run.id,
    userId: session.userId,
    type: "browser.session.completed",
    payload: { browserSessionId: session.id, reason: "idle_timeout" },
    message: "Browser session expired after being idle",
  });
  return "event_recorded";
}
