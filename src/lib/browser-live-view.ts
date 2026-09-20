/**
 * Browser live view — availability rule (Phase 6).
 *
 * Pure, client-safe logic that defines EXACTLY when the Browserbase
 * live view may be shown. No server-only imports: the Studio panel
 * consumes the reason copy from this module, and the server endpoint
 * (`GET /api/browser/jobs/[id]/live-view`) consumes the rule.
 *
 * The availability rule (all must hold):
 *   1. An embeddable live URL is known. Per Browserbase's docs the
 *      iframe-embeddable URL is the Debug API's `debuggerFullscreenUrl`
 *      (the plain `browserbase.com/sessions/<id>` dashboard page is NOT
 *      used for embedding — it can show a login wall, and a login wall
 *      in an iframe is a broken frame). If we have no embed URL we do
 *      NOT iframe the dashboard page; we fall back to snapshots.
 *   2. The job is still running (queued/running/awaiting_approval/
 *      approved). Terminal jobs have their sessions closed — the live
 *      view is dead.
 *   3. The session row is in an active-like status (active, agent_control,
 *      paused, human_control) — live-checked via the DB row, never
 *      assumed. closed/error/missing → not available.
 *   4. The session row is fresh (updatedAt within the idle TTL). A stale
 *      row means the provider session is gone or the sweeper is about
 *      to close it — never show a "live" frame on a dead session.
 *
 * A failed probe is never "disconnected": the caller keeps its current
 * state when the endpoint errors (a network blip must not flip a live
 * view to a confident wrong state).
 */

export type SessionStatusLike =
  | "active"
  | "paused"
  | "human_control"
  | "agent_control"
  | "closed"
  | "error";

export type JobStatusLike =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "approved"
  | "completed"
  | "failed"
  | "cancelled";

export type LiveViewUnavailableReason =
  | "no_live_view_url"
  | "embed_unavailable"
  | "job_finished"
  | "session_not_found"
  | "session_closed"
  | "session_stale";

export type LiveViewAvailableReason = "live";

export interface ResolveLiveViewAvailabilityInput {
  /**
   * The URL the iframe would embed (the Browserbase debugger
   * fullscreen URL). Null when no URL is known at all.
   */
  url: string | null;
  /**
   * False when `url` is only the dashboard page URL (or unknown): the
   * embeddable debugger URL was never obtained. We refuse to iframe
   * the dashboard page — never show a broken/empty iframe.
   */
  embedUrlKnown: boolean;
  /**
   * Owning job's status. Null when the view is not job-scoped (e.g.
   * the chat session chip).
   */
  jobStatus: JobStatusLike | null;
  /**
   * Live-checked session status. Null when no session row exists.
   */
  sessionStatus: SessionStatusLike | null;
  /**
   * Session row's updatedAt (ISO). Null when unknown.
   */
  sessionUpdatedAt: string | null;
  nowMs: number;
}

export interface LiveViewAvailability {
  available: boolean;
  reason: LiveViewAvailableReason | LiveViewUnavailableReason;
}

/**
 * Must match SESSION_IDLE_TIMEOUT_MS in browser-session-manager.ts.
 * A session row older than this is treated as dead: the provider
 * session is gone or the idle sweeper will close it imminently.
 */
export const LIVE_VIEW_STALE_AFTER_MS = 10 * 60 * 1000;

const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatusLike> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

const TERMINAL_SESSION_STATUSES: ReadonlySet<SessionStatusLike> = new Set([
  "closed",
  "error",
]);

const ACTIVE_LIKE_SESSION_STATUSES: ReadonlySet<SessionStatusLike> = new Set([
  "active",
  "paused",
  "human_control",
  "agent_control",
]);

function isStaleMs(updatedAtIso: string | null, nowMs: number): boolean {
  if (!updatedAtIso) return true;
  const t = new Date(updatedAtIso).getTime();
  if (Number.isNaN(t)) return true;
  return nowMs - t > LIVE_VIEW_STALE_AFTER_MS;
}

/**
 * The deterministic availability rule. Every branch returns an explicit
 * reason so the UI can label the fallback honestly.
 */
export function resolveLiveViewAvailability(
  input: ResolveLiveViewAvailabilityInput,
): LiveViewAvailability {
  if (!input.url) {
    return { available: false, reason: "no_live_view_url" };
  }
  if (!input.embedUrlKnown) {
    return { available: false, reason: "embed_unavailable" };
  }
  if (input.jobStatus !== null && TERMINAL_JOB_STATUSES.has(input.jobStatus)) {
    return { available: false, reason: "job_finished" };
  }
  if (input.sessionStatus === null) {
    return { available: false, reason: "session_not_found" };
  }
  if (TERMINAL_SESSION_STATUSES.has(input.sessionStatus)) {
    return { available: false, reason: "session_closed" };
  }
  if (!ACTIVE_LIKE_SESSION_STATUSES.has(input.sessionStatus)) {
    // Unknown/future status — fail closed, never assume live.
    return { available: false, reason: "session_closed" };
  }
  if (isStaleMs(input.sessionUpdatedAt, input.nowMs)) {
    return { available: false, reason: "session_stale" };
  }
  return { available: true, reason: "live" };
}

/**
 * Honest UI copy per reason. The fallback header must never imply a
 * live browser: snapshots are labeled as snapshots (brief §B).
 */
export const LIVE_VIEW_REASON_COPY: Record<
  LiveViewAvailableReason | LiveViewUnavailableReason,
  { title: string; detail: string }
> = {
  live: {
    title: "Live browser view",
    detail: "Streaming the agent's browser in real time.",
  },
  no_live_view_url: {
    title: "Live view unavailable — latest snapshot below",
    detail: "This session has no live view URL. What follows are snapshots, not a live browser.",
  },
  embed_unavailable: {
    title: "Live view unavailable — latest snapshot below",
    detail: "The embeddable live stream could not be established. What follows are snapshots, not a live browser.",
  },
  job_finished: {
    title: "Job finished — final snapshots below",
    detail: "The browser session closed when the job ended. These snapshots are the record of what it did.",
  },
  session_not_found: {
    title: "Live view unavailable — latest snapshot below",
    detail: "The browser session no longer exists. What follows are snapshots, not a live browser.",
  },
  session_closed: {
    title: "Session closed — snapshots below",
    detail: "The browser session has ended. These snapshots are the record of what it saw.",
  },
  session_stale: {
    title: "Live view unavailable — latest snapshot below",
    detail: "The browser session went quiet and is treated as ended. What follows are snapshots, not a live browser.",
  },
};

/** Copy for the mid-view disconnect state (probe-confirmed, never assumed). */
export const LIVE_VIEW_DISCONNECTED_COPY = {
  title: "Disconnected — latest snapshot below",
  detail:
    "The live stream dropped. The session may have ended on the provider side. What follows are snapshots, not a live browser.",
} as const;
