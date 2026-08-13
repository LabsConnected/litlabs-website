/**
 * Asset Lake — music_tracks adapter.
 *
 * Maps music_tracks rows to canonical StudioAsset records.
 * music_tracks is the dedicated table for generated music, with
 * full provenance: provider, blueprint, duration, BPM, key, etc.
 *
 * Audio files live in R2 (ownership-scoped). The audio_storage_key
 * is the R2 key; the audioUrl is a signed/public URL constructed
 * by the /api/music/tracks endpoint.
 *
 * This adapter makes music tracks visible in the Asset Lake
 * WITHOUT requiring migration to user_media or project_assets.
 */

import type { AssetKind, AssetSource, StudioAsset } from "../types";
import { buildCanonicalId } from "../ids";

/** music_tracks row shape (as returned by Supabase). */
export interface MusicTrackRow {
  id: string;
  user_id: string;
  generation_id: string;
  project_id: string | null;
  version_label: string;
  title: string;
  blueprint: Record<string, unknown> | null;
  audio_storage_key: string;
  duration: number;
  bpm: number | null;
  musical_key: string | null;
  visibility: "private" | "unlisted" | "public";
  lbc_charged: number;
  provider: string;
  provider_model: string | null;
  created_at: string;
  updated_at: string;
  /** Signed/public URL — constructed by the tracks API. */
  audio_url?: string | null;
}

/**
 * Convert a music_tracks row into a canonical StudioAsset.
 * Returns null if the track has no playable URL — skipped truthfully.
 */
export function musicTrackToStudioAsset(
  track: MusicTrackRow,
): StudioAsset | null {
  // Need a URL to be a usable asset.
  const url = track.audio_url;
  if (!url) return null;

  const asset: StudioAsset = {
    id: buildCanonicalId("music_track", track.id),
    projectId: track.project_id ?? null,
    kind: "music" as AssetKind,
    source: "generated" as AssetSource,
    name: track.title,
    url,
    mimeType: "audio/mpeg", // music_tracks uses mp3 format
    provider: track.provider || undefined,
    model: track.provider_model || undefined,
    durationSeconds: track.duration || undefined,
    costCredits: track.lbc_charged || undefined,
    createdAt: track.created_at,
    updatedAt: track.updated_at,
    visibility: track.visibility,
    metadata: {
      generationId: track.generation_id,
      versionLabel: track.version_label,
      bpm: track.bpm,
      musicalKey: track.musical_key,
      blueprint: track.blueprint,
      audioStorageKey: track.audio_storage_key,
    },
  };

  return asset;
}

/**
 * Batch-convert music_tracks rows into StudioAssets.
 * Tracks without a playable URL are skipped.
 */
export function musicTracksToStudioAssets(
  tracks: MusicTrackRow[],
): StudioAsset[] {
  return tracks
    .map(musicTrackToStudioAsset)
    .filter((a): a is StudioAsset => a !== null);
}
