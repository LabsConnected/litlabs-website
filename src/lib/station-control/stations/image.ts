/**
 * Station Control Bridge — image station (chunk C, server-only).
 *
 * Backend wiring:
 * - Param-staging actions (setPrompt/setNegativePrompt/setStyle/
 *   setAspectRatio/attachReference/selectResult) write to creator-state.
 * - image.generate calls the REAL image-service.generateImage directly
 *   (same substrate as tool-handlers.ts handleImageGenerate — the agent
 *   loop has no Clerk session, so routes are never HTTP-fetched). On success
 *   it runs the same deterministic asset pipeline the tool registry uses:
 *   insertAssetFromUrl (tool-handlers-v2.ts, the fn maybeAutoInsertGeneratedImage
 *   uses) → returns stable {path, sitePath} e.g. /assets/images/x.png when a
 *   project transport is present. Chat-only contexts (no transport/projectId)
 *   get the generated URL honestly with savedToProject:false.
 * - image.saveAsset delegates to the real `project.insert_asset` tool.
 * - image.sendToCanvas composes YOUR canvas.addNode action (sanctioned
 *   cross-action composition via getStationAction(...).execute with the same
 *   ctx). The asset must already be saved — no fake re-save.
 * - image.upscale is DELIBERATELY NOT REGISTERED: no real upscaler exists;
 *   the ImageTool "Upscale 4K" button was a prompt-suffix fake (audit §3).
 */
import "server-only";

import { z } from "zod";

import { registerStationAction, getStationAction } from "../registry";
import { delegateToTool } from "../delegate";
import { setDelegateToolId } from "../advertise";
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
  stationResultSchema,
} from "./creator-helpers";
import {
  creatorKey,
  getCreatorParams,
  pushCreatorResult,
  setCreatorParams,
} from "./creator-state";
import {
  generateImage,
  type ImageGenerationInput,
} from "@/lib/generation/image-service";
import { insertAssetFromUrl } from "@/lib/litt-intelligence/tool-handlers-v2";

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
  id: "image.setPrompt",
  station: "image",
  description: "Stage the image generation prompt for this conversation.",
  argsSchema: z.object({ prompt: z.string().min(3) }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    setCreatorParams(creatorKey(ctx), { prompt: args.prompt });
    return ok({ prompt: args.prompt });
  },
});

defineAction({
  id: "image.setNegativePrompt",
  station: "image",
  description: "Stage a negative prompt (what to avoid) for image generation.",
  argsSchema: z.object({ negativePrompt: z.string() }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    setCreatorParams(creatorKey(ctx), { negativePrompt: args.negativePrompt });
    return ok({ negativePrompt: args.negativePrompt });
  },
});

defineAction({
  id: "image.setStyle",
  station: "image",
  description: "Stage a style descriptor for image generation.",
  argsSchema: z.object({ style: z.string() }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    setCreatorParams(creatorKey(ctx), { style: args.style });
    return ok({ style: args.style });
  },
});

defineAction({
  id: "image.setAspectRatio",
  station: "image",
  description: "Stage an aspect ratio (e.g. 16:9, 1:1, 9:16) for image generation.",
  argsSchema: z.object({ aspectRatio: z.string().min(3) }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    setCreatorParams(creatorKey(ctx), { aspectRatio: args.aspectRatio });
    return ok({ aspectRatio: args.aspectRatio });
  },
});

defineAction({
  id: "image.attachReference",
  station: "image",
  description:
    "Attach a reference asset (asset id, gallery id, or public HTTPS URL) used as reference input for the next image.generate.",
  argsSchema: z.object({ assetId: z.string().min(1) }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    setCreatorParams(creatorKey(ctx), { referenceAssetId: args.assetId });
    return ok({ referenceAssetId: args.assetId });
  },
});

defineAction({
  id: "image.selectResult",
  station: "image",
  description:
    "Select a previous image.generate result (by resultId from this conversation's results) as the active result for saveAsset/sendToCanvas.",
  argsSchema: z.object({ resultId: z.string().min(1) }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const params = getCreatorParams(creatorKey(ctx));
    const hit = params.lastResults.find((r) => r.id === args.resultId);
    if (!hit) {
      return fail(
        `Result "${args.resultId}" not found in this conversation's image results. Generate an image first.`,
        "not_implemented",
      );
    }
    setCreatorParams(creatorKey(ctx), { selectedResultId: args.resultId });
    return ok({ resultId: args.resultId, url: hit.url });
  },
});

