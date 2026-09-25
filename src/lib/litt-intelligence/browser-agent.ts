/**
 * LiTT Agent Browser — chat-facing orchestration (Phase 1 + Phase 2).
 *
 * This module is the seam between the Studio chat and the Browserbase +
 * Stagehand session infrastructure (`browser-session-manager.ts`,
 * `browser-tool-handlers.ts`, built 2026-08-11). It provides:
 *
 * - `isBrowserBetaAllowed` — account gate. The agent browser is private
 *   beta until BITS metering ships (Phase 4); until then only the
 *   platform owner's account may start sessions.
 * - `startAgentBrowserSession` — gated session start with honest errors.
 * - `getActiveSession` — find the user's genuinely live session for a
 *   conversation (in-process Stagehand, inside the idle TTL), or null.
 * - `getOrReuseAgentBrowserSession` — get-or-reuse path: reuse the live
 *   session for this conversation instead of starting a new one. This is
 *   what makes multi-turn browsing work across chat turns; the agent's
 *   `browser.start_session` tool calls this.
 * - `runOneShotScreenshot` — the Phase 1 end-to-end loop: start a session,
 *   navigate to a URL, capture a screenshot snapshot, close the session.
 *   The session is ALWAYS closed (no orphaned Browserbase sessions),
 *   and every failure is reported truthfully — never a fake screenshot.
 *   The one-shot path keeps closing immediately; only multi-turn use
 *   (via get-or-reuse) keeps sessions open across turns.
 *
 * Security posture (V1):
 * - Clean profile only: Browserbase sessions start with zero cookies,
 *   zero logins, zero extensions. The agent never touches the user's
 *   authenticated sessions.
 * - Page content is untrusted data and must never override user
 *   instructions or approvals.
 */

import "server-only";
import { isOwnerClerkId } from "@/lib/owner";
import { normalizeBrowserUrl } from "./browser-url-policy";
import {
  preflightBrowserStart,
  getDailyBrowserMinutesUsed,
  DAILY_BROWSER_MINUTES_QUOTA,
  QUOTA_PAUSED_MESSAGE,
  type BrowserStartRefusal,
} from "./browser-billing";
import {
  startSession,
  closeSession,
  closeIdleSessions,
  getStagehand,
  getOrReattachStagehand,
  pauseSession,
  dbGetActiveSessions,
  dbGetSession,
  type BrowserSession,
} from "./browser-session-manager";
import { browserToolHandlers } from "./browser-tool-handlers";

// Re-exported from the policy module (moved there in Phase 2 so the
// navigate tool path can share it without an import cycle).
export { normalizeBrowserUrl };

// ─── Beta gate ─────────────────────────────────────────────────────

/**
 * The agent browser is private beta until per-minute BITS metering ships
 * (Phase 4). Until then, only the platform owner's account may use it —
 * browser minutes are real vendor cost and currently unmetered.
 *
 * Note: in the standard auth path userId === clerkId, and existing
 * owner-gated routes already call isOwnerClerkId(userId) directly.
 */
export function isBrowserBetaAllowed(
  userId: string | null | undefined,
): boolean {
  return isOwnerClerkId(userId);
}

/** Shown when a non-beta account reaches the agent browser. */
export const BROWSER_BETA_ONLY_MESSAGE =
  "Browser control is in private beta on this account, so I can't open a browser for you yet.";

/** Shown when the browser backend is not configured. Never fake a screenshot. */
export const BROWSER_UNAVAILABLE_MESSAGE =
  "The browser isn't available right now (not configured on the server). I can't take a screenshot — no image was captured.";

// ─── URL handling (Phase 2) ──────────────────────────────────────
// normalizeBrowserUrl lives in ./browser-url-policy (re-exported above)
// so the navigate tool path shares the exact same normalization.

// ─── Chat intent (Phase 1) ─────────────────────────────────────────

/**
 * Screenshot requests must be short, explicit commands. A broad substring
 * match lets words in a longer coding task hijack the request into browser
 * control before the code agent can see it.
 */
