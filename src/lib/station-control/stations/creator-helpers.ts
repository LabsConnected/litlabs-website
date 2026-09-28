/**
 * Station Control Bridge — shared helpers for the creator stations (chunk C).
 *
 * NOT a station module: nothing here registers an action. Helpers shared by
 * image/video/music/audio/assets: asset URL resolution, bounded provider
 * polling, project-asset saves for non-image media, and honest StationResult
 * construction.
 */
import "server-only";

import { z } from "zod";

import type {
  StationExecutionContext,
  StationResult,
} from "../types";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { getCreatorParams } from "./creator-state";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveInternalUserId } from "@/lib/generation/identity";

/** Permissive envelope schema for all creator station results. */
export const stationResultSchema = z.union([
  z.object({ success: z.literal(true) }).catchall(z.unknown()),
  z.object({
    success: z.literal(false),
    error: z.string(),
    errorCode: z.string().optional(),
  }),
]) as z.ZodType<StationResult>;

export const ok = (fields: Record<string, unknown> = {}): StationResult => ({
  success: true,
  ...fields,
});

/** Error-code union for honest station failures (mirrors StationResult). */
export type StationErrorCode = NonNullable<
  Extract<StationResult, { success: false }>["errorCode"]
>;

export const fail = (error: string, errorCode?: StationErrorCode): StationResult => ({
  success: false,
  error,
  ...(errorCode ? { errorCode } : {}),
});

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Aborted"));
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      cleanup();
      reject(new Error("Aborted"));
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Resolve an asset id to a public URL.
 *
 * Sources, in order:
 *  1. The session's creator-state lastResults (ids like `img_<requestId>` or
 *     the resultId returned by image.generate in this conversation).
 *  2. The user's durable `user_media` rows (gallery uploads) — same table the
 *     /api/gallery route reads, queried server-side via supabaseAdmin with
 *     the Clerk→internal-user mapping (no client session needed).
 *  3. A bare HTTPS URL passed as the id (convenience for callers that already
 *     hold a public URL).
 */
export async function resolveAssetUrl(
  ctx: StationExecutionContext,
  assetId: string,
): Promise<{ url: string; source: "creator-state" | "gallery" | "direct" } | null> {
  if (/^https:\/\//i.test(assetId)) {
    return { url: assetId, source: "direct" };
  }

  const params = getCreatorParams(
    `${ctx.conversationId ?? "default"}:${ctx.projectId ?? "default"}`,
  );
  const hit = params.lastResults.find((r) => r.id === assetId);
  if (hit) return { url: hit.url, source: "creator-state" };

  if (supabaseAdmin) {
    try {
      const internalUserId = await resolveInternalUserId(ctx.userId);
      if (internalUserId) {
        const { data, error } = await supabaseAdmin
          .from("user_media")
          .select("id, url")
          .eq("id", assetId)
          .eq("user_id", internalUserId)
          .maybeSingle();
        if (!error && data?.url) {
          return { url: data.url as string, source: "gallery" };
        }
      }
    } catch {
      // fall through to null
    }
  }
  return null;
}

/** The ctx.transport, narrowed to WorkspaceTransport when it really is one. */
export function getTransport(
  ctx: StationExecutionContext,
): WorkspaceTransport | null {
  const t = ctx.transport as {
    writeBinaryFile?: unknown;
    listFiles?: unknown;
  } | null;
  if (
    t &&
    typeof t.writeBinaryFile === "function" &&
    typeof t.listFiles === "function"
  ) {
    return t as WorkspaceTransport;
  }
  return null;
}

/**
 * Download a media URL and write it into the project workspace as a binary
 * file. Same shape as insertAssetFromUrl (tool-handlers-v2.ts) but accepts
 * video/audio content types, which the image-only pipeline rejects.
 *
 * Framework projects (package.json + next/vite config) go under
 * public/assets/<subdir> (served at the site root); static sites go under
 * assets/<subdir>. sitePath mirrors the image pipeline's mount-safe rule:
 * public/-prefixed paths become root-relative, everything else stays
 * relative so /preview and /sites mounts don't 404.
 */
export async function saveMediaToProject(
  url: string,
  opts: {
    nameHint?: string;
    subdir: "videos" | "audio";
    allowedMimes: string[];
    extension: string;
  },
  transport: WorkspaceTransport,
  signal?: AbortSignal,
): Promise<
  | { success: true; path: string; sitePath: string; sizeBytes: number }
  | { success: false; error: string }
> {
  const isDataUrl = /^data:(video|audio)\//i.test(url);
  if (!isDataUrl && !url.startsWith("https://")) {
    return { success: false, error: "Asset URL must be a public HTTPS URL or a data:video/* / data:audio/* URL" };
  }
  try {
    let buffer: Buffer;
    if (isDataUrl) {
      const comma = url.indexOf(",");
      const b64 = comma >= 0 ? url.slice(comma + 1) : "";
      buffer = Buffer.from(b64, "base64");
    } else {
      const resp = await fetch(url, {
        signal: signal ?? AbortSignal.timeout(60_000),
      });
      if (!resp.ok) {
        return { success: false, error: `Failed to download media: HTTP ${resp.status}` };
      }
      buffer = Buffer.from(await resp.arrayBuffer());
    }
    if (buffer.length === 0) return { success: false, error: "Downloaded media is empty" };
    if (buffer.length > 100 * 1024 * 1024) {
      return { success: false, error: "Media exceeds 100MB project-asset limit" };
    }

    const safe = (opts.nameHint || "media")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "media";
    const filename = `${Date.now()}-${safe}.${opts.extension}`;

    // Framework vs static detection (mirrors resolveInsertDirectory).
    let directory = `assets/${opts.subdir}`;
    try {
      const { entries } = await transport.listFiles(".");
      const names = new Set(entries.map((e) => e.name));
      if (names.has("package.json")) {
        directory = `public/assets/${opts.subdir}`;
      }
    } catch {
      // default stands
    }
    const path = `${directory}/${filename}`;
    try {
      await transport.writeBinaryFile(path, buffer.toString("base64"));
    } catch {
      await sleep(500);
      await transport.writeBinaryFile(path, buffer.toString("base64"));
    }
    const sitePath = path.startsWith("public/") ? `/${path.slice("public/".length)}` : path;
    return { success: true, path, sitePath, sizeBytes: buffer.length };
  } catch (err) {
    if (err instanceof Error && err.message === "Aborted") {
      return { success: false, error: "Save aborted" };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save media to project",
    };
  }
}
