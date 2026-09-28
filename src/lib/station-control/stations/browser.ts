/**
 * Station Control Bridge — browser station adapters (chunk B, server-only).
 *
 * Thin adapters over the real LiTT browser tools (Stagehand/Browserbase via
 * browser-tool-handlers.ts). No business logic lives here: every execute
 * performs real I/O through the tool registry or returns an honest failure —
 * never a placeholder success.
 *
 * Session management: every browser.* tool requires a sessionId from
 * browser.start_session. Each action below starts (or reuses) a session via
 * ensureBrowserSession() and then calls its tool. Sessions are
 * conversation-scoped: start_session reuses the live session for the same
 * userId+conversationId, and idle sessions auto-close after 10 minutes — so
 * actions deliberately do NOT close the session afterwards (closing would
 * break multi-step flows like navigate → click → type).
 *
 * Delegate map:
 * - browser.navigate         → browser.navigate  ({sessionId, userId, url})
 * - browser.click            → browser.click     ({sessionId, userId, selector})
 * - browser.type             → browser.type      ({sessionId, userId, selector, value})
 * - browser.scroll           → browser.scroll    ({sessionId, userId, direction, amount?})
 * - browser.screenshot       → browser.screenshot({sessionId, userId})
 * - browser.readDom          → browser.snapshot  (returns data.textContent)
 * - browser.readAccessibility→ browser.snapshot  (returns data.accessibility)
 * - browser.goBack           → browser.back      ({sessionId, userId})
 *
 * SHAPE DIFFERENCES (reported):
 * - browser.type's backend requires `value`, not `text` — the adapter maps text→value.
 * - browser.snapshot takes no selector: browser.readDom accepts {selector?} for
 *   contract fidelity but FAILS HONESTLY when one is provided (returning
 *   full-page text while scoped text was requested would be a lie).
 * - browser.screenshot's backend captures the viewport only (page.screenshot
 *   with no fullPage option): fullPage:true FAILS HONESTLY instead of
 *   claiming a full-page capture.
 *
 * DELIBERATELY OMITTED:
 * - browser.search — no browser.search tool exists in the registry (the
 *   closest is the model-driven browser.extract); web search is a separate
 *   capability (web.search). Documented, never stubbed.
 */
import "server-only";

import { z } from "zod";

import { registerStationAction } from "../registry";
import { delegateToTool } from "../delegate";
import { setDelegateToolId } from "../advertise";
import type {
  StationAction,
  StationExecutionContext,
  StationResult,
} from "../types";
import { fail, ok, stationResultSchema } from "./creator-helpers";

/**
 * Register a station action. Generic over the args schema so execute bodies
 * get a typed `args` instead of unknown. The executor safeParses raw args
 * against argsSchema before invoking execute, so the cast to the erased
 * StationAction is sound.
 */
function defineAction<A extends z.ZodType>(
  action: StationAction<A, StationResult>,
): void {
  registerStationAction(action as StationAction);
}

/**
 * Unwrap chunk A's delegate envelope ({success:true, result}) to the tool's
 * own result object. Returns null when the call failed or the shape is
 * unexpected.
 */
export function getToolResult(r: StationResult): Record<string, unknown> | null {
  if (!r.success) return null;
  const inner = (r as { result?: unknown }).result;
  return inner !== null && typeof inner === "object"
    ? (inner as Record<string, unknown>)
    : null;
}

const startSessionExecute = delegateToTool("browser.start_session", (args) => ({
  userId: args.userId,
  task: args.task,
  ...(typeof args.conversationId === "string" && args.conversationId
    ? { conversationId: args.conversationId }
    : {}),
}));

/** Pull a session id out of the start_session result, tolerating envelope shapes. */
function extractSessionId(r: StationResult): string | null {
  const inner = getToolResult(r);
  if (!inner) return null;
  if (typeof inner.sessionId === "string" && inner.sessionId) return inner.sessionId;
  const session = inner.session as { id?: unknown } | undefined;
  if (session && typeof session.id === "string" && session.id) return session.id;
  return null;
}

