/**
 * Agent Browser Phase 3 — in-chat approvals + cooperative control.
 *
 * This module is the server-side half of the browser approval UX:
 *
 * - `describeBrowserAction` — turns a mutating `browser.*` tool call into a
 *   plain-English description with its target, e.g. `Click "Buy now" button
 *   on example.com`. The in-chat approval card (same UX lineage as the
 *   workspace-operation approvals, PR #371/#396) shows this so the user
 *   knows exactly what they are approving.
 * - `approvalReasonForBrowserAction` — the enriched pause reason stored on
 *   the paused run and rendered by the approval card.
 * - `buildHumanTakeoverMessage` — the exact sentence the agent announces in
 *   chat when it needs the human (login wall, CAPTCHA, anything it cannot
 *   do), pointing at the Take control / Resume controls.
 *
 * Sensitive-input rule (§5.1, §5.6): typed values are truncated and never
 * echoed in full; values destined for a password field are never echoed at
 * all. Page content is untrusted data — descriptions are built from the
 * tool inputs only, never from page text.
 */

import "server-only";
import { getBrowserPageUrl } from "./browser-tool-handlers";

/** The browser tools that mutate page state and therefore need approval. */
export const MUTATING_BROWSER_TOOLS = [
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.press",
  "browser.upload",
  "browser.download",
] as const;

export type MutatingBrowserTool = (typeof MUTATING_BROWSER_TOOLS)[number];

export function isMutatingBrowserTool(toolId: string): boolean {
  return (MUTATING_BROWSER_TOOLS as readonly string[]).includes(toolId);
}

// ─── Helpers ───────────────────────────────────────────────────────

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function truncate(value: string, max = 60): string {
  const v = value.trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function quoted(value: string): string {
  return `"${truncate(value)}"`;
}

/**
 * Best human-readable label for the element the action targets.
 * Priority: visible text > aria-label > role > testId > CSS selector >
 * coordinates. Returns null when the inputs name no target.
 */
export function describeBrowserTarget(
  inputs: Record<string, unknown>,
): string | null {
  const text = str(inputs.text);
  if (text) return quoted(text);
  const ariaLabel = str(inputs.ariaLabel);
  if (ariaLabel) return quoted(ariaLabel);
  const role = str(inputs.role);
  if (role) return `the ${truncate(role, 30)}`;
  const testId = str(inputs.testId);
  if (testId) return `the [data-testid=${quoted(truncate(testId, 40))}] element`;
  const selector = str(inputs.selector);
  if (selector) return `the element ${quoted(selector)}`;
  const x = inputs.x;
  const y = inputs.y;
  if (typeof x === "number" && typeof y === "number") {
    return `the point (${x}, ${y})`;
  }
  return null;
}

function onPage(pageUrl: string | null | undefined): string {
  if (!pageUrl) return "";
  try {
    const host = new URL(pageUrl).hostname;
    return host ? ` on ${host}` : "";
  } catch {
    return "";
  }
}

/** True when the inputs look like they target a password/credential field. */
function looksLikePasswordField(inputs: Record<string, unknown>): boolean {
  const haystack = [inputs.ariaLabel, inputs.selector, inputs.testId, inputs.text]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
  return /password|passwd|pwd|passcode|secret|otp|2fa|mfa|pin\b/.test(haystack);
}

// ─── Action descriptions ───────────────────────────────────────────

/**
 * Plain-English description of a mutating browser action, e.g.
 * `Click "Buy now" button on example.com`.
 *
 * `pageUrl` is optional — when known it names the site the action runs on.
 * Typed values are truncated; password-field values are never echoed.
 */
export function describeBrowserAction(
  toolId: string,
  inputs: Record<string, unknown>,
  pageUrl?: string | null,
): string {
  const target = describeBrowserTarget(inputs);
  const where = onPage(pageUrl);

  switch (toolId) {
    case "browser.click":
      return `Click ${target ?? "the element"}${where}`;
    case "browser.type": {
      const value = str(inputs.value);
      if (looksLikePasswordField(inputs)) {
        return `Type into the password field${where} (value hidden)`;
      }
      const shown = value ? ` ${quoted(value)}` : "";
      return `Type${shown} into ${target ?? "the field"}${where}`;
    }
    case "browser.select": {
      const label = str(inputs.label);
      const value = str(inputs.value);
      const option = label ? quoted(label) : value ? quoted(value) : "an option";
      return `Select ${option} in ${target ?? "the dropdown"}${where}`;
    }
    case "browser.scroll": {
      const direction = str(inputs.direction);
      return `Scroll ${direction ?? "the page"}${target ? ` at ${target}` : ""}${where}`;
    }
    case "browser.press": {
      const key = str(inputs.key);
      return `Press the ${key ? truncate(key, 20) : "key"} key${where}`;
    }
    case "browser.upload": {
      const filePath = str(inputs.filePath);
      const file = filePath ? quoted(filePath.split(/[\\/]/).pop() ?? filePath) : "a file";
      return `Upload ${file}${target ? ` to ${target}` : ""}${where}`;
    }
    case "browser.download": {
      const url = str(inputs.url);
      const file = str(inputs.filename);
      const what = file ? quoted(file) : url ? `from ${truncate(url, 60)}` : "a file";
      const via = target ? ` via ${target}` : "";
      return `Download ${what}${via}${where}`;
    }
    default:
      return `${toolId.replace(/^browser\./, "Browser ")}${where}`;
  }
}

/**
 * The approval-card reason for a mutating browser tool call.
 *
 * Format: `Browser action: <description>. <fallback reason>` — the card's
 * body therefore names the exact action and target, with the standard
 * approval framing after it.
 *
 * The current page URL is looked up best-effort (in-process Stagehand);
 * a lookup failure simply omits the site — never blocks the pause.
 */
export async function approvalReasonForBrowserAction(
  toolId: string,
  inputs: Record<string, unknown>,
  fallbackReason: string,
): Promise<string> {
  let pageUrl: string | null = null;
  const sessionId = str(inputs.sessionId);
  if (sessionId) {
    try {
      pageUrl = await getBrowserPageUrl(sessionId);
    } catch {
      pageUrl = null;
    }
  }
  const description = describeBrowserAction(toolId, inputs, pageUrl);
  return `Browser action: ${description}. ${fallbackReason}`;
}

// ─── Human takeover announcement ───────────────────────────────────

/**
 * Guidance appended to the `browser.start_session` tool description so the
 * model announces takeover needs instead of stalling, bypassing, or asking
 * for credentials in chat.
 */
export const BROWSER_TAKEOVER_GUIDANCE =
  " If a page needs a login, CAPTCHA, MFA, or anything else you cannot do: do NOT try to bypass it and do NOT ask the user for credentials — announce in chat that you need them to take over, naming the blocker (e.g. 'I need you to take over: this page needs a login. Tap Take control, sign in, then Resume and I'll continue.'). While the user is in control your browser actions are refused; resume only after they tap Resume.";

/**
 * The agent-facing announcement wording is mirrored in the
 * `browser.start_session` tool description (tool-registry.ts), which is what
 * the model actually reads. This helper produces the same sentence
 * deterministically for any code path that must ask the human to take over
 * without an LLM turn.
 */
export function buildHumanTakeoverMessage(reason: string): string {
  const clean = reason.trim().replace(/\.*$/, "");
  return (
    `I need you to take over: ${clean}. ` +
    "Tap Take control, do that step yourself, then tap Resume and I'll continue. " +
    "I never see what you type while you're in control."
  );
}
