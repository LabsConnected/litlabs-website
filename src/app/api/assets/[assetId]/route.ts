/**
 * DELETE /api/assets/[assetId] — delete ONE Asset Lake item for real.
 *
 * Created for the Studio Media panel's click-to-manage flow
 * (Amendment 6, 2026-11-16): clicking an item in Media and choosing
 * Delete must remove the item from the Asset Lake itself, not just
 * hide it in the panel. Before this route, /api/assets supported
 * GET/POST only — no delete path existed for lake items.
 *
 * The assetId is the canonical source-qualified ID the lake returns
 * ("<prefix>:<uuid>", see src/lib/assets/types.ts). Deletion removes
 * the underlying source row, scoped to the authenticated owner, so a
 * refetch of GET /api/assets no longer returns the item:
 *
 *   project_asset:<uuid>  → project_assets row (project ownership is
 *                           verified via getProject() first, and the
 *                           DELETE is scoped to id + project_id;
 *                           ?projectId= is required)
 *   user_media:<uuid>     → user_media row (id + caller's user_id)
 *   generation_job:<uuid> → generation_jobs row (id + caller's user_id)
 *   music_track:<uuid>    → music_tracks row (id + caller's user_id),
 *                           plus a best-effort R2 delete of the audio
 *                           object (reported as storageCleanup)
 *
 * Security mirrors /api/assets and /api/studio-projects/[projectId]:
 * authenticated users only, ownership verified server-side, and a
 * generic 404 for both "not found" and "not owned" so a foreign user
 * cannot probe whether an asset exists.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getProject } from "@/lib/projects/project-repository";

export const dynamic = "force-dynamic";

const USER_SCOPED_TABLES: Record<string, string> = {
  user_media: "user_media",
  generation_job: "generation_jobs",
  music_track: "music_tracks",
};

async function resolveInternalUserId(clerkId: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  const { assetId } = await params;
  const colonIndex = assetId.indexOf(":");
  if (colonIndex <= 0 || colonIndex === assetId.length - 1) {
    return NextResponse.json(
      { error: "Invalid asset ID format. Expected '<source>:<id>'." },
      { status: 400 },
    );
  }
  const prefix = assetId.slice(0, colonIndex);
  const rawId = assetId.slice(colonIndex + 1);

  // ── project_asset: verify project ownership, delete scoped row ──
  if (prefix === "project_asset") {
    const projectId = new URL(req.url).searchParams.get("projectId") || "";
    if (!projectId) {
      return NextResponse.json(
        { error: "projectId query parameter is required for project assets." },
        { status: 400 },
      );
    }
    let project = null;
    try {
      project = await getProject(projectId, clerkId);
    } catch {
      project = null;
    }
    if (!project) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    const { data, error } = await supabaseAdmin
      .from("project_assets")
      .delete()
      .eq("id", rawId)
      .eq("project_id", projectId)
      .select("id");
    if (error) {
      return NextResponse.json({ error: "Failed to delete asset." }, { status: 500 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, deletedId: assetId });
  }

  // ── user-owned sources: user_media / generation_jobs / music_tracks ──
  const table = USER_SCOPED_TABLES[prefix];
  if (!table) {
    return NextResponse.json(
      { error: `Unknown asset source prefix: ${prefix}` },
      { status: 400 },
    );
  }

  const internalUserId = await resolveInternalUserId(clerkId);
  if (!internalUserId) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  // Music tracks own an R2 object; read its key before the row goes so
  // storage cleanup can be attempted (best-effort, reported honestly).
  let audioStorageKey: string | null = null;
  if (prefix === "music_track") {
    const { data } = await supabaseAdmin
      .from("music_tracks")
      .select("audio_storage_key")
      .eq("id", rawId)
      .eq("user_id", internalUserId)
      .maybeSingle();
    audioStorageKey =
      (data as { audio_storage_key?: string } | null)?.audio_storage_key ?? null;
    if (!data) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
  }

  const { data, error } = await supabaseAdmin
    .from(table)
    .delete()
    .eq("id", rawId)
    .eq("user_id", internalUserId)
    .select("id");
  if (error) {
    return NextResponse.json({ error: "Failed to delete asset." }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  let storageCleanup: "deleted" | "skipped" | "failed" = "skipped";
  if (prefix === "music_track" && audioStorageKey) {
    try {
      const { deleteAudio } = await import("@/lib/r2");
      await deleteAudio(internalUserId, audioStorageKey);
      storageCleanup = "deleted";
    } catch {
      // Row is gone from the lake; the orphaned object is reported,
      // never hidden.
      storageCleanup = "failed";
    }
  }

  return NextResponse.json({ success: true, deletedId: assetId, storageCleanup });
}
