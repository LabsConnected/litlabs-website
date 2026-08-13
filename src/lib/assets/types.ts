/**
 * Asset Lake — canonical asset types.
 *
 * The StudioAsset is the universal, normalized contract for all assets
 * across the Studio, regardless of where they originate (project_assets,
 * user_media, future sources). Legacy table shapes are mapped INTO this
 * type by source adapters — they are never exposed directly to the UI.
 *
 * Phase D establishes the contract + read facade. Creator write-path
 * normalization comes in Phase E.
 */

// ─── Asset kind ──────────────────────────────────────────────────

export type AssetKind =
  | "image"
  | "video"
  | "music"
  | "audio"
  | "design"
  | "code"
  | "game";

export const ASSET_KINDS: readonly AssetKind[] = [
  "image",
  "video",
  "music",
  "audio",
  "design",
  "code",
  "game",
];

export function isAssetKind(value: string): value is AssetKind {
  return (ASSET_KINDS as readonly string[]).includes(value);
}

// ─── Asset source ────────────────────────────────────────────────

export type AssetSource = "generated" | "uploaded" | "imported";

// ─── Asset visibility ────────────────────────────────────────────

export type AssetVisibility = "private" | "unlisted" | "public";

// ─── Canonical StudioAsset ───────────────────────────────────────

export interface StudioAsset {
  /** Source-qualified canonical ID (e.g. "project_asset:<uuid>"). */
  id: string;

  /** Project this asset belongs to, if any. */
  projectId?: string | null;

  kind: AssetKind;

  source: AssetSource;

  name: string;
  url: string;

  thumbnailUrl?: string;
  previewUrl?: string;

  mimeType?: string;

  provider?: string;
  model?: string;
  prompt?: string;
  promptHash?: string;

  width?: number;
  height?: number;
  durationSeconds?: number;

  costCredits?: number;

  createdAt: string;
  updatedAt?: string;

  parentAssetIds?: string[];
  version?: number;

  visibility: AssetVisibility;

  /** Source-specific metadata (checksum, inspection, missionId, etc.). */
  metadata?: Record<string, unknown>;
}

// ─── Canonical ID strategy ───────────────────────────────────────

/**
 * Asset IDs are source-qualified to prevent cross-source collisions.
 * Format: "<source_prefix>:<raw_uuid>"
 *
 * Examples:
 *   project_asset:550e8400-e29b-41d4-a716-446655440000
 *   user_media:550e8400-e29b-41d4-a716-446655440000
 */

export type AssetSourcePrefix = "project_asset" | "user_media";

export const ASSET_SOURCE_PREFIXES: readonly AssetSourcePrefix[] = [
  "project_asset",
  "user_media",
];
