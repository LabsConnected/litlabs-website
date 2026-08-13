/**
 * Asset Lake — user_media adapter.
 *
 * Maps legacy user_media rows (the gallery/media library table) into
 * the canonical StudioAsset contract.
 *
 * user_media does NOT reliably store generation provenance (no
 * provider, model, or prompt fields). Therefore:
 *   - source is "imported" (provenance unknown)
 *   - no provider/model/prompt fields are fabricated
 *   - legacy info (caption, category, likes_count) goes to metadata
 *
 * Visibility mapping:
 *   is_public === true  → "public"
 *   is_public === false → "private"
 *
 * The user_media.user_id column references users(id) which is a UUID,
 * NOT a Clerk ID. The repository layer handles auth scoping.
 */

import "server-only";

import type { AssetKind, AssetVisibility, StudioAsset } from "../types";
import { buildCanonicalId } from "../ids";

/** Raw user_media row shape from Supabase. */
export interface UserMediaRow {
  id: string;
  user_id: string;
  url: string;
  type: string; // 'image', 'video', 'audio'
  caption: string | null;
  is_public: boolean;
  category: string | null;
  likes_count: number;
  created_at: string;
}

/** Map user_media type → AssetKind. */
export function inferKindFromUserMedia(row: UserMediaRow): AssetKind {
  switch (row.type) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    default:
      // Unknown type — default to image since gallery is image-heavy.
      return "image";
  }
}

/** Map is_public → AssetVisibility. */
export function mapVisibility(isPublic: boolean): AssetVisibility {
  return isPublic ? "public" : "private";
}

/**
 * Convert a user_media row into a canonical StudioAsset.
 * Source is always "imported" because provenance is unknown.
 * No provider, model, prompt, or dimensions are fabricated.
 */
export function userMediaToStudioAsset(row: UserMediaRow): StudioAsset {
  const metadata: Record<string, unknown> = {
    category: row.category,
    likesCount: row.likes_count,
  };

  const asset: StudioAsset = {
    id: buildCanonicalId("user_media", row.id),
    projectId: null, // user_media has no project binding
    kind: inferKindFromUserMedia(row),
    source: "imported",
    name: row.caption || "Untitled",
    url: row.url,
    visibility: mapVisibility(row.is_public),
    createdAt: row.created_at,
    metadata,
  };

  return asset;
}

/**
 * Batch-convert user_media rows into StudioAssets.
 */
export function userMediaRowsToStudioAssets(
  rows: UserMediaRow[],
): StudioAsset[] {
  return rows.map(userMediaToStudioAsset);
}
