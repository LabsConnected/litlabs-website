/**
 * Station Control Bridge — assets station (chunk C, server-only).
 *
 * Backend wiring:
 * - assets.save delegates to the real `project.insert_asset` tool
 *   (tool-registry.ts:1269 → tool-handlers-v2.ts handleProjectInsertAsset →
 *   insertAssetFromUrl → transport.writeBinaryFile). Validates image types
 *   (JPEG/PNG/GIF/WebP enforced by the pipeline) and returns stable
 *   {path, sitePath}.
 * - assets.search is a thin server-side adapter over the same Supabase
 *   `user_media` table the /api/gallery route reads (the route handler itself
 *   is not cleanly importable — Clerk-cookie auth + rate limiter — so this
 *   replicates its "my-uploads" query via supabaseAdmin with the
 *   Clerk→internal-user mapping). Honest failure when Supabase is unavailable.
 * - assets.useInProject resolves an asset id to its gallery URL and copies it
 *   into the project at targetPath via insertAssetFromUrl (image assets only —
 *   the pipeline rejects non-images honestly).
 * - assets.delete is DELIBERATELY OMITTED: no backend delete exists anywhere
 *   (contract §3.3 wants approval gating when it is built — approval for a
 *   nonexistent capability would be theater).
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
import {
  fail,
  getTransport,
  ok,
  stationResultSchema,
} from "./creator-helpers";
import { insertAssetFromUrl } from "@/lib/litt-intelligence/tool-handlers-v2";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveInternalUserId } from "@/lib/generation/identity";

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

const saveExecute = delegateToTool("project.insert_asset", (args) => ({
  projectId: args.projectId,
  url: args.url,
  ...(args.name ? { name: args.name } : {}),
}));

defineAction({
  id: "assets.save",
  station: "assets",
  description:
    "Save an image (public HTTPS URL or data:image/* blob) into the project workspace. Delegates to the real project.insert_asset: JPEG/PNG/GIF/WebP only, returns stable {path, sitePath}. Tags are accepted for forward-compat but not persisted by the backend.",
  argsSchema: z.object({
    blob: z.string().min(1).describe("Public HTTPS URL or data:image/* URL of the image"),
    name: z.string().optional().describe("Filename hint, e.g. 'hero-sunset'"),
    tags: z.array(z.string()).optional(),
  }),
  resultType: stationResultSchema,
  mutating: true,
  requiresApproval: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const outcome = await saveExecute(
      {
        projectId: ctx.projectId,
        url: args.blob,
        ...(args.name ? { name: args.name } : {}),
      },
      ctx,
    );
    if (!outcome.success) return outcome;
    return ok({
      ...(outcome as { success: true } & Record<string, unknown>),
      ...(args.tags ? { tags: args.tags, tagsNote: "Tags are echoed, not persisted — insert_asset has no tag storage." } : {}),
    });
  },
});
setDelegateToolId("assets.save", "project.insert_asset");

defineAction({
  id: "assets.search",
  station: "assets",
  description:
    "Search the user's durable gallery assets (Supabase user_media — same table /api/gallery reads). Read-only.",
  argsSchema: z.object({
    query: z.string().optional().describe("Matches caption or category, case-insensitive"),
    kind: z.enum(["image", "video"]).optional(),
    limit: z.number().int().min(1).max(50).optional().default(20),
  }),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (args, ctx): Promise<StationResult> => {
    if (!supabaseAdmin) {
      return fail("Asset search is unavailable: Supabase is not configured.", "not_configured");
    }
    try {
      const internalUserId = await resolveInternalUserId(ctx.userId);
      if (!internalUserId) {
        return fail("Asset search requires a known user identity.", "permission_denied");
      }
      let query = supabaseAdmin
        .from("user_media")
        .select("id, url, type, caption, category, created_at")
        .eq("user_id", internalUserId)
        .in("type", args.kind ? [args.kind] : ["image", "video"])
        .order("created_at", { ascending: false })
        .limit(args.limit ?? 20);
      if (args.query) {
        const q = args.query.replace(/[%_]/g, "");
        query = query.or(`caption.ilike.%${q}%,category.ilike.%${q}%`);
      }
      const { data, error } = await query;
      if (error) return fail(`Asset search failed: ${error.message}`, "execution_failed");
      return ok({
        items: (data ?? []).map((row) => ({
          id: row.id,
          url: row.url,
          type: row.type,
          caption: row.caption ?? null,
          category: row.category ?? null,
        })),
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Asset search failed", "execution_failed");
    }
  },
});

defineAction({
  id: "assets.useInProject",
  station: "assets",
  description:
    "Copy a gallery asset into the project workspace at targetPath (workspace-relative, e.g. assets/images/hero.png). Resolves the asset id to its stored URL, then inserts it via the real insertAssetFromUrl. Image assets only — the insert pipeline honestly rejects non-image content types.",
  argsSchema: z.object({
    assetId: z.string().min(1),
    targetPath: z.string().min(1).describe("Workspace-relative destination path"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  requiresApproval: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const target = args.targetPath.replace(/^\/+/, "");
    if (target.includes("..") || !target) {
      return fail("targetPath must be a workspace-relative path without parent traversal.", "invalid_args");
    }
    const transport = getTransport(ctx);
    if (!transport || !ctx.projectId) {
      return fail("assets.useInProject requires a project transport (project context).", "permission_denied");
    }
    if (!supabaseAdmin) {
      return fail("Asset resolution is unavailable: Supabase is not configured.", "not_configured");
    }
    let url: string | null = null;
    try {
      const internalUserId = await resolveInternalUserId(ctx.userId);
      if (!internalUserId) return fail("Asset resolution requires a known user identity.", "permission_denied");
      const { data, error } = await supabaseAdmin
        .from("user_media")
        .select("url")
        .eq("id", args.assetId)
        .eq("user_id", internalUserId)
        .maybeSingle();
      if (error || !data?.url) {
        return fail(`Asset "${args.assetId}" not found in your gallery.`, "not_implemented");
      }
      url = data.url as string;
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Asset resolution failed", "execution_failed");
    }

    const slash = target.lastIndexOf("/");
    const directory = slash > 0 ? target.slice(0, slash) : ".";
    const base = slash >= 0 ? target.slice(slash + 1) : target;
    const nameHint = base.replace(/\.[a-z0-9]+$/i, "") || undefined;
    const saved = await insertAssetFromUrl(url, { nameHint, directory }, transport);
    if (!saved.success) {
      return fail(saved.error ?? "Failed to insert asset into project", "execution_failed");
    }
    ctx.reportLiveState({ station: "assets", action: "assets.useInProject", targetPath: saved.path });
    return ok({
      assetId: args.assetId,
      path: saved.path,
      sitePath: saved.sitePath,
      note: "Saved under the sanitized filename from targetPath's basename — directory honored, exact filename not guaranteed.",
    });
  },
});

// NOTE: assets.delete is intentionally NOT registered — no backend delete
// exists. The contract (§3.3) wants approval gating when it is built; adding
// a stub now would only be theater.
