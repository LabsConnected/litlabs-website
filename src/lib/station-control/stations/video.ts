/**
 * Station Control Bridge — video station (chunk C, server-only).
 *
 * Backend wiring (verified against /api/media/generate-video/route.ts):
 * - The route's billing machinery (wallet debit, refunds, durable job rows,
 *   Clerk-cookie auth) is deliberately NOT replicated here. The station
 *   actions call the clean provider substrate — src/lib/alibaba-video.ts
 *   (submitAlibabaVideoTask / pollAlibabaVideoTask / isAlibabaConfigured /
 *   downloadVideo) — and are annotated requiresApproval:true so the action
 *   approval path (advertise.ts STATION_MUTATION_APPROVAL) gates them, exactly
 *   like image.generate's MUTATION_APPROVAL. Billing policy for station
 *   generations stays a chunk-A/policy decision — documented here, not faked.
 * - The Veo 3 text-to-video path (:501) is wallet-entangled in the route and
 *   has no cleanly importable server-side entry. Only HappyHorse i2v is
 *   wired. Consequence: video.generate without a first-frame image fails
 *   HONESTLY (not_implemented) instead of faking a text-to-video run.
 * - Without ALIBABA_DASHSCOPE_API_KEY + ALIBABA_MODELSTUDIO_WORKSPACE_ID the
 *   submit fn throws the same "not configured" error the route surfaces as
 *   422 — surfaced as {success:false, errorCode:"not_configured"}, never fake
 *   success.
 */
import "server-only";

import { z } from "zod";

import { registerStationAction } from "../registry";
import type {
  StationAction,
  StationExecutionContext,
  StationResult,
} from "../types";
import {
  fail,
  getTransport,
  ok,
  resolveAssetUrl,
  saveMediaToProject,
  sleep,
  stationResultSchema,
} from "./creator-helpers";
import {
  creatorKey,
  getCreatorParams,
  pushCreatorResult,
  setCreatorParams,
} from "./creator-state";
import {
  downloadVideo,
  isAlibabaConfigured,
  pollAlibabaVideoTask,
  submitAlibabaVideoTask,
} from "@/lib/alibaba-video";

const POLL_BUDGET_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

/**
 * Register a station action. Generic over the args schema so execute bodies
 * get a typed `args` instead of unknown (zod v4: bare z.ZodType infers
 * unknown — same pattern as chunk B's browser.ts). The executor safeParses
 * raw args against argsSchema before invoking execute, so the cast to the
 * erased StationAction is sound.
 */
function defineAction<A extends z.ZodType>(
  action: StationAction<A, StationResult>,
): void {
  registerStationAction(action as StationAction);
}

defineAction({
  id: "video.setPrompt",
  station: "video",
  description: "Stage the video generation prompt for this conversation.",
  argsSchema: z.object({ prompt: z.string().min(3) }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    setCreatorParams(creatorKey(ctx), { prompt: args.prompt });
    return ok({ prompt: args.prompt });
  },
});

defineAction({
  id: "video.setModel",
  station: "video",
  description: "Stage the video model (currently only HappyHorse i2v is wired).",
  argsSchema: z.object({ model: z.string().min(1) }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    if (args.model !== "happyhorse") {
      return fail(
        `Video model "${args.model}" is not wired into station actions (only "happyhorse" image-to-video is).`,
        "not_implemented",
      );
    }
    setCreatorParams(creatorKey(ctx), { videoModel: args.model });
    return ok({ model: args.model });
  },
});

defineAction({
  id: "video.setDuration",
  station: "video",
  description: "Stage the clip duration in seconds (HappyHorse: 3–15).",
  argsSchema: z.object({ durationSec: z.number().int().min(3).max(15) }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    setCreatorParams(creatorKey(ctx), { videoDurationSec: args.durationSec });
    return ok({ durationSec: args.durationSec });
  },
});

