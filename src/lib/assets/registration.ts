/**
 * Asset Lake — asset registration (write seam).
 *
 * This is the minimum WRITE/REGISTRATION seam needed so creator
 * outputs can reliably enter Asset Lake when they are NOT already
 * in a source the Asset Lake can read.
 *
 * Strategy:
 * - For outputs already saved to generation_jobs (Image): no write
 *   needed — the READ adapter picks them up.
 * - For outputs already in music_tracks (Music): no write needed.
 * - For outputs that are browser-only or in a non-canonical source
 *   (Video/Audio with a durable URL): this registration layer creates
 *   a generation_jobs record with the durable URL and metadata.
 *
 * Truthfulness rules (Phase E.1):
 * - provider, model, and prompt are REQUIRED — no fabrication.
 *   generation_jobs requires these as NOT NULL columns. If the caller
 *   does not have real values, the registration fails truthfully.
 * - costCredits defaults to 0 (truthful — no credits charged for
 *   this registration path).
 * - URL must be a durable HTTP(S) URL — blob: and data: are rejected.
 * - Reserved metadata keys are protected from client override.
 * - Idempotent replay returns the existing asset unchanged without
 *   mutating the existing job's lifecycle.
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
import { createGenerationJob, getGenerationJobByRequestId } from "@/lib/generation/jobs";
import type { GenerationModality } from "@/lib/generation/types";
import type { AssetKind, StudioAsset } from "./types";
import { buildCanonicalId } from "./ids";
import { generationJobToStudioAsset } from "./adapters/generation-job";
import type { GenerationJob } from "@/lib/generation/types";

/**
 * Asset kinds that can be registered via the POST /api/assets seam.
 *
 * Only kinds that map to a GenerationModality are registerable.
 * design, code, and game are NOT registerable — they require a
 * different persistence strategy and must not be advertised as
 * valid POST registration kinds.
 */
export type RegisterableAssetKind = "image" | "video" | "music" | "audio";

const REGISTERABLE_KINDS: readonly RegisterableAssetKind[] = [
  "image",
  "video",
  "music",
  "audio",
];

export function isRegisterableAssetKind(kind: string): kind is RegisterableAssetKind {
  return (REGISTERABLE_KINDS as readonly string[]).includes(kind);
}

/**
 * Reserved metadata keys that the server controls.
 * Client-supplied metadata must not override these.
 */
const RESERVED_METADATA_KEYS = [
  "durableUrl",
  "projectId",
  "width",
  "height",
  "durationSeconds",
  "contentType",
  "thumbUrl",
] as const;

export interface RegisterAssetInput {
  /** The kind of asset being registered. Must be a RegisterableAssetKind. */
  kind: RegisterableAssetKind;
  /** Durable HTTP(S) URL of the asset (R2, Supabase Storage, etc.). */
  url: string;
  /** Optional thumbnail URL. */
  thumbnailUrl?: string;
  /** MIME type of the asset. */
  mimeType?: string;
  /** Generation provider (e.g., "fal", "veo", "gemini"). REQUIRED — no fabrication. */
  provider: string;
  /** Model used for generation. REQUIRED — no fabrication. */
  model: string;
  /** Prompt used for generation. REQUIRED — no fabrication. */
  prompt: string;
  /** Image/video width. */
  width?: number;
  /** Image/video height. */
  height?: number;
  /** Audio/video duration in seconds. */
  durationSeconds?: number;
  /** Cost in LiTTBits. Defaults to 0 (truthful — no charge for this path). */
  costCredits?: number;
  /** Project to associate with (optional, verified). */
  projectId?: string;
  /** Additional metadata. Reserved keys are protected from override. */
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
 * Map RegisterableAssetKind to GenerationModality for the generation_jobs record.
 */
function kindToModality(kind: RegisterableAssetKind): GenerationModality {
  switch (kind) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "music":
      return "music";
    case "audio":
      return "speech";
  }
}

/**
 * Validate that a URL is a durable HTTP(S) URL.
 * Rejects blob:, data:, and other non-durable schemes.
 */
function isDurableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Sanitize client-supplied metadata by removing reserved keys.
 * This prevents client metadata from overriding authoritative server values.
 */
