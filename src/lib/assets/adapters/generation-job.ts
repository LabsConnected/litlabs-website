/**
 * Asset Lake — generation_jobs adapter.
 *
 * Maps generation_jobs rows to canonical StudioAsset records.
 * generation_jobs is the unified job table for all media generation
 * (image, video, music, speech). It stores full provenance:
 * provider, model, prompt, cost, and metadata (including durableUrl,
 * dimensions, contentType, etc.).
 *
 * This adapter makes generated content visible in the Asset Lake
 * WITHOUT requiring a separate asset table. The generation job IS
 * the asset record — it has the URL, metadata, and provenance.
 *
 * Only completed jobs with a usable URL in metadata are returned.
 * Failed/cancelled/queued jobs are skipped.
 */

import type { GenerationJob } from "@/lib/generation/types";
import type { AssetKind, AssetSource, StudioAsset } from "../types";
import { buildCanonicalId } from "../ids";

/** Map generation_jobs modality to AssetKind. */
export function modalityToAssetKind(
  modality: GenerationJob["modality"],
): AssetKind | null {
  switch (modality) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "music":
      return "music";
    case "speech":
      return "audio";
    default:
      return null;
  }
}

/**
 * Extract the durable URL from a generation job's metadata.
 * The metadata field is a JSON object that may contain:
 * - durableUrl: the persistent R2/Supabase Storage URL
 * - downloadUrl: alternative key for the URL
 * - url: fallback key
 */
function extractUrl(job: GenerationJob): string | null {
  const meta = job.metadata as Record<string, unknown>;
  const url =
    meta.durableUrl ??
    meta.downloadUrl ??
    meta.url ??
    meta.audioUrl ??
    meta.videoUrl;
  if (typeof url === "string" && url.length > 0) return url;
  return null;
}

/** Extract optional thumbnail URL from metadata. */
function extractThumbnailUrl(job: GenerationJob): string | undefined {
  const meta = job.metadata as Record<string, unknown>;
  const thumb = meta.thumbUrl ?? meta.thumbnailUrl;
  if (typeof thumb === "string" && thumb.length > 0) return thumb;
  return undefined;
}

/** Extract optional MIME type from metadata. */
function extractMimeType(job: GenerationJob): string | undefined {
  const meta = job.metadata as Record<string, unknown>;
  const ct = meta.contentType ?? meta.mimeType;
  if (typeof ct === "string" && ct.length > 0) return ct;
  return undefined;
}

/** Extract optional dimensions from metadata. */
function extractDimensions(
  job: GenerationJob,
): { width?: number; height?: number } {
  const meta = job.metadata as Record<string, unknown>;
  const width = typeof meta.width === "number" ? meta.width : undefined;
  const height = typeof meta.height === "number" ? meta.height : undefined;
  return { width, height };
}

/** Extract optional duration from metadata. */
function extractDurationSeconds(job: GenerationJob): number | undefined {
  const meta = job.metadata as Record<string, unknown>;
  const duration =
    typeof meta.durationSeconds === "number"
      ? meta.durationSeconds
      : typeof meta.duration === "number"
        ? meta.duration
        : undefined;
  return duration;
}

/** Derive a human-readable name from the job. */
function deriveName(job: GenerationJob): string {
  const meta = job.metadata as Record<string, unknown>;
  if (typeof meta.title === "string" && meta.title.length > 0) {
    return meta.title;
  }
  // Truncate prompt for name
  const prompt = job.prompt || "";
  return prompt.length > 60 ? prompt.slice(0, 57) + "..." : prompt || "Generated asset";
}

/**
 * Convert a generation_jobs row into a canonical StudioAsset.
 * Returns null if the job is not completed, has no URL, or has an
 * unknown modality — these are skipped truthfully.
 */
export function generationJobToStudioAsset(
  job: GenerationJob,
): StudioAsset | null {
  // Only completed jobs represent assets.
  if (job.status !== "completed") return null;

  const kind = modalityToAssetKind(job.modality);
  if (!kind) return null;

  const url = extractUrl(job);
  if (!url) return null; // No URL — not a usable asset.

  const { width, height } = extractDimensions(job);
  const thumbnailUrl = extractThumbnailUrl(job);
  const mimeType = extractMimeType(job);
  const durationSeconds = extractDurationSeconds(job);

  // generation_jobs has no project_id column. Project association is
  // stored in metadata.projectId when provided during registration.
  // If no project binding exists, null is correct.
  const meta = job.metadata as Record<string, unknown>;
  const projectId =
    typeof meta.projectId === "string" && meta.projectId.length > 0
      ? meta.projectId
      : null;

  const asset: StudioAsset = {
    id: buildCanonicalId("generation_job", job.id),
    projectId,
    kind,
    source: "generated" as AssetSource,
    name: deriveName(job),
    url,
    thumbnailUrl,
    mimeType,
    provider: job.provider || undefined,
    model: job.model || undefined,
    prompt: job.prompt || undefined,
    width,
    height,
    durationSeconds,
    // Cost truthfulness: if metadata.costUnknown is true, the real
    // generation cost was not reported — surface as undefined, NOT 0.
    // A genuinely free generation has littBitsCharged=0 and no
    // costUnknown flag, and correctly surfaces as 0.
    costCredits:
      (job.metadata as Record<string, unknown>)?.costUnknown === true
        ? undefined
        : job.littBitsCharged,
    createdAt: job.createdAt,
    updatedAt: job.completedAt ?? undefined,
    visibility: "private", // generation jobs are user-private by default
    metadata: {
      jobId: job.id,
      requestId: job.requestId,
      modality: job.modality,
      refundStatus: job.refundStatus,
      ...job.metadata,
    },
  };

  return asset;
}

/**
 * Batch-convert generation_jobs rows into StudioAssets.
 * Incomplete or URL-less jobs are skipped.
 */
export function generationJobsToStudioAssets(
  jobs: GenerationJob[],
): StudioAsset[] {
  return jobs
    .map(generationJobToStudioAsset)
    .filter((a): a is StudioAsset => a !== null);
}