/** Submit + bounded poll. Shared by video.generate and video.imageToVideo. */
async function runHappyHorse(
  ctx: StationExecutionContext,
  opts: { prompt?: string; imageUrl: string; duration: number; key: string },
): Promise<StationResult> {
  if (!isAlibabaConfigured()) {
    return fail(
      "Alibaba video not configured. Set ALIBABA_DASHSCOPE_API_KEY and ALIBABA_MODELSTUDIO_WORKSPACE_ID.",
      "not_configured",
    );
  }

  let submit: { taskId: string; taskStatus: string };
  try {
    submit = await submitAlibabaVideoTask({
      model: "happyhorse-1.1-i2v",
      prompt: opts.prompt,
      imageUrl: opts.imageUrl,
      duration: opts.duration,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Video submission failed";
    return fail(
      msg,
      /not configured/i.test(msg) ? "not_configured" : "execution_failed",
    );
  }

  ctx.emitEvent({
    type: "live_state",
    actionId: "video.generate",
    station: "video",
    summary: `Video task submitted (${submit.taskId}) — polling for completion`,
  });

  const deadline = Date.now() + POLL_BUDGET_MS;
  for (;;) {
    if (ctx.signal?.aborted) return fail("Video generation aborted", "execution_failed");
    let polled;
    try {
      polled = await pollAlibabaVideoTask(submit.taskId);
    } catch (err) {
      return fail(
        err instanceof Error ? err.message : "Video poll failed",
        "execution_failed",
      );
    }

    if (polled.taskStatus === "SUCCEEDED" && polled.videoUrl) {
      const videoUrl = polled.videoUrl;
      const resultId = `vid_${submit.taskId}`;
      pushCreatorResult(opts.key, { id: resultId, url: videoUrl, kind: "video" });

      const transport = getTransport(ctx);
      let savedPath: string | undefined;
      let savedSitePath: string | undefined;
      if (transport && ctx.projectId) {
        try {
          const buffer = await downloadVideo(videoUrl);
          const saved = await saveMediaToProject(
            `data:video/mp4;base64,${buffer.toString("base64")}`,
            { nameHint: "video", subdir: "videos", allowedMimes: ["video/mp4"], extension: "mp4" },
            transport,
            ctx.signal,
          );
          if (saved.success) {
            savedPath = saved.path;
            savedSitePath = saved.sitePath;
          }
        } catch (err) {
          // Honest partial: video exists at the provider URL; save failed.
          return ok({
            status: "completed",
            videoUrl,
            savedToProject: false,
            saveError: err instanceof Error ? err.message : "Failed to save video into project",
            resultId,
            taskId: submit.taskId,
          });
        }
      }
      ctx.reportLiveState({ station: "video", action: "video.generate", status: "completed", taskId: submit.taskId });
      return ok({
        status: "completed",
        videoUrl,
        ...(savedSitePath
          ? { savedToProject: true, assetPath: savedPath, sitePath: savedSitePath }
          : { savedToProject: false, reason: "No project transport in this context" }),
        resultId,
        taskId: submit.taskId,
      });
    }
    if (polled.taskStatus === "FAILED") {
      return fail(`Alibaba video task failed: ${polled.error ?? "unknown error"}`, "execution_failed");
    }

    if (Date.now() >= deadline) {
      return ok({
        status: "processing",
        taskId: submit.taskId,
        reason: "Poll budget (10 min) expired before completion — NOT a failure. Re-check later.",
      });
    }
    ctx.emitEvent({
      type: "live_state",
      actionId: "video.generate",
      station: "video",
      summary: `Video task ${submit.taskId}: ${polled.taskStatus.toLowerCase()}…`,
    });
    try {
      await sleep(POLL_INTERVAL_MS, ctx.signal);
    } catch {
      return fail("Video generation aborted", "execution_failed");
    }
  }
}

defineAction({
  id: "video.imageToVideo",
  station: "video",
  description:
    "Animate a still image into video via Alibaba HappyHorse i2v (real, key-gated). Submits, polls up to 10 min, and saves the finished clip to the project as /assets/videos/x.mp4.",
  argsSchema: z.object({
    assetId: z.string().min(1).describe("Asset id, gallery id, or public HTTPS URL of the first-frame image"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  requiresApproval: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const key = creatorKey(ctx);
    const params = getCreatorParams(key);
    const resolved = await resolveAssetUrl(ctx, args.assetId);
    if (!resolved) {
      return fail(
        `Asset "${args.assetId}" could not be resolved to a public URL (checked this conversation's results and your gallery).`,
        "not_implemented",
      );
    }
    if (!/^https:\/\//i.test(resolved.url)) {
      return fail(
        "HappyHorse image-to-video requires a PUBLIC HTTPS image URL — a data URL cannot be submitted.",
        "not_implemented",
      );
    }
    return runHappyHorse(ctx, {
      prompt: params.prompt,
      imageUrl: resolved.url,
      duration: params.videoDurationSec ?? 5,
      key,
    });
  },
});

defineAction({
  id: "video.generate",
  station: "video",
  description:
    "Generate a video from staged params. Wired: HappyHorse image-to-video when a first-frame image is staged (video.imageToVideo-style via attachReference). NOT wired: text-only video — the Veo path is wallet-entangled and fails honestly.",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: true,
  requiresApproval: true,
  execute: async (_args, ctx): Promise<StationResult> => {
    const key = creatorKey(ctx);
    const params = getCreatorParams(key);
    if (!params.referenceAssetId) {
      return fail(
        "video.generate needs a first-frame image: stage one with image.attachReference (or call video.imageToVideo with an assetId). Text-only video is not wired into station actions — the Veo text-to-video path requires wallet billing that station contexts cannot debit.",
        "not_implemented",
      );
    }
    const resolved = await resolveAssetUrl(ctx, params.referenceAssetId);
    if (!resolved || !/^https:\/\//i.test(resolved.url)) {
      return fail(
        `Reference image "${params.referenceAssetId}" could not be resolved to a public HTTPS URL.`,
        "not_implemented",
      );
    }
    return runHappyHorse(ctx, {
      prompt: params.prompt,
      imageUrl: resolved.url,
      duration: params.videoDurationSec ?? 5,
      key,
    });
  },
});