/**
 * Start (or reuse) the conversation's browser session. Shared with the
 * preview station (preview.inspect / preview.screenshot compose a browser
 * session over the preview URL).
 *
 * Returns {success:true, sessionId} or an honest failure. The session is
 * intentionally left open: start_session reuses it per conversation and it
 * auto-closes after 10 idle minutes.
 */
export async function ensureBrowserSession(
  ctx: StationExecutionContext,
  task: string,
): Promise<StationResult & { sessionId?: string }> {
  const started = await startSessionExecute(
    {
      userId: ctx.userId,
      task,
      ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
    },
    ctx,
  );
  if (!started.success) return started;
  const sessionId = extractSessionId(started);
  if (!sessionId) {
    return fail(
      "browser.start_session did not return a session id — cannot drive the browser.",
      "execution_failed",
    );
  }
  return ok({ sessionId });
}

/** Run one browser tool inside the conversation's session. */
async function withBrowserSession(
  ctx: StationExecutionContext,
  task: string,
  toolExecute: (sessionId: string) => Promise<StationResult>,
): Promise<StationResult> {
  const sess = await ensureBrowserSession(ctx, task);
  if (!sess.success) return sess;
  const sessionId = (sess as { sessionId: string }).sessionId;
  return toolExecute(sessionId);
}

const navigateExecute = delegateToTool("browser.navigate");
const clickExecute = delegateToTool("browser.click");
const typeExecute = delegateToTool("browser.type");
const scrollExecute = delegateToTool("browser.scroll");
const screenshotExecute = delegateToTool("browser.screenshot");
const snapshotExecute = delegateToTool("browser.snapshot");
const backExecute = delegateToTool("browser.back");

