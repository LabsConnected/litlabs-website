/**
 * LiTT Agent Browser — chat-facing orchestration (Phase 1).
 *
 * This module is the seam between the Studio chat and the Browserbase +
 * Stagehand session infrastructure (`browser-session-manager.ts`,
 * `browser-tool-handlers.ts`, built 2026-08-11). It provides:
 *
 * - `isBrowserBetaAllowed` — account gate. The agent browser is private
 *   beta until BITS metering ships (Phase 4); until then only the
 *   platform owner's account may start sessions.
 * - `startAgentBrowserSession` — gated session start with honest errors.
 * - `runOneShotScreenshot` — the Phase 1 end-to-end loop: start a session,
 *   navigate to a URL, capture a screenshot snapshot, close the session.
 *   The session is ALWAYS closed (no orphaned Browserbase sessions),
 *   and every failure is reported truthfully — never a fake screenshot.
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
import {
  startSession,
  closeSession,
  type BrowserSession,
} from "./browser-session-manager";
import { browserToolHandlers } from "./browser-tool-handlers";

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

// ─── URL handling ──────────────────────────────────────────────────

/**
 * Normalize user-supplied URL text for the browser.
 * Adds https:// when no scheme is present; rejects non-http(s) schemes
 * (file://, chrome://, javascript:, …) and unparseable input.
 * Returns null when the input is not a loadable web URL.
 */
export function normalizeBrowserUrl(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  // If the input already carries a scheme, only http(s) is loadable —
  // never rewrite file://, chrome://, javascript:, … into https://.
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return null;
    try {
      return new URL(trimmed).toString();
    } catch {
      return null;
    }
  }
  try {
    return new URL(`https://${trimmed}`).toString();
  } catch {
    return null;
  }
}

// ─── Chat intent (Phase 1) ─────────────────────────────────────────

/**
 * Screenshot trigger phrases. Kept narrow on purpose: "screenshot" is an
 * explicit verb, and "what does <url> look like" only fires when a URL or
 * bare domain is present (extractScreenshotUrl must find one).
 */
const SCREENSHOT_TRIGGER_PHRASES = [
  "screenshot",
  "screen shot",
  "screen capture",
  "capture the page",
  "capture this page",
];

/**
 * True when the message asks LiTT to screenshot a page.
 */
export function detectScreenshotIntent(message: string): boolean {
  const lower = (message ?? "").toLowerCase();
  if (SCREENSHOT_TRIGGER_PHRASES.some((kw) => lower.includes(kw))) return true;
  // "what does example.com look like" — only with a URL/domain present.
  if (/\bwhat does\b.+\blook like\b/i.test(message) && extractScreenshotUrl(message)) {
    return true;
  }
  return false;
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
}

export type StartAgentBrowserSessionResult =
  | { ok: true; session: BrowserSession; message: string }
  | {
      ok: false;
      error: "beta_only" | "unavailable" | "start_failed";
      message: string;
    };

/**
 * Start an agent browser session for a user, enforcing the beta gate.
 * Returns a discriminated result — never throws for expected failures
 * (beta gate, missing API key) so callers can report them honestly.
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
      message:
        "Browser session started — fresh clean profile, no logins. " +
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

// ─── One-shot screenshot (Phase 1 loop) ────────────────────────────

export type OneShotScreenshotError =
  | "beta_only"
  | "unavailable"
  | "invalid_url"
  | "navigation_failed"
  | "screenshot_failed"
  | "start_failed";

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
