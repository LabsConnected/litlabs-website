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
  fetchLiveEmbedUrl,
  type SessionStatus,
} from "@/lib/litt-intelligence/browser-session-manager";
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

/** Cache of resolved embed URLs: sessionId → { url, fetchedAt }. */
const embedUrlCache = new Map<string, { url: string; fetchedAt: number }>();
const EMBED_URL_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Resolve the embeddable live URL for a session.
 *
 * 1. Stored `metadata.liveEmbedUrl` (written by startSession, Phase 6).
 * 2. Lazy fetch from the Browserbase Debug API for pre-Phase-6
 *    sessions — cached 5 minutes per session so the polling panel
 *    doesn't hammer the provider API.
 * 3. null (fail-soft) → the availability rule then refuses the
 *    iframe and the panel shows snapshots.
 */
async function resolveEmbedUrl(
  browserbaseSessionId: string | null,
  storedEmbedUrl: unknown,
): Promise<string | null> {
  if (typeof storedEmbedUrl === "string" && storedEmbedUrl) {
    return storedEmbedUrl;
  }
  if (!browserbaseSessionId) return null;

  const cached = embedUrlCache.get(browserbaseSessionId);
  if (cached && Date.now() - cached.fetchedAt < EMBED_URL_CACHE_TTL_MS) {
    return cached.url;
  }

  const url = await fetchLiveEmbedUrl(browserbaseSessionId).catch(() => null);
  if (url) {
    embedUrlCache.set(browserbaseSessionId, { url, fetchedAt: Date.now() });
  }
  return url;
}

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
    ? await resolveEmbedUrl(
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

/** Test-only: clear the embed-URL cache between cases. */
export function __clearLiveViewEmbedCache(): void {
  embedUrlCache.clear();
}