function sanitizeClientMetadata(
  clientMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!clientMetadata) return {};
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(clientMetadata)) {
    if (!(RESERVED_METADATA_KEYS as readonly string[]).includes(key)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Register a creator output as an asset in the Asset Lake.
 *
 * This creates a generation_jobs record with the asset URL and metadata,
 * making it visible to the READ adapter.
 *
 * Idempotency:
 * - If requestId matches an existing job, the existing asset is returned
 *   unchanged. The existing job's lifecycle is NOT mutated — we do not
 *   rewrite status, provider, model, prompt, or URL.
 * - If the existing job is not completed, we return it as-is (the caller
 *   can poll or check status). We do NOT force it to completed.
 *
 * Required fields (no fabrication):
 * - provider, model, prompt must be real values from the caller.
 * - url must be a durable HTTP(S) URL.
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

  if (!isDurableUrl(input.url)) {
    return {
      asset: null,
      error: "Asset URL must be a durable HTTP(S) URL. blob: and data: URLs are not accepted.",
      replayed: false,
    };
  }

  // Required provenance — no fabrication.
  if (!input.provider) {
    return { asset: null, error: "Provider is required — no fabricated provenance.", replayed: false };
  }
  if (!input.model) {
    return { asset: null, error: "Model is required — no fabricated provenance.", replayed: false };
  }
  if (!input.prompt) {
    return { asset: null, error: "Prompt is required — no fabricated provenance.", replayed: false };
  }

  const modality = kindToModality(input.kind);

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

  // Generate IDs.
  const jobId = crypto.randomUUID();
  const requestId = input.requestId ?? `reg-${jobId}`;

  // Check for existing job with same requestId (idempotency).
  const existingJob = await getGenerationJobByRequestId(user.id, requestId);
  if (existingJob) {
    // Idempotent replay — return existing asset WITHOUT mutating the job.
    // Do NOT rewrite status, provider, model, prompt, or URL.
    const existingAsset = generationJobToStudioAsset(existingJob);
    if (existingAsset) {
      return { asset: existingAsset, error: null, replayed: true };
    }
    // Existing job exists but is not yet a usable asset (not completed or no URL).
    // Return it truthfully without mutating its lifecycle.
    return {
      asset: null,
      error: "Existing registration found but asset is not yet available (job not completed or no URL).",
      replayed: true,
    };
  }

  // Build metadata: client metadata FIRST, then authoritative fields LAST
  // to prevent client override of reserved keys.
  const clientMetadata = sanitizeClientMetadata(input.metadata);
  const metadata: Record<string, unknown> = {
    ...clientMetadata,
    durableUrl: input.url,
    ...(input.thumbnailUrl && { thumbUrl: input.thumbnailUrl }),
    ...(input.mimeType && { contentType: input.mimeType }),
    ...(input.width && { width: input.width }),
    ...(input.height && { height: input.height }),
    ...(input.durationSeconds && { durationSeconds: input.durationSeconds }),
    ...(input.projectId && { projectId: input.projectId }),
  };

  // Create the generation_jobs record with real provenance.
  const job = await createGenerationJob({
    id: jobId,
    userId: user.id,
    modality,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    requestId,
    littBitsCharged: input.costCredits ?? 0,
    metadata,
  });

  if (!job) {
    return { asset: null, error: "Failed to create asset record.", replayed: false };
  }

  // Check if createGenerationJob returned an existing job (ON CONFLICT).
  const replayed = job.id !== jobId;
  if (replayed) {
    // The job already existed — return it without mutating.
    const existingAsset = generationJobToStudioAsset(job);
    if (existingAsset) {
      return { asset: existingAsset, error: null, replayed: true };
    }
    return {
      asset: null,
      error: "Existing registration found but asset is not yet available.",
      replayed: true,
    };
  }

  // Mark the NEW job as completed — the asset URL is already in metadata,
  // so the READ adapter can pick it up. This is safe because we just
  // created this job — we are not mutating an existing generation attempt.
  const { updateGenerationJobStatus } = await import("@/lib/generation/jobs");
  await updateGenerationJobStatus(job.id, "completed", {
    assetId: buildCanonicalId("generation_job", job.id),
  });

  // Fetch the updated job to get the completed state.
  const { getGenerationJob } = await import("@/lib/generation/jobs");
  const completedJob = await getGenerationJob(job.id);

  if (!completedJob) {
    return { asset: null, error: "Failed to retrieve completed asset.", replayed: false };
  }

  const asset = generationJobToStudioAsset(completedJob as GenerationJob);
  if (!asset) {
    return { asset: null, error: "Asset normalization failed.", replayed: false };
  }

  return { asset, error: null, replayed: false };
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
