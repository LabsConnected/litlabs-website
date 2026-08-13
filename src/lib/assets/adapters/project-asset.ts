/**
 * Asset Lake — project_assets adapter.
 *
 * Maps the visual-builds ProjectAsset (which is visual-build-specific
 * and includes missionId, buildId, inspection, checksum, sourceType)
 * into the canonical StudioAsset contract.
 *
 * Mapping rules (per Phase D contract):
 *   sourceType "generated" → source "generated"
 *   sourceType "uploaded"  → source "uploaded"
 *   sourceType "stock"     → source "imported"
 *   sourceType "project"   → source "imported"
 *
 *   storedUrl    → url
 *   originalUrl  → metadata.originalUrl
 *   provider     → provider
 *   prompt       → prompt
 *   width/height → width/height
 *   contentType  → mimeType
 *   checksum     → metadata.checksum
 *   inspection   → metadata.inspection
 *   missionId/buildId → metadata
 *   attribution/license → metadata
 *
 * No fabricated fields. Optional values left undefined when absent.
 */

import "server-only";

import type { ProjectAsset, VisualSourceType } from "@/lib/visual-builds/types";
import type { AssetKind, AssetSource, StudioAsset } from "../types";
import { buildCanonicalId } from "../ids";

/** Map visual-builds sourceType → Asset Lake source. */
export function mapSource(sourceType: VisualSourceType): AssetSource {
  switch (sourceType) {
    case "generated":
      return "generated";
    case "uploaded":
      return "uploaded";
    case "stock":
    case "project":
      return "imported";
  }
}

/** Infer AssetKind from contentType / inspection. Returns null for unknown types. */
export function inferKindFromProjectAsset(asset: ProjectAsset): AssetKind | null {
  const ct = asset.contentType.toLowerCase();
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) {
    // Distinguish music from audio — visual-builds doesn't tag this,
    // so we default to "audio" unless the inspection or metadata says otherwise.
    return "audio";
  }
  // Unknown content type — do NOT fabricate. Return null so the caller
  // can skip or handle the row truthfully.
  return null;
}

/** Derive a human-readable name from available fields. */
function deriveName(asset: ProjectAsset): string {
  // Use sectionKey or prompt snippet or fallback to id.
  if (asset.sectionKey) return asset.sectionKey;
  if (asset.prompt) {
    const snippet = asset.prompt.slice(0, 60).trim();
    return snippet.length > 0 ? snippet : asset.id;
  }
  return asset.id;
}

/**
 * Convert a visual-builds ProjectAsset into a canonical StudioAsset.
 * Does NOT fabricate any optional fields — absent values are omitted.
 * Returns null if the asset kind cannot be determined (unknown MIME type).
 */
export function projectAssetToStudioAsset(asset: ProjectAsset): StudioAsset | null {
  const kind = inferKindFromProjectAsset(asset);
  if (!kind) return null; // Unknown content type — skip truthfully.

  const metadata: Record<string, unknown> = {
    checksum: asset.checksum,
    inspection: asset.inspection,
    missionId: asset.missionId,
    buildId: asset.buildId,
    bytes: asset.bytes,
    selected: asset.selected,
    rejected: asset.rejected,
  };

  if (asset.originalUrl) metadata.originalUrl = asset.originalUrl;
  if (asset.attribution) metadata.attribution = asset.attribution;
  if (asset.license) metadata.license = asset.license;
  if (asset.query) metadata.query = asset.query;
  if (asset.rejectionReason) metadata.rejectionReason = asset.rejectionReason;

  const studioAsset: StudioAsset = {
    id: buildCanonicalId("project_asset", asset.id),
    projectId: asset.projectId,
    kind,
    source: mapSource(asset.sourceType),
    name: deriveName(asset),
    url: asset.storedUrl,
    mimeType: asset.contentType,
    provider: asset.provider || undefined,
    prompt: asset.prompt || undefined,
    visibility: "private", // project_assets are project-scoped, not public
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    metadata,
  };

  // Only include dimensions when actually present.
  if (asset.width != null) studioAsset.width = asset.width;
  if (asset.height != null) studioAsset.height = asset.height;

  return studioAsset;
}

/**
 * Batch-convert an array of ProjectAssets into StudioAssets.
 * Rows with unknown content types are skipped (not fabricated).
 */
export function projectAssetsToStudioAssets(
  assets: ProjectAsset[],
): StudioAsset[] {
  return assets
    .map(projectAssetToStudioAsset)
    .filter((a): a is StudioAsset => a !== null);
}
