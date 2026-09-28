/**
 * Station Control Bridge — preview station adapters (chunk B, server-only).
 *
 * Thin adapters over the real LiTT preview + browser tools. No business
 * logic lives here: every execute performs real I/O through the tool
 * registry or returns an honest failure — never a placeholder success.
 *
 * Delegate map:
 * - preview.launch     → preview.start ({}) — enriched with the real preview
 *                        URL built by buildPreviewProxyUrl(workspaceId)
 * - preview.reload     → preview.stop + preview.start (the stop tool exists
 *                        and is enabled, so reload is stop-then-start)
 * - preview.inspect    → preview.start → browser.start_session →
 *                        browser.navigate(previewUrl) → browser.snapshot
 *                        (returns the snapshot's textContent)
 * - preview.screenshot → same chain with browser.screenshot (returns the
 *                        real screenshot data URL)
 *
 * Design notes (honest-minimal, per chunk-B brief):
 * - preview.start does NOT return a URL — only {workspaceId, status, port,
 *   framework, command}. The URL is built with the shared
 *   buildPreviewProxyUrl() (the same function the /api preview route uses),
 *   never hand-rolled here.
 * - preview.reload's stop is best-effort: a stopped preview's stop may
 *   report failure while start succeeds — the reload still achieved "a
 *   fresh running preview", so success follows the start call and the stop
 *   outcome is reported in the result, not hidden.
 * - preview.inspect/screenshot navigate the (possibly reused) browser
 *   session to the preview URL first — a reused session may be sitting on
 *   any page, so inspecting "the preview" requires the navigation.
 * - The browser session is left open (conversation-scoped reuse, 10-min
 *   idle auto-close) — see browser.ts ensureBrowserSession.
 * - If any step fails, the failure is returned as-is: a screenshot is only
 *   ever returned when the browser tool actually captured one.
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
import { ensureBrowserSession, getToolResult } from "./browser";
import { buildPreviewProxyUrl } from "@/lib/terminal-internal-client";

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

const previewStartExecute = delegateToTool("preview.start");
const previewStopExecute = delegateToTool("preview.stop");
const browserNavigateExecute = delegateToTool("browser.navigate");
const browserSnapshotExecute = delegateToTool("browser.snapshot");
const browserScreenshotExecute = delegateToTool("browser.screenshot");

/** workspaceId → preview URL, or null when the start result lacks one. */
function previewUrlFrom(startResult: StationResult): string | null {
  const inner = getToolResult(startResult);
  const workspaceId = inner?.workspaceId;
  if (typeof workspaceId !== "string" || !workspaceId) return null;
  return buildPreviewProxyUrl(workspaceId);
}

defineAction({
  id: "preview.launch",
  station: "preview",
  description:
    "Launch the project's preview dev server (delegates to the real preview.start; health-probed " +
    "until it responds). Returns status/port/framework plus the preview URL.",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (_args, ctx): Promise<StationResult> => {
    const launched = await previewStartExecute({}, ctx);
    if (!launched.success) return launched;
    const inner = getToolResult(launched) ?? {};
    const url = previewUrlFrom(launched);
    return ok({ ...inner, ...(url ? { previewUrl: url } : {}) });
  },
});
setDelegateToolId("preview.launch", "preview.start");

defineAction({
  id: "preview.reload",
  station: "preview",
  description:
    "Reload the project's preview: stops the dev server (preview.stop) and starts it again " +
    "(preview.start). Success follows the start call; the stop outcome is reported, not hidden.",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (_args, ctx): Promise<StationResult> => {
    const stopped = await previewStopExecute({}, ctx);
    const started = await previewStartExecute({}, ctx);
    if (!started.success) {
      return fail(
        `Preview reload failed while starting: ${started.error ?? "unknown error"}`,
        "execution_failed",
      );
    }
    const inner = getToolResult(started) ?? {};
    const url = previewUrlFrom(started);
    return ok({
      ...inner,
      ...(url ? { previewUrl: url } : {}),
      reloaded: true,
      stopOk: stopped.success,
      ...(!stopped.success
        ? { stopError: (stopped as { error?: string }).error ?? "stop failed" }
        : {}),
    });
  },
});
// Primary delegate for approval-policy mirroring; the stop half delegates to
// preview.stop (same MUTATION_APPROVAL policy).
setDelegateToolId("preview.reload", "preview.start");

