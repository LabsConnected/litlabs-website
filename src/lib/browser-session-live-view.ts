/**
 * Browser session live view — server assembly (chat-first-class).
 *
 * `getSessionLiveView(sessionId, userId)` is the owner-checked backend for
 * GET /api/litt/browser/session/live-view. It answers exactly one
 * question: may the Studio chat panel show the live iframe for this
 * conversation's browser session right now, and if so, which URL may it
 * embed?
 *
 * This is the session-scoped sibling of `getJobLiveView`
 * (src/lib/browser-job-live-view.ts): same availability rule
 * (src/lib/browser-live-view.ts), same honesty contract — but
 * jobStatus is null because a chat-initiated session is not a browser
 * job. The embed-URL resolver is shared between the two.
 *
 * Security (mirrors the job endpoint):
 *   - The session is fetched via dbGetSession(sessionId, userId) —
 *     owner-scoped at the DB layer. A non-owner gets null (404), never
 *     the liveViewUrl.
 *   - The embeddable URL (Browserbase Debug API debuggerFullscreenUrl)
 *     is only returned when the availability rule says "live".
 *   - The capability URL is never logged.
 */

import "server-only";
import {
  dbGetSession,
  dbGetActiveSessions,
  fetchLiveEmbedUrl,
  type BrowserSession,
  type SessionStatus,
} from "@/lib/litt-intelligence/browser-session-manager";
import {
  resolveLiveViewAvailability,
  type LiveViewAvailability,
  type SessionStatusLike,
} from "./browser-live-view";

export interface SessionLiveViewInfo extends LiveViewAvailability {
  /**
   * The iframe-embeddable live URL (Browserbase debugger fullscreen,
   * navbar hidden). Present ONLY when available === true — never hand
   * out a capability URL the panel isn't allowed to frame.
   */
  embedUrl: string | null;
  /** Dashboard session page, for "open in new tab" (owner only). */
  openUrl: string | null;
  sessionId: string | null;
  sessionStatus: SessionStatus | null;
  checkedAt: string;
}

/** Cache of resolved embed URLs: sessionId → { url, fetchedAt }. */
const embedUrlCache = new Map<string, { url: string; fetchedAt: number }>();
const EMBED_URL_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Resolve the embeddable live URL for a session.
 *
 * 1. Stored `metadata.liveEmbedUrl` (written by startSession).
 * 2. Lazy fetch from the Browserbase Debug API — cached 5 minutes per
 *    session so the polling panel doesn't hammer the provider API.
 * 3. null (fail-soft) → the availability rule then refuses the
 *    iframe and the panel shows the honest fallback.
 */
export async function resolveLiveEmbedUrl(
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

function toLiveViewInfo(session: BrowserSession, embedUrl: string | null): SessionLiveViewInfo {
  const openUrl = session.liveViewUrl;
  const availability = resolveLiveViewAvailability({
    url: embedUrl ?? openUrl,
    embedUrlKnown: embedUrl !== null,
    // Chat sessions are not browser jobs: no job lifecycle to check.
    jobStatus: null,
    sessionStatus: toSessionStatusLike(session.status),
    sessionUpdatedAt: session.updatedAt,
    nowMs: Date.now(),
  });
  return {
    ...availability,
    // The capability URL leaves this server only when the rule says
    // the panel may actually frame it.
    embedUrl: availability.available ? embedUrl : null,
    openUrl,
    sessionId: session.id,
    sessionStatus: session.status,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Owner-checked live-view resolution for one browser session.
 *
 * Returns null when the session doesn't exist or doesn't belong to
 * `userId` — the route turns this into a 404. The caller never sees
 * the liveViewUrl in that case.
 */
export async function getSessionLiveView(
  sessionId: string,
  userId: string,
): Promise<SessionLiveViewInfo | null> {
  const session = await dbGetSession(sessionId, userId).catch(() => null);
  if (!session) return null;
  const embedUrl = await resolveLiveEmbedUrl(
    session.browserbaseSessionId,
    (session.metadata as Record<string, unknown> | undefined)?.liveEmbedUrl,
  );
  return toLiveViewInfo(session, embedUrl);
}

/**
 * Owner-checked live-view resolution for a conversation's browser
 * session: the newest active-like session row bound to the
 * conversation. Returns null when the conversation has no session
 * (the panel renders nothing) or none belongs to `userId`.
 */
export async function getConversationLiveView(
  conversationId: string,
  userId: string,
): Promise<SessionLiveViewInfo | null> {
  const sessions = await dbGetActiveSessions(userId).catch(() => []);
  const session = sessions
    .filter((s) => s.conversationId === conversationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!session) return null;
  const embedUrl = await resolveLiveEmbedUrl(
    session.browserbaseSessionId,
    (session.metadata as Record<string, unknown> | undefined)?.liveEmbedUrl,
  );
  return toLiveViewInfo(session, embedUrl);
}

/** Test-only: clear the embed-URL cache between cases. */
export function __clearSessionLiveViewEmbedCache(): void {
  embedUrlCache.clear();
}
