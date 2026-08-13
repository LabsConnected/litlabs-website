/**
 * Asset Lake — canonical read repository.
 *
 * One canonical read layer that aggregates assets from all source
 * adapters (project_assets, user_media, generation_jobs, music_tracks)
 * and returns normalized StudioAsset records.
 *
 * Security:
 *   - Server-only (uses supabaseAdmin).
 *   - Resolves Clerk ID → internal user UUID before querying user_media.
 *   - project_assets access is verified via getProject(projectId, clerkId)
 *     BEFORE any read — the caller's ownership of the project is checked
 *     server-side, not trusted from a client-supplied projectId.
 *   - user_media are scoped to the authenticated user's own rows.
 *   - generation_jobs are scoped to the authenticated user's own rows.
 *   - music_tracks are scoped to the authenticated user's own rows.
 *   - Never exposes another user's private media.
 *   - No arbitrary userId/projectId impersonation via parameters.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { getProject } from "@/lib/projects/project-repository";
import { listProjectAssets } from "@/lib/visual-builds/repository";
import { projectAssetsToStudioAssets } from "./adapters/project-asset";
import { userMediaRowsToStudioAssets, type UserMediaRow } from "./adapters/user-media";
import { generationJobsToStudioAssets } from "./adapters/generation-job";
import { musicTracksToStudioAssets, type MusicTrackRow } from "./adapters/music-track";
import type { AssetKind, StudioAsset } from "./types";
import type { GenerationJob } from "@/lib/generation/types";

export interface ListStudioAssetsOptions {
  /** Clerk user ID of the authenticated user. */
  clerkId: string;
  /** Optional project filter — only returns project_assets for this project. */
  projectId?: string;
  /** Optional kind filter. */
  kind?: AssetKind;
  /** Max results (default 50, max 200). */
  limit?: number;
  /**
   * Scope:
   *   "project"  — only project_assets for the given projectId
   *   "user"     — only the user's own user_media
   *   "all"      — both (default)
   */
  scope?: "project" | "user" | "all";
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

/**
 * Resolve a Clerk ID to the internal users.id UUID.
 * Returns null if the user is not found.
 */