const SCREENSHOT_COMMAND = /^(?:(?:take|grab|capture|get)\s*)?(?:a\s+)?screen(?:shot|\s+shot|\s+capture)\b/i;
const SCREENSHOT_URL = /\bhttps?:\/\/|\b[\w-]+\.(?:com|net|org|io|dev|app)\b/i;
const SCREENSHOT_TASK_CUES = /\b(fix|bug|regression|refactor|test)\b/i;

/**
 * True when the message asks LiTT to screenshot a page.
 */
export function detectScreenshotIntent(message: string): boolean {
  const text = (message ?? "").trim();
  if (!text) return false;

  // "what does example.com look like" is a separate, constrained question form.
  if (/\bwhat does\b.+\blook like\b/i.test(text)) {
    return Boolean(extractScreenshotUrl(text));
  }

  const looksLikeTask = text.length > 200 || /\n/.test(text) || SCREENSHOT_TASK_CUES.test(text);
  return SCREENSHOT_COMMAND.test(text) && !looksLikeTask &&
    (SCREENSHOT_URL.test(text) || text.length < 60);
}

/**
 * Pull a URL (or bare domain) out of a screenshot request.
 * Returns the raw match; normalizeBrowserUrl decides if it's loadable.
 */
export function extractScreenshotUrl(message: string): string | null {
  if (!message) return null;
  const clean = (s: string) => s.replace(/[.,;:!?]+$/, "");
  // Explicit http(s) URL anywhere in the message.
  const urlMatch = message.match(/https?:\/\/[^\s)>"']+/i);
  if (urlMatch) return clean(urlMatch[0]);
  // Bare domain after the trigger, e.g. "screenshot of example.com".
  const domainMatch = message.match(
    /(?:screenshot|screen\s?shot|screen\s?capture|capture)[\w\s]{0,12}?\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?:\/[^\s)>"']*)?/i,
  );
  if (domainMatch) return clean(domainMatch[1]);
  // Fallback: any bare domain-like token, e.g. "what does example.com look like".
  const bareMatch = message.match(
    /\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?:\/[^\s)>"']*)?/i,
  );
  if (bareMatch) return clean(bareMatch[1]);
  return null;
}

// ─── Session start (gated) ─────────────────────────────────────────

export interface StartAgentBrowserSessionOptions {
  userId: string;
  task?: string;
  conversationId?: string;
  projectId?: string;
  /**
   * The ActionRun's durable browserSessionId, when the caller already
   * resolved a run. Lets the get-or-reuse path re-attach to the run's
   * session across server instances/restarts instead of starting a new
   * vendor session that the run's attach guard would then reject with
   * ACTION_BROWSER_SESSION_MISMATCH.
   */
  attachedSessionId?: string;
}

export type StartAgentBrowserSessionResult =
  | {
      ok: true;
      session: BrowserSession;
      message: string;
      reused: boolean;
      /**
       * Set when a fresh session was started because the previously
       * attached session (this id) was no longer reusable. The caller
       * must supersede the run's attachment instead of plain-attaching,
       * or the attach guard will throw ACTION_BROWSER_SESSION_MISMATCH.
       */
      supersededSessionId?: string;
    }
  | {
      ok: false;
      error:
        | "beta_only"
        | "unavailable"
        | "start_failed"
        | BrowserStartRefusal;
      message: string;
    };

/**
 * Start an agent browser session for a user, enforcing the beta gate
 * then the Phase 4 BITS preflight (fail closed: no balance → no
 * session; caps/quota → honest refusal before any vendor cost accrues).
 * Returns a discriminated result — never throws for expected failures
 * so callers can report them honestly.
 */
export async function startAgentBrowserSession(
  options: StartAgentBrowserSessionOptions,
): Promise<StartAgentBrowserSessionResult> {
  if (!isBrowserBetaAllowed(options.userId)) {
    return {
      ok: false,
      error: "beta_only",
      message: BROWSER_BETA_ONLY_MESSAGE,
    };
  }

  // Phase 4 — budget preflight BEFORE any provider session exists.
  const preflight = await preflightBrowserStart(
    options.userId,
    (await dbGetActiveSessions(options.userId).catch(() => [])).length,
  );
  if (!preflight.ok) {
    return { ok: false, error: preflight.error, message: preflight.message };
  }

  try {
    const session = await startSession({
      userId: options.userId,
      task: options.task,
      conversationId: options.conversationId,
      projectId: options.projectId,
    });
    return {
      ok: true,
      session,
      reused: false,
      message:
        "Browser session started — fresh clean profile, no logins. " +
        "Browser time costs 45 LiTTBits per started minute. " +
        `I'll announce what I'm doing with it. (session ${session.id})`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (/BROWSERBASE_API_KEY/i.test(detail)) {
      return { ok: false, error: "unavailable", message: BROWSER_UNAVAILABLE_MESSAGE };
    }
    return {
      ok: false,
      error: "start_failed",
      message: `The browser couldn't start (${detail}). No session was created.`,
    };
  }
}

// ─── Multi-turn session reuse (Phase 2) ────────────────────────────

/**
 * Find the user's genuinely LIVE browser session for a conversation.
 *
 * "Live" is checked, not assumed: the session must be recorded as active
 * (or agent_control) in the DB AND have a live Stagehand instance in this
 * process (`getStagehand` non-null), AND be inside the 10-minute idle TTL.
 * A DB row with no live Stagehand here is not reusable (multi-instance
 * re-attach is Phase 5), so this returns null rather than a dead session.
 *
 * Sweeps idle sessions first so expired sessions are closed, not reused.
 * Never throws — returns null when nothing reusable exists.
 */
export async function getActiveSession(
  userId: string,
  conversationId?: string,
): Promise<BrowserSession | null> {
  try {
    // Wire the agent to the idle TTL: close expired sessions before
    // deciding what is reusable.
    await closeIdleSessions().catch(() => {});

    const sessions = await dbGetActiveSessions(userId);
    const candidates = sessions
      .filter((s) =>
        conversationId ? s.conversationId === conversationId : true,
      )
      .filter((s) => s.status === "active" || s.status === "agent_control")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    for (const candidate of candidates) {
      // getStagehand also refreshes the activity heartbeat on hit, so a
      // reused session's idle clock restarts here.
      if (getStagehand(candidate.id)) {
        return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export type GetOrReuseAgentBrowserSessionResult = StartAgentBrowserSessionResult;

/**
 * Get-or-reuse path for the agent's `browser.start_session` tool.
 *
 * When the user already has a live session for this conversation
 * (same userId + conversationId), return it with `reused: true` instead
 * of starting a new one — this is what keeps a browser alive across chat
 * turns ("now click the pricing link") without spawning a new
 * Browserbase session per turn. Otherwise start fresh (beta-gated).
 *
 * The one-shot screenshot path does NOT use this — it calls
 * `startAgentBrowserSession` directly and always closes the session.
 */
export async function getOrReuseAgentBrowserSession(
  options: StartAgentBrowserSessionOptions,
): Promise<GetOrReuseAgentBrowserSessionResult> {
  if (!isBrowserBetaAllowed(options.userId)) {
    return {
      ok: false,
      error: "beta_only",
      message: BROWSER_BETA_ONLY_MESSAGE,
    };
  }

  const existing = await getActiveSession(options.userId, options.conversationId);
  if (existing) {
    // Phase 4: on reuse, re-check ONLY the daily quota (a balance check
    // here is redundant with per-action gating + settle; the quota is the
    // per-action guard; the rate limit and session cap apply to NEW
    // starts, not reuse). Quota-exhausted → pause now with the
    // plain-English message instead of handing back a session that
    // would pause on its next action anyway.
    const dailyMinutes = await getDailyBrowserMinutesUsed(options.userId);
    if (dailyMinutes >= DAILY_BROWSER_MINUTES_QUOTA) {
      await pauseSession(existing.id, options.userId).catch(() => {});
      return {
        ok: false,
        error: "quota_exhausted",
        message: QUOTA_PAUSED_MESSAGE,
      };
    }
    return {
      ok: true,
      session: existing,
      reused: true,
      message:
        `Reusing your active browser session (session ${existing.id}) — ` +
        "no new session started.",
    };
  }

  // Cross-instance recovery: the run may already be attached to a session
  // whose Stagehand lives in another process (different Railway replica or
  // a restart since the session started). getActiveSession only sees
  // in-process handles, so without this the path below would start a
  // second vendor session and the run's attach guard would reject it
  // with ACTION_BROWSER_SESSION_MISMATCH. Re-attach to the durable
  // session first — transparent when the provider session is still alive.
  if (options.attachedSessionId) {
    const dailyMinutes = await getDailyBrowserMinutesUsed(options.userId);
    if (dailyMinutes >= DAILY_BROWSER_MINUTES_QUOTA) {
      await pauseSession(options.attachedSessionId, options.userId).catch(() => {});
      return {
        ok: false,
        error: "quota_exhausted",
        message: QUOTA_PAUSED_MESSAGE,
      };
    }
    const reattached = await getOrReattachStagehand(options.attachedSessionId, options.userId).catch(() => null);
    if (reattached?.stagehand) {
      const session = await dbGetSession(options.attachedSessionId, options.userId).catch(() => null);
      if (session) {
        return {
          ok: true,
          session,
          reused: true,
          message:
            `Re-attached to your existing browser session (session ${session.id}) — ` +
            "no new session started.",
        };
      }
    }
    // The attached session is gone (expired/closed at the provider or
    // past the idle TTL): start fresh, and tell the caller to supersede
    // the dead attachment instead of plain-attaching.
    const fresh = await startAgentBrowserSession(options);
    if (fresh.ok) {
      return { ...fresh, supersededSessionId: options.attachedSessionId };
    }
    return fresh;
  }

  return startAgentBrowserSession(options);
}

// ─── One-shot screenshot (Phase 1 loop) ────────────────────────────

export type OneShotScreenshotError =
  | "beta_only"
  | "unavailable"
  | "invalid_url"
  | "navigation_failed"
  | "screenshot_failed"
  | "start_failed"
  | BrowserStartRefusal;

export interface OneShotScreenshotResult {
  ok: boolean;
  /** The normalized URL that was attempted. */
  url: string;
  pageTitle?: string;
  /** data:image/png;base64,… snapshot — label as a snapshot, not a live view. */
  screenshotDataUrl?: string;
  error?: OneShotScreenshotError;
  /** Human-facing message describing the outcome. */
  message: string;
}

/**
 * Phase 1 end-to-end loop: start session → navigate → screenshot → close.
 *
 * The session is closed in a `finally` block, so no Browserbase session is
 * ever orphaned — on success, on navigation failure, or on screenshot
 * failure. Failures are reported with the real cause; a failed run never
 * produces an image.
 */
export async function runOneShotScreenshot(
  userId: string,
  rawUrl: string,
): Promise<OneShotScreenshotResult> {
  const url = normalizeBrowserUrl(rawUrl);
  if (!url) {
    return {
      ok: false,
      url: rawUrl,
      error: "invalid_url",
      message: `I couldn't open "${rawUrl}" — that doesn't look like a valid web address.`,
    };
  }

  const started = await startAgentBrowserSession({
    userId,
    task: `screenshot ${url}`,
  });
  if (!started.ok) {
    return {
      ok: false,
      url,
      error: started.error,
      message: started.message,
    };
  }

  const { session } = started;
  const ctx = { sessionId: session.id, userId };

  try {
    const nav = await browserToolHandlers["browser.navigate"](ctx, { url });
    if (!nav.success) {
      return {
        ok: false,
        url,
        error: "navigation_failed",
        message: `I couldn't load ${url} (${nav.error ?? "navigation failed"}) — no screenshot was taken.`,
      };
    }

    const shot = await browserToolHandlers["browser.screenshot"](ctx, {});
    if (!shot.success || !shot.screenshotUrl) {
      return {
        ok: false,
        url,
        error: "screenshot_failed",
        message: `The page loaded, but capturing the screenshot failed (${shot.error ?? "unknown error"}).`,
      };
    }

    const data = shot.data as { title?: string } | undefined;
    return {
      ok: true,
      url,
      pageTitle: data?.title,
      screenshotDataUrl: shot.screenshotUrl,
      message: `Screenshot snapshot of ${url}${data?.title ? ` ("${data.title}")` : ""}.`,
    };
  } finally {
    // Never orphan a Browserbase session.
    await closeSession(session.id, userId).catch(() => {});
  }
}
