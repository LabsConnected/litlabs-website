/**
 * Asset Lake — asset registration (write seam).
 *
 * This is the minimum WRITE/REGISTRATION seam needed so creator
 * outputs can reliably enter Asset Lake.
 *
 * Strategy:
 * - For outputs already saved to generation_jobs (Image): no write
 *   needed — the READ adapter picks them up.
 * - For outputs that are browser-only (Video, Audio): this registration
 *   layer creates a generation_jobs record with the durable URL and
 *   metadata, making them visible to the READ adapter.
 * - For music_tracks: already persisted — no write needed.
 *
 * This does NOT create a new database table. It reuses generation_jobs
 * as the unified asset record for generated content.
 *
 * Security:
 *   - Server-only (uses supabaseAdmin).
 *   - Authenticated users only.
 *   - Resolves Clerk ID → internal user UUID.
 *   - No arbitrary userId/projectId impersonation.
 *   - Project association is truthful — null if no project.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { getProject } from "@/lib/projects/project-repository";
import { createGenerationJob } from "@/lib/generation/jobs";
import type { GenerationModality } from "@/lib/generation/types";
import type { AssetKind, StudioAsset } from "./types";
import { buildCanonicalId } from "./ids";
import { generationJobToStudioAsset } from "./adapters/generation-job";
import type { GenerationJob } from "@/lib/generation/types";

export interface RegisterAssetInput {
  /** The kind of asset being registered. */
  kind: AssetKind;
  /** Durable URL of the asset (R2, Supabase Storage, etc.). */
  url: string;
  /** Optional thumbnail URL. */
  thumbnailUrl?: string;
  /** MIME type of the asset. */
  mimeType?: string;
  /** Generation provider (e.g., "fal", "veo", "gemini"). */
  provider?: string;
  /** Model used for generation. */
  model?: string;
  /** Prompt used for generation. */
  prompt?: string;
  /** Image/video width. */
  width?: number;
  /** Image/video height. */
  height?: number;
  /** Audio/video duration in seconds. */
  durationSeconds?: number;
  /** Cost in LiTTBits. */
  costCredits?: number;
  /** Project to associate with (optional, verified). */
  projectId?: string;
  /** Additional metadata. */
  metadata?: Record<string, unknown>;
  /** Idempotency key (reuses existing job if present). */
  requestId?: string;
}

export interface RegisterAssetResult {
  asset: StudioAsset | null;
  error: string | null;
  /** True if the asset was already registered (idempotent replay). */
  replayed: boolean;
}

/**
 * Map AssetKind to GenerationModality for the generation_jobs record.
 */
function kindToModality(kind: AssetKind): GenerationModality | null {
  switch (kind) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "music":
      return "music";
    case "audio":
      return "speech";
    default:
      return null; // design, code, game — not generation modalities
  }
}

/**
 * Register a creator output as an asset in the Asset Lake.
 *
 * This creates a generation_jobs record with the asset URL and metadata,
 * making it visible to the READ adapter. If a job with the same
 * requestId already exists, it returns the existing asset (idempotent).
 *
 * For kinds that are not generation modalities (design, code, game),
 * this returns an error — those require different persistence.
 */
export async function registerStudioAsset(
  input: RegisterAssetInput,
  clerkId: string,
): Promise<RegisterAssetResult> {
  if (!clerkId) {
    return { asset: null, error: "Authentication required.", replayed: false };
  }

  if (!supabaseAdmin) {
    return { asset: null, error: "Database is not configured.", replayed: false };
  }

  if (!input.url) {
    return { asset: null, error: "Asset URL is required.", replayed: false };
  }

  const modality = kindToModality(input.kind);
  if (!modality) {
    return {
      asset: null,
      error: `Asset kind '${input.kind}' is not a generation modality. Use a different persistence strategy.`,
      replayed: false,
    };
  }

  // Resolve Clerk ID → internal user UUID.
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (!user?.id) {
    return { asset: null, error: "User not found.", replayed: false };
  }

  // Verify project access if projectId is provided.
  if (input.projectId) {
    const hasAccess = await verifyProjectAccess(input.projectId, clerkId);
    if (!hasAccess) {
      return { asset: null, error: "Project not found or access denied.", replayed: false };
    }
  }

  // Build metadata for the generation_jobs record.
  const metadata: Record<string, unknown> = {
    durableUrl: input.url,
    ...(input.thumbnailUrl && { thumbUrl: input.thumbnailUrl }),
    ...(input.mimeType && { contentType: input.mimeType }),
    ...(input.width && { width: input.width }),
    ...(input.height && { height: input.height }),
    ...(input.durationSeconds && { durationSeconds: input.durationSeconds }),
    ...(input.projectId && { projectId: input.projectId }),
    ...input.metadata,
  };

  // Generate IDs.
  const jobId = crypto.randomUUID();
  const requestId = input.requestId ?? `reg-${jobId}`;

  // Create the generation_jobs record.
  const job = await createGenerationJob({
    id: jobId,
    userId: user.id,
    modality,
    provider: input.provider ?? "unknown",
    model: input.model ?? "unknown",
    prompt: input.prompt ?? "",
    requestId,
    littBitsCharged: input.costCredits ?? 0,
    metadata,
  });

  if (!job) {
    return { asset: null, error: "Failed to create asset record.", replayed: false };
  }

  // Check if this was a replay (idempotent).
  const replayed = job.id !== jobId;

  // Mark the job as completed immediately — the asset URL is already
  // in metadata, so the READ adapter can pick it up.
  const { updateGenerationJobStatus } = await import("@/lib/generation/jobs");
  await updateGenerationJobStatus(job.id, "completed", {
    assetId: buildCanonicalId("generation_job", job.id),
  });

  // Fetch the updated job to get the completed state.
  const { getGenerationJob } = await import("@/lib/generation/jobs");
  const completedJob = await getGenerationJob(job.id);

  if (!completedJob) {
    return { asset: null, error: "Failed to retrieve completed asset.", replayed: replayed };
  }

  const asset = generationJobToStudioAsset(completedJob as GenerationJob);
  if (!asset) {
    return { asset: null, error: "Asset normalization failed.", replayed };
  }

  return { asset, error: null, replayed };
}

/**
 * Verify project access via the canonical getProject ownership check.
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