async function resolveInternalUserId(clerkId: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Verify that the authenticated user owns/has access to the given project
 * before reading its assets. Returns true if access is granted.
 *
 * Uses the canonical getProject(projectId, clerkId) ownership check —
 * the same pattern used by /api/studio-projects/[projectId].
 */
async function verifyProjectAccess(
  projectId: string,
  clerkId: string,
): Promise<boolean> {
  try {
    const project = await getProject(projectId, clerkId);
    return project !== null;
  } catch {
    return false;
  }
}

/**
 * Fetch project_assets for a given project and convert to StudioAssets.
 * Ownership is verified BEFORE any read.
 */
async function fetchProjectAssets(
  projectId: string,
  clerkId: string,
  limit: number,
): Promise<StudioAsset[]> {
  const hasAccess = await verifyProjectAccess(projectId, clerkId);
  if (!hasAccess) return [];
  const assets = await listProjectAssets(projectId, { limit });
  return projectAssetsToStudioAssets(assets);
}

/**
 * Fetch the authenticated user's own user_media rows and convert to StudioAssets.
 */
async function fetchUserMedia(
  internalUserId: string,
  limit: number,
): Promise<StudioAsset[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from("user_media")
    .select("id, user_id, url, type, caption, is_public, category, likes_count, created_at")
    .eq("user_id", internalUserId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return userMediaRowsToStudioAssets(data as UserMediaRow[]);
}

/**
 * Fetch the authenticated user's own completed generation_jobs and convert
 * to StudioAssets. Only completed jobs with a URL in metadata are returned.
 */
async function fetchGenerationJobs(
  internalUserId: string,
  limit: number,
): Promise<StudioAsset[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from("generation_jobs")
    .select("*")
    .eq("user_id", internalUserId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return generationJobsToStudioAssets(data as unknown as GenerationJob[]);
}

/**
 * Fetch the authenticated user's own music_tracks and convert to StudioAssets.
 * Constructs audio URLs from the R2 storage key:
 *   - Public tracks: public R2 URL via getPublicAudioUrl()
 *   - Private/unlisted tracks: signed R2 URL via getSignedAudioUrl()
 *
 * This ensures ALL owned tracks are visible in Asset Lake, not just public
 * ones. Private tracks get time-limited signed URLs (1 hour) that are
 * valid for the owner. The signed URL mechanism reuses the existing
 * authenticated playback path — no public exposure of private audio.
 */
async function fetchMusicTracks(
  internalUserId: string,
  limit: number,
): Promise<StudioAsset[]> {
  if (!supabaseAdmin) return [];

  const { data, error } = await supabaseAdmin
    .from("music_tracks")
    .select(`
      id, user_id, generation_id, project_id, version_label, title,
      blueprint, audio_storage_key, duration, bpm, musical_key,
      visibility, lbc_charged, provider, provider_model,
      created_at, updated_at
    `)
    .eq("user_id", internalUserId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  const tracks = data as MusicTrackRow[];

  // Resolve audio URLs for each track.
  // Public tracks get public URLs; private/unlisted get signed URLs.
  // Signed URL generation is async, so we resolve in parallel.
  const tracksWithUrls = await Promise.all(
    tracks.map(async (track) => {
      const audioUrl = await resolveTrackAudioUrlForAssetLake(
        internalUserId,
        track.audio_storage_key,
        track.visibility,
      );
      return { ...track, audio_url: audioUrl };
    }),
  );

  return musicTracksToStudioAssets(tracksWithUrls);
}

/**
 * Resolve a playable audio URL for a music track in the Asset Lake.
 *
 * - Public tracks: use getPublicAudioUrl() (no ownership check needed).
 * - Private/unlisted tracks: use getSignedAudioUrl() with ownership
 *   validation. The signed URL expires in 1 hour.
 *
 * Returns null if URL resolution fails (R2 not configured, etc.).
 * Never fabricates a URL or makes private tracks public.
 */
async function resolveTrackAudioUrlForAssetLake(
  internalUserId: string,
  storageKey: string,
  visibility: "private" | "unlisted" | "public",
): Promise<string | null> {
  try {
    if (visibility === "public") {
      const { getPublicAudioUrl } = await import("@/lib/r2");
      return getPublicAudioUrl(storageKey);
    }
    // Private/unlisted: generate a signed URL with ownership validation.
    const { getSignedAudioUrl } = await import("@/lib/r2");
    return await getSignedAudioUrl(internalUserId, storageKey, 3600);
  } catch {
    // R2 not configured or ownership validation failed.
    return null;
  }
}

/**
 * List normalized StudioAssets for the authenticated user.
 *
 * Aggregates from project_assets (if projectId is given) and user_media
 * (the user's own uploads). Returns newest-first where reasonable.
 *
 * Never fabricates data. Returns [] on empty results.
 * Returns a truthful error message if Supabase is unavailable.
 */
export async function listStudioAssets(
  opts: ListStudioAssetsOptions,
): Promise<{ assets: StudioAsset[]; error: string | null }> {
  if (!opts.clerkId) {
    return { assets: [], error: "Authentication required." };
  }

  if (!supabaseAdmin) {
    return { assets: [], error: "Database is not configured." };
  }

  const limit = clampLimit(opts.limit);
  const scope = opts.scope ?? "all";

  const results: StudioAsset[] = [];

  // Fetch project_assets if scoped to project or all.
  // Ownership is verified inside fetchProjectAssets via getProject().
  if ((scope === "project" || scope === "all") && opts.projectId) {
    try {
      const projectAssets = await fetchProjectAssets(opts.projectId, opts.clerkId, limit);
      results.push(...projectAssets);
    } catch {
      // If project_assets fetch fails, continue with user_media.
    }
  }

  // Fetch user_media if scoped to user or all.
  if (scope === "user" || scope === "all") {
    try {
      const internalUserId = await resolveInternalUserId(opts.clerkId);
      if (internalUserId) {
        const userAssets = await fetchUserMedia(internalUserId, limit);
        results.push(...userAssets);

        // Also fetch generation_jobs (user's own completed jobs).
        const jobAssets = await fetchGenerationJobs(internalUserId, limit);
        results.push(...jobAssets);

        // Also fetch music_tracks (user's own tracks).
        const musicAssets = await fetchMusicTracks(internalUserId, limit);
        results.push(...musicAssets);
      }
    } catch {
      // If user-scoped fetch fails, continue with what we have.
    }
  }

  // Apply kind filter if requested.
  const filtered = opts.kind
    ? results.filter((a) => a.kind === opts.kind)
    : results;

  // Sort newest-first by createdAt.
  filtered.sort((a, b) => {
    return b.createdAt.localeCompare(a.createdAt);
  });

  // Apply overall limit.
  const capped = filtered.slice(0, limit);

  return { assets: capped, error: null };
}

/**
 * Get a single StudioAsset by its canonical ID.
 *
 * Parses the source prefix and delegates to the appropriate adapter.
 * Returns null if the asset is not found or not accessible by the user.
 */
export async function getStudioAsset(
  canonicalId: string,
  opts: { clerkId: string; projectId?: string },
): Promise<{ asset: StudioAsset | null; error: string | null }> {
  if (!opts.clerkId) {
    return { asset: null, error: "Authentication required." };
  }

  if (!supabaseAdmin) {
    return { asset: null, error: "Database is not configured." };
  }

  const colonIndex = canonicalId.indexOf(":");
  if (colonIndex <= 0) {
    return { asset: null, error: "Invalid asset ID format." };
  }
  const prefix = canonicalId.slice(0, colonIndex);
  const rawId = canonicalId.slice(colonIndex + 1);

  if (prefix === "project_asset") {
    if (!opts.projectId) {
      return { asset: null, error: "Project ID required for project assets." };
    }
    // Verify ownership before reading project assets.
    const hasAccess = await verifyProjectAccess(opts.projectId, opts.clerkId);
    if (!hasAccess) {
      return { asset: null, error: "Project not found." };
    }
    const assets = await fetchProjectAssets(opts.projectId, opts.clerkId, MAX_LIMIT);
    const found = assets.find((a) => a.id === canonicalId);
    return { asset: found ?? null, error: null };
  }

  if (prefix === "user_media") {
    const internalUserId = await resolveInternalUserId(opts.clerkId);
    if (!internalUserId) {
      return { asset: null, error: "User not found." };
    }
    const { data, error } = await supabaseAdmin
      .from("user_media")
      .select("id, user_id, url, type, caption, is_public, category, likes_count, created_at")
      .eq("id", rawId)
      .eq("user_id", internalUserId) // Security: only own media
      .maybeSingle();

    if (error || !data) {
      return { asset: null, error: null };
    }

    const { userMediaToStudioAsset } = await import("./adapters/user-media");
    return { asset: userMediaToStudioAsset(data as UserMediaRow), error: null };
  }

  if (prefix === "generation_job") {
    const internalUserId = await resolveInternalUserId(opts.clerkId);
    if (!internalUserId) {
      return { asset: null, error: "User not found." };
    }
    const { data, error } = await supabaseAdmin
      .from("generation_jobs")
      .select("*")
      .eq("id", rawId)
      .eq("user_id", internalUserId) // Security: only own jobs
      .maybeSingle();

    if (error || !data) {
      return { asset: null, error: null };
    }

    const { generationJobToStudioAsset } = await import("./adapters/generation-job");
    return { asset: generationJobToStudioAsset(data as unknown as GenerationJob), error: null };
  }

  if (prefix === "music_track") {
    const internalUserId = await resolveInternalUserId(opts.clerkId);
    if (!internalUserId) {
      return { asset: null, error: "User not found." };
    }
    const { data, error } = await supabaseAdmin
      .from("music_tracks")
      .select(`
        id, user_id, generation_id, project_id, version_label, title,
        blueprint, audio_storage_key, duration, bpm, musical_key,
        visibility, lbc_charged, provider, provider_model,
        created_at, updated_at
      `)
      .eq("id", rawId)
      .eq("user_id", internalUserId) // Security: only own tracks
      .maybeSingle();

    if (error || !data) {
      return { asset: null, error: null };
    }

    const track = data as MusicTrackRow;
    // Resolve audio URL: public tracks get public URL,
    // private/unlisted get signed URL with ownership validation.
    track.audio_url = await resolveTrackAudioUrlForAssetLake(
      internalUserId,
      track.audio_storage_key,
      track.visibility,
    );
    const { musicTrackToStudioAsset } = await import("./adapters/music-track");
    return { asset: musicTrackToStudioAsset(track), error: null };
  }

  return { asset: null, error: `Unknown asset source prefix: ${prefix}` };
}
