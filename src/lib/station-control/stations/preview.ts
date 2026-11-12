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
 * - preview.inspect    → preview URL → browser.start_session →
 *                        browser.navigate(previewUrl) → browser.snapshot
 *                        (returns the snapshot's textContent)
 * - preview.screenshot → same chain with browser.screenshot (returns the
 *                        real screenshot data URL)
 *
 * Static projects (ART-20261111-070): a static workspace has no dev server
 * to start — preview.start asserts host execution, which is fail-closed on
 * the hosted terminal server, so calling it for a static project can only
 * produce a 503 refusal. The inspect/screenshot chain therefore resolves
 * the SERVED static preview URL instead (the capability-token URL the app
 * preview route mints for the Studio pane) and never calls preview.start.
 * Readiness mirrors that route exactly: index.html must exist with real
 * content (not the seeded welcome screen) and the asset manifest must
 * verify complete, or the failure is honest — never a fake "ready".
 *
 * Error truth: delegateToTool wraps tool results in an outer success
 * envelope, so a tool that fails BY VALUE (its result carries
 * success:false — e.g. the preview.start handler catching the terminal
 * server's refusal) still arrives as an outer success. Every preview.start
 * consumer checks the inner result via toolFailureMessage() and surfaces
 * the real failure instead of degrading it into a missing-field complaint.
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
import { getProject } from "@/lib/projects/project-repository";
import { createPreviewToken } from "@/lib/projects/preview-token";
import { collectPreviewAssetManifest } from "@/lib/projects/preview-asset-manifest";
import { SITE_URL } from "@/lib/siteConfig";

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
const filesReadExecute = delegateToTool("files.read");
const browserNavigateExecute = delegateToTool("browser.navigate");
const browserSnapshotExecute = delegateToTool("browser.snapshot");
const browserScreenshotExecute = delegateToTool("browser.screenshot");

/**
 * The failure message a delegated tool reported, or null when it did not
 * fail. delegateToTool's outer envelope is success even when the tool
 * failed BY VALUE — its result object carries success:false plus the real
 * error (e.g. the preview.start handler catching the terminal server's
 * 503 HOST_EXECUTION_DISABLED refusal). Checking only the envelope is how
 * that refusal used to degrade into "did not return a workspaceId".
 */
function toolFailureMessage(result: StationResult): string | null {
  if (!result.success) return result.error;
  const inner = getToolResult(result);
  if (inner && inner.success === false) {
    return typeof inner.error === "string" && inner.error
      ? inner.error
      : "The tool reported failure without an error message.";
  }
  return null;
}

// Same signal the app preview route and launch-flow use to detect seed
// content. Duplicated here, as in those modules, to avoid pulling a
// terminal-server module into this layer.
const WELCOME_SCREEN_MARKER = "LITT-WELCOME-SCREEN";

type StaticPreviewResolution =
  | { kind: "url"; url: string }
  | { kind: "failure"; failure: StationResult };

/**
 * Resolve the served static preview URL for the ctx project, mirroring
 * the app preview route's static branch (GET
 * /api/studio-projects/[projectId]/preview): index.html must exist and
 * carry real content, the asset closure must verify complete, and the
 * URL carries a freshly minted capability token signed over exactly
 * that closure — the token the Studio pane's iframe uses.
 *
 * Returns null when the project is not static (including when that
 * cannot be determined — a lookup failure must never break the existing
 * dev-server path for non-static projects). Static projects NEVER fall
 * back to preview.start: the start asserts host execution, which is
 * fail-closed on the hosted service by design.
 */
async function resolveStaticPreviewUrl(
  ctx: StationExecutionContext,
): Promise<StaticPreviewResolution | null> {
  const projectId = ctx.projectId;
  if (!projectId) return null;

  let project: Awaited<ReturnType<typeof getProject>>;
  try {
    project = await getProject(projectId, ctx.userId);
  } catch {
    return null;
  }
  if (!project || project.framework !== "static") return null;

  if (!project.workspaceId) {
    return {
      kind: "failure",
      failure: fail(
        "Static preview is not ready: this project has no provisioned workspace yet.",
        "execution_failed",
      ),
    };
  }

  const readWorkspaceText = async (path: string): Promise<string | null> => {
    const r = await filesReadExecute({ projectId, path }, ctx);
    const inner = getToolResult(r);
    if (!r.success || !inner || inner.success === false) return null;
    return typeof inner.content === "string" ? inner.content : null;
  };

  const entryHtml = await readWorkspaceText("index.html");
  if (entryHtml === null) {
    return {
      kind: "failure",
      failure: fail(
        "Static preview is not ready: index.html does not exist in the workspace yet.",
        "execution_failed",
      ),
    };
  }
  if (entryHtml.includes(WELCOME_SCREEN_MARKER)) {
    return {
      kind: "failure",
      failure: fail(
        "Static preview is not ready: the workspace still shows the seeded welcome screen — no generated content to inspect yet.",
        "execution_failed",
      ),
    };
  }

  // Fail closed like the serving route: an unverifiable closure means
  // the signed token would 403 assets the page needs.
  const manifest = await collectPreviewAssetManifest("index.html", entryHtml, readWorkspaceText);
  if (!manifest.complete) {
    return {
      kind: "failure",
      failure: fail(
        "Static preview could not be verified: the preview asset manifest is incomplete.",
        "execution_failed",
      ),
    };
  }

  const token = createPreviewToken(ctx.userId, {
    projectId,
    workspaceId: project.workspaceId,
    assets: manifest.assets,
  });
  return {
    kind: "url",
    url: `${SITE_URL}/api/preview/${encodeURIComponent(projectId)}/t/${token.token}/index.html`,
  };
}

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
    const startError = toolFailureMessage(launched);
    if (startError) return fail(startError, "execution_failed");
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
    const startError = toolFailureMessage(started);
    if (startError) {
      return fail(
        `Preview reload failed while starting: ${startError}`,
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
 * resolve preview URL → browser session → navigate → capture. Returns
 * {url, ...captured} or the first honest failure. Static projects resolve
 * the served static URL and skip preview.start entirely (see header);
 * other projects go through preview.start as before.
 */
async function capturePreview(
  ctx: StationExecutionContext,
  task: string,
  capture: (sessionId: string) => Promise<StationResult>,
  pick: (toolResult: Record<string, unknown> | null) => Record<string, unknown> | null,
): Promise<StationResult> {
  let url: string | null = null;
  const staticResolution = await resolveStaticPreviewUrl(ctx);
  if (staticResolution?.kind === "failure") return staticResolution.failure;
  if (staticResolution?.kind === "url") {
    url = staticResolution.url;
  } else {
    const launched = await previewStartExecute({}, ctx);
    const startError = toolFailureMessage(launched);
    if (startError) return fail(startError, "execution_failed");
    url = previewUrlFrom(launched);
    if (!url) {
      return fail("preview.start did not return a workspaceId — cannot build the preview URL.", "execution_failed");
    }
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
    "Inspect the preview's DOM: resolves the preview URL (the served static preview for static " +
    "projects, the dev-server preview otherwise), opens it in the agent browser, " +
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
    "Screenshot the preview: resolves the preview URL (the served static preview for static " +
    "projects, the dev-server preview otherwise), opens it in the agent browser, " +
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