defineAction({
  id: "image.generate",
  station: "image",
  description:
    "Generate an image with the real image service (auto-free mode by default), merging staged creator params. Saves the result into the project as /assets/images/x.png when a project transport is present.",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: true,
  requiresApproval: true,
  execute: async (_args, ctx): Promise<StationResult> => {
    const key = creatorKey(ctx);
    const params = getCreatorParams(key);
    const prompt = params.prompt?.trim();
    if (!prompt || prompt.length < 3) {
      return fail(
        "No generation prompt staged. Call image.setPrompt first with at least 3 characters.",
        "invalid_args",
      );
    }
    if (!ctx.userId) {
      return fail("Image generation requires an authenticated user context", "permission_denied");
    }

    let referenceUrl: string | undefined;
    if (params.referenceAssetId) {
      const resolved = await resolveAssetUrl(ctx, params.referenceAssetId);
      if (!resolved) {
        return fail(
          `Reference asset "${params.referenceAssetId}" could not be resolved to a URL.`,
          "not_implemented",
        );
      }
      referenceUrl = resolved.url;
    }

    const styledPrompt = params.style ? `${prompt}, ${params.style}` : prompt;
    const input: ImageGenerationInput = {
      prompt: styledPrompt,
      format: "image",
      generationMode: "auto-free",
      ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
      ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
      ...(referenceUrl ? { referenceUrl } : {}),
    };

    const requestId = ctx.actionContext?.actionRunId
      ? `approval:${ctx.actionContext.actionRunId}`
      : undefined;
    const result = await generateImage(
      {
        userId: ctx.userId,
        ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
        ...(requestId ? { requestId } : {}),
      },
      input,
    );
    if (!result.success) {
      return fail(result.error, "execution_failed");
    }

    const resultId = `img_${result.requestId ?? Date.now()}`;
    ctx.emitEvent({
      type: "live_state",
      actionId: "image.generate",
      station: "image",
      summary: `Image generated via ${result.providerId ?? "auto"}`,
    });

    const transport = getTransport(ctx);
    if (transport && ctx.projectId) {
      const saved = await insertAssetFromUrl(
        result.downloadUrl,
        { nameHint: "generated", directory: undefined },
        transport,
      );
      if (!saved.success) {
        pushCreatorResult(key, { id: resultId, url: result.downloadUrl, kind: "image" });
        return ok({
          resultId,
          url: result.downloadUrl,
          savedToProject: false,
          saveError: saved.error ?? "Failed to insert asset into project",
          providerId: result.providerId ?? null,
        });
      }
      pushCreatorResult(key, {
        id: resultId,
        url: result.downloadUrl,
        kind: "image",
        sitePath: saved.sitePath,
      });
      return ok({
        resultId,
        url: result.downloadUrl,
        savedToProject: true,
        path: saved.path,
        sitePath: saved.sitePath,
        providerId: result.providerId ?? null,
        hint: `Reference this image in the site's HTML as <img src="${saved.sitePath}" />.`,
      });
    }

    pushCreatorResult(key, { id: resultId, url: result.downloadUrl, kind: "image" });
    return ok({
      resultId,
      url: result.downloadUrl,
      savedToProject: false,
      reason: "No project transport in this context — image is chat-only.",
      providerId: result.providerId ?? null,
    });
  },
});

const saveAssetExecute = delegateToTool("project.insert_asset", (args) => ({
  projectId: args.projectId,
  url: args.url,
  name: args.name,
}));

defineAction({
  id: "image.saveAsset",
  station: "image",
  description:
    "Save an image result into the project workspace (delegates to the real project.insert_asset). Pass a resultId from image.generate, or a public image URL directly.",
  argsSchema: z.object({
    resultId: z.string().min(1),
    name: z.string().optional(),
  }),
  resultType: stationResultSchema,
  mutating: true,
  requiresApproval: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const key = creatorKey(ctx);
    const params = getCreatorParams(key);
    const id = args.resultId === "selected" && params.selectedResultId
      ? params.selectedResultId
      : args.resultId;
    const hit = params.lastResults.find((r) => r.id === id);
    const url = hit?.url ?? (/^https:\/\//i.test(id) ? id : null);
    if (!url) {
      return fail(
        `Cannot save "${args.resultId}": not a known result id and not a public URL. Generate first or pass the resultId.`,
        "not_implemented",
      );
    }
    const outcome = await saveAssetExecute(
      {
        projectId: ctx.projectId,
        url,
        ...(args.name ? { name: args.name } : {}),
      },
      ctx,
    );
    if (outcome.success) {
      const inner = (outcome as { success: true; result?: { sitePath?: string } }).result;
      if (hit && inner?.sitePath) {
        hit.sitePath = inner.sitePath;
      }
      ctx.reportLiveState({ station: "image", action: "image.saveAsset", url });
    }
    return outcome;
  },
});
setDelegateToolId("image.saveAsset", "project.insert_asset");

defineAction({
  id: "image.sendToCanvas",
  station: "image",
  description:
    "Add a saved image asset as an image block on the active canvas (composes canvas.addNode). The asset must already be saved to the project (image.generate in a project context, or image.saveAsset) — this fails honestly otherwise.",
  argsSchema: z.object({
    resultId: z.string().min(1),
    alt: z.string().optional(),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const key = creatorKey(ctx);
    const params = getCreatorParams(key);
    const id = args.resultId === "selected" && params.selectedResultId
      ? params.selectedResultId
      : args.resultId;
    const hit = params.lastResults.find((r) => r.id === id);
    const sitePath = hit?.sitePath;
    if (!hit || !sitePath) {
      return fail(
        `Result "${args.resultId}" has no saved project asset path. Call image.saveAsset first (or run image.generate with a project transport), then image.sendToCanvas.`,
        "not_implemented",
      );
    }
    const addNode = getStationAction("canvas.addNode");
    if (!addNode) {
      return fail("canvas.addNode is not registered — cannot send to canvas.", "not_implemented");
    }
    return addNode.execute(
      { type: "image", props: { url: sitePath, alt: args.alt ?? "Generated image" } },
      ctx,
    ) as Promise<StationResult>;
  },
});

// NOTE: image.upscale is intentionally NOT registered. There is no real
// upscaler backend — the Studio ImageTool "Upscale 4K" button only appended
// a prompt suffix. The UI lie is fixed separately (see the ImageTool.tsx
// relabel: "Upscale 4K" → "Enhance details").