/**
 * Shared chain for preview.inspect / preview.screenshot:
 * ensure preview running → preview URL → browser session → navigate →
 * capture. Returns {url, ...captured} or the first honest failure.
 */
async function capturePreview(
  ctx: StationExecutionContext,
  task: string,
  capture: (sessionId: string) => Promise<StationResult>,
  pick: (toolResult: Record<string, unknown> | null) => Record<string, unknown> | null,
): Promise<StationResult> {
  const launched = await previewStartExecute({}, ctx);
  if (!launched.success) return launched;
  const url = previewUrlFrom(launched);
  if (!url) {
    return fail("preview.start did not return a workspaceId — cannot build the preview URL.", "execution_failed");
  }
  const sess = await ensureBrowserSession(ctx, task);
  if (!sess.success) return sess;
  const sessionId = (sess as { sessionId: string }).sessionId;

  const navigated = await browserNavigateExecute(
    { sessionId, userId: ctx.userId, url },
    ctx,
  );
  if (!navigated.success) return navigated;

  const captured = await capture(sessionId);
  if (!captured.success) return captured;
  const picked = pick(getToolResult(captured));
  if (!picked) {
    return fail("The browser capture reported success but returned no usable data.", "execution_failed");
  }
  return ok({ url, ...picked });
}

defineAction({
  id: "preview.inspect",
  station: "preview",
  description:
    "Inspect the running preview's DOM: ensures the preview is up, opens it in the agent browser, " +
    "and returns the page's visible text (browser.snapshot textContent). " +
    "NOTE: the snapshot backend has no selector scope — passing a selector fails honestly.",
  argsSchema: z.object({
    selector: z.string().optional().describe("CSS selector (NOT supported by the snapshot backend)"),
  }),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (args, ctx): Promise<StationResult> => {
    if (args.selector) {
      return fail(
        "preview.inspect does not support selector-scoped inspection: the browser.snapshot backend " +
          "returns the full page's visible text. Call without a selector.",
        "invalid_args",
      );
    }
    return capturePreview(
      ctx,
      "preview.inspect",
      (sessionId) => browserSnapshotExecute({ sessionId, userId: ctx.userId }, ctx),
      (toolResult) => {
        const data = toolResult?.data as { textContent?: unknown } | undefined;
        return typeof data?.textContent === "string" ? { textContent: data.textContent } : null;
      },
    );
  },
});
setDelegateToolId("preview.inspect", "browser.snapshot");

defineAction({
  id: "preview.screenshot",
  station: "preview",
  description:
    "Screenshot the running preview: ensures the preview is up, opens it in the agent browser, " +
    "and returns the real screenshot (base64 PNG data URL) — only ever returned when the browser " +
    "tool actually captured one. NOTE: the backend captures the viewport only — fullPage:true fails honestly.",
  argsSchema: z.object({
    fullPage: z.boolean().optional().describe("Full-page capture (NOT supported by the backend)"),
  }),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (args, ctx): Promise<StationResult> => {
    if (args.fullPage === true) {
      return fail(
        "preview.screenshot does not support fullPage: the backend captures the viewport only. " +
          "Call without fullPage.",
        "invalid_args",
      );
    }
    return capturePreview(
      ctx,
      "preview.screenshot",
      (sessionId) => browserScreenshotExecute({ sessionId, userId: ctx.userId }, ctx),
      (toolResult) => {
        const data = toolResult?.data as
          | { screenshot?: unknown; screenshotUrl?: unknown }
          | undefined;
        const screenshot =
          typeof data?.screenshot === "string"
            ? data.screenshot
            : typeof data?.screenshotUrl === "string"
              ? data.screenshotUrl
              : null;
        return screenshot ? { screenshot } : null;
      },
    );
  },
});
setDelegateToolId("preview.screenshot", "browser.screenshot");

export const PREVIEW_STATION_ACTIONS = [
  "preview.launch",
  "preview.reload",
  "preview.inspect",
  "preview.screenshot",
] as const;
