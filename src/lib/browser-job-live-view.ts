/**
 * Browser job live view — server assembly (Phase 6).
 *
 * `getJobLiveView(jobId, userId)` is the owner-checked backend for
 * GET /api/browser/jobs/[id]/live-view. It answers exactly one
 * question: may the Studio panel show the live iframe for this job
 * right now, and if so, which URL may it embed?
 *
 * Security:
 *   - The job is fetched via getJob(jobId, userId) — a non-owner gets
 *     null (404), never the liveViewUrl.
 *   - The session is fetched via dbGetSession(sessionId, userId) —
 *     owner-scoped at the DB layer.
 *   - The embeddable URL (Browserbase Debug API debuggerFullscreenUrl)
 *     is only returned when the availability rule says "live". The
 *     dashboard page URL (openUrl) is returned for the "open in new
 *     tab" link — also owner-scoped by the same gate.
 *   - The capability URL is never logged.
 */

import "server-only";
import { getJob } from "@/lib/browser-jobs";
import {
  dbGetSession,
  type SessionStatus,
} from "@/lib/litt-intelligence/browser-session-manager";
import { resolveLiveEmbedUrl, __clearSessionLiveViewEmbedCache } from "./browser-session-live-view";
import {
  resolveLiveViewAvailability,
  type JobStatusLike,
  type LiveViewAvailability,
  type SessionStatusLike,
} from "./browser-live-view";

export interface JobLiveViewInfo extends LiveViewAvailability {
  /**
   * The iframe-embeddable live URL (Browserbase debugger fullscreen,
   * navbar hidden). Present ONLY when available === true — never hand
   * out a capability URL the panel isn't allowed to frame.
   */
  embedUrl: string | null;
  /** Dashboard session page, for "open in new tab" (owner only). */
  openUrl: string | null;
  sessionStatus: SessionStatus | null;
  checkedAt: string;
}

/** The embed-URL resolver (and its cache) is shared with the session
 *  live-view module — one cache, one lazy-fetch path for both the
 *  Studio browser-jobs panel and the chat-embedded panel. */
function toSessionStatusLike(status: SessionStatus | null): SessionStatusLike | null {
  // SessionStatus and SessionStatusLike share the same literals.
  return status as SessionStatusLike | null;
}

/**
 * Owner-checked live-view resolution for a browser job.
 *
 * Returns null when the job doesn't exist or doesn't belong to
 * `userId` — the route turns this into a 404. The caller never sees
 * the liveViewUrl in that case.
 */
export async function getJobLiveView(
  jobId: string,
  userId: string,
): Promise<JobLiveViewInfo | null> {
  const job = await getJob(jobId, userId);
  if (!job) return null;

  const openUrl = job.liveViewUrl;

  const session = job.browserSessionId
    ? await dbGetSession(job.browserSessionId, userId).catch(() => null)
    : null;

  const embedUrl = session
    ? await resolveLiveEmbedUrl(
        session.browserbaseSessionId,
        (session.metadata as Record<string, unknown> | undefined)?.liveEmbedUrl,
      )
    : null;

  const availability = resolveLiveViewAvailability({
    url: embedUrl ?? openUrl,
    embedUrlKnown: embedUrl !== null,
    jobStatus: job.status as JobStatusLike,
    sessionStatus: toSessionStatusLike(session?.status ?? null),
    sessionUpdatedAt: session?.updatedAt ?? null,
    nowMs: Date.now(),
  });

  return {
    ...availability,
    // The capability URL leaves this server only when the rule says
    // the panel may actually frame it.
    embedUrl: availability.available ? embedUrl : null,
    openUrl,
    sessionStatus: session?.status ?? null,
    checkedAt: new Date().toISOString(),
  };
}

/** Test-only: clear the embed-URL cache between cases. Kept under the
 *  original name so existing Phase 6 tests keep passing; delegates to
 *  the shared resolver's cache. */
export function __clearLiveViewEmbedCache(): void {
  __clearSessionLiveViewEmbedCache();
}