defineAction({
  id: "browser.navigate",
  station: "browser",
  description:
    "Navigate the agent browser session to a URL (real page.goto via Stagehand/Browserbase; URL-policy checked). Returns updated page state.",
  argsSchema: z.object({
    url: z.string().url().describe("URL to navigate to"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    return withBrowserSession(ctx, `browser.navigate to ${args.url}`, (sessionId) =>
      navigateExecute({ sessionId, userId: ctx.userId, url: args.url }, ctx),
    );
  },
});
setDelegateToolId("browser.navigate", "browser.navigate");

defineAction({
  id: "browser.click",
  station: "browser",
  description:
    "Click an element in the agent browser session (selector priority chain: DOM selector > a11y attributes > text > coordinates).",
  argsSchema: z.object({
    selector: z.string().min(1).describe("CSS selector of the element to click"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    return withBrowserSession(ctx, `browser.click ${args.selector}`, (sessionId) =>
      clickExecute({ sessionId, userId: ctx.userId, selector: args.selector }, ctx),
    );
  },
});
setDelegateToolId("browser.click", "browser.click");

defineAction({
  id: "browser.type",
  station: "browser",
  description:
    "Type text into an input field in the agent browser session. NOTE: the backend field is `value` — the adapter maps text→value.",
  argsSchema: z.object({
    selector: z.string().min(1).describe("CSS selector of the input field"),
    text: z.string().describe("Text to type"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    return withBrowserSession(ctx, `browser.type into ${args.selector}`, (sessionId) =>
      typeExecute(
        { sessionId, userId: ctx.userId, selector: args.selector, value: args.text },
        ctx,
      ),
    );
  },
});
setDelegateToolId("browser.type", "browser.type");

defineAction({
  id: "browser.scroll",
  station: "browser",
  description: "Scroll the page (or a specific element) in the agent browser session.",
  argsSchema: z.object({
    direction: z.enum(["up", "down", "left", "right"]).describe("Scroll direction"),
    amount: z.number().positive().optional().describe("Scroll amount in pixels"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    return withBrowserSession(ctx, `browser.scroll ${args.direction}`, (sessionId) =>
      scrollExecute(
        {
          sessionId,
          userId: ctx.userId,
          direction: args.direction,
          ...(args.amount !== undefined ? { amount: args.amount } : {}),
        },
        ctx,
      ),
    );
  },
});
setDelegateToolId("browser.scroll", "browser.scroll");

defineAction({
  id: "browser.screenshot",
  station: "browser",
  description:
    "Capture a screenshot of the current page in the agent browser session (returns a base64 PNG data URL). " +
    "NOTE: the backend captures the viewport only — fullPage:true fails honestly instead of claiming a full-page capture.",
  argsSchema: z.object({
    fullPage: z.boolean().optional().describe("Full-page capture (NOT supported by the backend)"),
  }),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (args, ctx): Promise<StationResult> => {
    if (args.fullPage === true) {
      return fail(
        "browser.screenshot does not support fullPage: the backend captures the viewport only. " +
          "Call without fullPage.",
        "invalid_args",
      );
    }
    const res = await withBrowserSession(ctx, "browser.screenshot", (sessionId) =>
      screenshotExecute({ sessionId, userId: ctx.userId }, ctx),
    );
    if (!res.success) return res;
    const data = getToolResult(res)?.data as
      | { screenshot?: unknown; screenshotUrl?: unknown }
      | undefined;
    const screenshot =
      typeof data?.screenshot === "string"
        ? data.screenshot
        : typeof data?.screenshotUrl === "string"
          ? data.screenshotUrl
          : null;
    if (!screenshot) {
      return fail("browser.screenshot reported success but returned no image.", "execution_failed");
    }
    return ok({ screenshot });
  },
});
setDelegateToolId("browser.screenshot", "browser.screenshot");

/** Shared snapshot flow: session → browser.snapshot → pick a field from data. */
async function snapshotField(
  ctx: StationExecutionContext,
  task: string,
  field: "textContent" | "accessibility",
): Promise<StationResult> {
  const res = await withBrowserSession(ctx, task, (sessionId) =>
    snapshotExecute({ sessionId, userId: ctx.userId }, ctx),
  );
  if (!res.success) return res;
  const data = getToolResult(res)?.data as Record<string, unknown> | undefined;
  const value = data?.[field] ?? null;
  return ok({ [field]: value });
}

defineAction({
  id: "browser.readDom",
  station: "browser",
  description:
    "Read the visible DOM text of the current page in the agent browser session " +
    "(delegates to browser.snapshot, returns its textContent). " +
    "NOTE: the snapshot backend has no selector scope — passing a selector fails honestly.",
  argsSchema: z.object({
    selector: z.string().optional().describe("CSS selector (NOT supported by the snapshot backend)"),
  }),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (args, ctx): Promise<StationResult> => {
    if (args.selector) {
      return fail(
        "browser.readDom does not support selector-scoped reads: the browser.snapshot backend returns " +
          "the full page's visible text. Call without a selector.",
        "invalid_args",
      );
    }
    return snapshotField(ctx, "browser.readDom", "textContent");
  },
});
setDelegateToolId("browser.readDom", "browser.snapshot");

defineAction({
  id: "browser.readAccessibility",
  station: "browser",
  description:
    "Read the accessibility tree of the current page in the agent browser session " +
    "(delegates to browser.snapshot, returns its accessibility snapshot).",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (_args, ctx): Promise<StationResult> => {
    return snapshotField(ctx, "browser.readAccessibility", "accessibility");
  },
});
setDelegateToolId("browser.readAccessibility", "browser.snapshot");

defineAction({
  id: "browser.goBack",
  station: "browser",
  description:
    "Navigate back in the agent browser session's history. Returns updated page state.",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (_args, ctx): Promise<StationResult> => {
    return withBrowserSession(ctx, "browser.goBack", (sessionId) =>
      backExecute({ sessionId, userId: ctx.userId }, ctx),
    );
  },
});
setDelegateToolId("browser.goBack", "browser.back");

// browser.search is deliberately NOT registered: no browser.search tool exists
// in the registry (closest is the model-driven browser.extract), and web
// search is a separate capability. Documented, never stubbed.

export const BROWSER_STATION_ACTIONS = [
  "browser.navigate",
  "browser.click",
  "browser.type",
  "browser.scroll",
  "browser.screenshot",
  "browser.readDom",
  "browser.readAccessibility",
  "browser.goBack",
] as const;
