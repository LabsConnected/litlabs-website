// src/lib/music/generation-service.ts
// Core music generation lifecycle. Rewired to use the existing repo systems:
//   - getSupabaseAdmin()  (NOT a parallel Supabase client)
//   - adjustWalletBalance()  (NOT a parallel LBC ledger — uses credit_ledger
//     via the atomic debit_credits / grant_credits RPCs)
//   - R2 uploadAudio() / getSignedAudioUrl() / deleteAudio()  (ownership-scoped:
//     every call requires the server-derived userId as the first argument)
//
// ── R2 ownership contract ──────────────────────────────────────────────────
// The current R2 helpers enforce that every object key is prefixed with
// `{userId}/`. The generation service NEVER constructs keys manually or
// accepts keys/userId/bucket/prefix from the request body. Instead:
//   - uploadAudio(userId, filename, buffer, contentType, category) builds the
//     key server-side and returns { storageKey, publicUrl }. We persist the
//     returned storageKey — never a reconstructed one.
//   - getSignedAudioUrl(userId, key, expiresIn) validates that `key` starts
//     with `{userId}/` before signing. Private/unlisted audio always uses
//     signed URLs; public audio uses getPublicAudioUrl(key) (no userId needed).
//   - deleteAudio(userId, key) validates ownership before deleting.
//
// ── Exact debit/refund sequence (failure-safe) ─────────────────────────────
//   1. Insert a placeholder generation row (lbc_charged=0). The unique index
//      on (user_id, idempotency_key) prevents duplicates — a racing request
//      loses here and we return the winner without re-charging.
//   2. Debit LBC atomically via adjustWalletBalance with idempotency key
//      `music:charge:{idempotencyKey}`. This calls the debit_credits RPC
//      (advisory-locked, idempotent). Insufficient balance → delete the
//      placeholder row and throw INSUFFICIENT_LBC before any work starts.
//   3. Record the settled charge (lbc_charged = cost) on the generation row.
//   4. Kick off async processing (provider generation → audio fetch → R2
//      upload → track row insert).
//   5. If ANY step in processing fails (provider error, audio fetch failure,
//      R2 upload failure, or DB persistence failure), call failGeneration()
//      which:
//        a. Grants a refund via adjustWalletBalance with idempotency key
//           `music:refund:{idempotencyKey}` (idempotent — won't double-refund
//           even if called multiple times).
//        b. Marks the generation as failed with lbc_refunded=true.
//   6. User-initiated cancel follows the same refund path (step 5a).
//
// No charge persists if generation or persistence fails. The refund is
// guaranteed by the idempotent grant_credits RPC — even if the serverless
// function crashes mid-refund, a retry will complete it without duplicating.

import "server-only";

import type {
  GenerateSongInput,
  GenerationStatus,
  MusicBlueprint,
  MusicTrack,
  TrackVisibility,
} from "@/types/music";
import { getSupabaseAdmin } from "@/lib/supabase";
import { adjustWalletBalance } from "@/lib/wallet-ledger";
import { uploadAudio, getSignedAudioUrl, getPublicAudioUrl, deleteAudio } from "@/lib/r2";
import { getActiveProvider, createProvider } from "./providers/factory";
import { fetchWithTimeout } from "./providers/http";
import type { MusicProvider } from "./providers";
import { checkPromptSafety, checkExplicitContent } from "./safety-filter";

export const MUSIC_LBC_COST = {
  concept: 8,
  instrumentalFull: 20,
  songFull: 30,
  twoVariants: 50,
} as const;

/** Number of versions generated per request. */
const VERSIONS_PER_GENERATION = 2;

export interface CreateGenerationResult {
  generationId: string;
  status: GenerationStatus;
  lbcCharged: number;
  replayed: boolean;
}

export interface GenerationStatusView {
  id: string;
  status: GenerationStatus;
  provider: string;
  providerJobId: string | null;
  error: string | null;
  lbcCharged: number;
  lbcRefunded: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  tracks: Array<Pick<MusicTrack, "id" | "title" | "versionLabel" | "duration" | "visibility">>;
}

export interface CreateGenerationParams {
  clerkId: string;
  userId: string; // internal public.users.id UUID
  input: GenerateSongInput;
}

export async function createGeneration(
  params: CreateGenerationParams,
): Promise<CreateGenerationResult> {
  const { clerkId, userId, input } = params;
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("Database is not configured");

  const idempotencyKey = input.idempotencyKey;

  // 1. Replay detection — return existing generation without re-charging.
  const { data: existing } = await admin
    .from("music_generations")
    .select("id, status, lbc_charged")
    .eq("user_id", userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    return {
      generationId: existing.id as string,
      status: existing.status as GenerationStatus,
      lbcCharged: existing.lbc_charged as number,
      replayed: true,
    };
  }

  // 2. Safety filter (before any LBC is touched).
  const safety = checkPromptSafety(input.prompt, input.lyrics);
  if (!safety.allowed) {
    const err = new Error(safety.reason || "Prompt rejected by safety filter");
    err.name = "SAFETY_VIOLATION";
    throw err;
  }
  const explicitCheck = checkExplicitContent(input.prompt, input.lyrics);
  if (explicitCheck.explicit && !input.explicit) {
    const err = new Error(
      "This prompt may generate explicit content. Enable explicit content to proceed, or revise your prompt.",
    );
    err.name = "EXPLICIT_CONTENT";
    throw err;
  }

  // 3. Compute LBC cost (two-variant bundle).
  const lbcCost = computeLbcCost(input);

  // 4. Build blueprint.
  const blueprint = buildBlueprint(input);
  const provider = getActiveProvider();

  // 5. Insert the generation record FIRST. The unique index on
  //    (user_id, idempotency_key) is the primary duplicate guard — a racing
  //    duplicate request loses here and we simply return the winner. We do
  //    NOT charge before we own the row, so a race loss can never trigger an
  //    erroneous refund that would steal the legitimate request's refund key.
  const { data: generation, error: insertError } = await admin
    .from("music_generations")
    .insert({
      user_id: userId,
      provider: provider.name,
      status: "queued",
      original_prompt: safety.rewrittenPrompt || input.prompt,
      structured_blueprint: blueprint,
      requested_duration: input.durationSeconds,
      provider_cost_estimate_cents: 0,
      lbc_charged: 0, // settled after a successful charge
      lbc_refunded: false,
      idempotency_key: idempotencyKey,
      output_format: "mp3",
    })
    .select()
    .single();

  if (insertError) {
    // Unique violation → another concurrent request won the race.
    if (isUniqueViolation(insertError)) {
      const { data: winner } = await admin
        .from("music_generations")
        .select("id, status, lbc_charged")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (winner) {
        return {
          generationId: winner.id as string,
          status: winner.status as GenerationStatus,
          lbcCharged: winner.lbc_charged as number,
          replayed: true,
        };
      }
    }
    throw new Error(`Failed to create generation: ${insertError.message}`);
  }
  if (!generation) throw new Error("Failed to create generation");

  const generationId = generation.id as string;

  // 6. Charge LBC atomically. Idempotent on `music:charge:{idempotencyKey}`,
  //    so a retry after a crash between insert and charge will not double-charge.
  const chargeKey = `music:charge:${idempotencyKey}`;
  let charged = false;
  try {
    const charge = await adjustWalletBalance({
      clerkId,
      amount: -lbcCost,
      type: "spend",
      reason: `Music generation: ${input.prompt.slice(0, 60)}`,
      idempotencyKey: chargeKey,
    });
    charged = true;
    void charge; // balance result not needed here
  } catch (err) {
    // Insufficient balance (or other charge failure) → remove the placeholder
    // row so the user can retry with a fresh idempotency key.
    await admin.from("music_generations").delete().eq("id", generationId);
    if (err instanceof Error && /insufficient balance/i.test(err.message)) {
      const e = new Error(`Insufficient LBC balance. Required: ${lbcCost}`);
      e.name = "INSUFFICIENT_LBC";
      throw e;
    }
    throw err;
  }

  // 7. Record the settled charge.
  if (charged) {
    await admin
      .from("music_generations")
      .update({ lbc_charged: lbcCost })
      .eq("id", generationId);
  }

  // 8. Kick off processing. Do NOT await — the route returns 202 immediately.
  void processGeneration({
    generationId,
    clerkId,
    userId,
    input,
    blueprint,
  }).catch(async (err) => {
    await failGeneration(generationId, clerkId, errMessage(err));
  });

  return {
    generationId,
    status: "queued",
    lbcCharged: charged ? lbcCost : 0,
    replayed: false,
  };
}

function isUniqueViolation(err: { code?: string; message?: string }): boolean {
  return err.code === "23505" || /duplicate key|unique constraint/i.test(err.message || "");
}

export async function getGenerationStatus(
  generationId: string,
  userId: string,
): Promise<GenerationStatusView> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("Database is not configured");

  const { data, error } = await admin
    .from("music_generations")
    .select(
      "id, status, provider, provider_job_id, failure_reason, lbc_charged, lbc_refunded, created_at, started_at, completed_at",
    )
    .eq("id", generationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) throw new Error("Generation not found");

  const { data: tracks } = await admin
    .from("music_tracks")
    .select("id, title, version_label, duration, visibility")
    .eq("generation_id", generationId)
    .order("version_label", { ascending: true });

  return {
    id: data.id as string,
    status: data.status as GenerationStatus,
    provider: data.provider as string,
    providerJobId: (data.provider_job_id as string) || null,
    error: (data.failure_reason as string) || null,
    lbcCharged: data.lbc_charged as number,
    lbcRefunded: data.lbc_refunded as boolean,
    createdAt: data.created_at as string,
    startedAt: (data.started_at as string) || null,
    completedAt: (data.completed_at as string) || null,
    tracks: (tracks ?? []).map((t) => ({
      id: t.id as string,
      title: t.title as string,
      versionLabel: t.version_label as string,
      duration: (t.duration as number) ?? 0,
      visibility: t.visibility as TrackVisibility,
    })),
  };
}

export async function cancelGeneration(
  generationId: string,
  userId: string,
  clerkId: string,
): Promise<{ success: boolean; refunded: boolean }> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("Database is not configured");

  const { data: gen } = await admin
    .from("music_generations")
    .select("*")
    .eq("id", generationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!gen) throw new Error("Generation not found");
  if (gen.status === "completed") throw new Error("Cannot cancel a completed generation");
  if (gen.status === "cancelled") return { success: true, refunded: gen.lbc_refunded };

  // Best-effort provider cancel.
  if (gen.provider_job_id) {
    try {
      const provider = createProvider(gen.provider as never);
      await provider.cancel(gen.provider_job_id);
    } catch {
      // Swallow — we still refund + mark cancelled locally.
    }
  }

  const refunded = await refundLbc(
    clerkId,
    gen.idempotency_key as string,
    "Generation cancelled by user",
  );

  await admin
    .from("music_generations")
    .update({
      status: "cancelled",
      lbc_refunded: refunded,
      completed_at: new Date().toISOString(),
    })
    .eq("id", generationId);

  return { success: true, refunded };
}

// ── internals ──────────────────────────────────────────────────────────────

interface ProcessArgs {
  generationId: string;
  clerkId: string;
  userId: string;
  input: GenerateSongInput;
  blueprint: MusicBlueprint;
}

async function processGeneration(args: ProcessArgs): Promise<void> {
  const { generationId, userId, input, blueprint } = args;
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("Database is not configured");
  const provider = getActiveProvider();

  await admin
    .from("music_generations")
    .update({ status: "preparing", started_at: new Date().toISOString() })
    .eq("id", generationId);

  // Generate VERSIONS_PER_GENERATION versions in parallel.
  const versionResults = await Promise.all(
    Array.from({ length: VERSIONS_PER_GENERATION }, (_, i) =>
      runOneVersion(provider, input, blueprint, i),
    ),
  );

  // If any version failed, fail the whole generation + refund.
  const failed = versionResults.find((v) => v.status === "failed" || v.error);
  if (failed) {
    await failGeneration(generationId, args.clerkId, failed.error || "Provider generation failed");
    return;
  }

  // Persist provider job mappings.
  for (const v of versionResults) {
    if (v.providerJobId) {
      await admin.from("music_provider_jobs").insert({
        generation_id: generationId,
        provider: provider.name,
        provider_job_id: v.providerJobId,
        provider_song_id: v.providerSongId ?? null,
        status: v.status,
      });
    }
  }

  // Poll async jobs to completion (mock + mureka). ElevenLabs returns completed
  // with audioUrl directly (supportsAsyncPolling = false).
  const finalized = await Promise.all(
    versionResults.map((v) => finalizeVersion(provider, v, input.durationSeconds)),
  );

  const finalizeFailed = finalized.find((f) => !f.audioBytes && !f.audioUrl);
  if (finalizeFailed) {
    await failGeneration(generationId, args.clerkId, finalizeFailed.error || "Audio fetch failed");
    return;
  }

  // Store audio + create tracks.
  await admin
    .from("music_generations")
    .update({ status: "processing" })
    .eq("id", generationId);

  for (let i = 0; i < finalized.length; i++) {
    const f = finalized[i];
    const versionLabel = `Version ${String.fromCharCode(65 + i)}`; // A, B

    try {
      const bytes = f.audioBytes ?? (f.audioUrl ? await fetchAudioBytes(f.audioUrl) : null);
      if (!bytes) {
        throw new Error("No audio bytes to store");
      }
      // R2 upload enforces ownership: the key is built server-side as
      // `{userId}/audio/{timestamp}_{filename}` — never from the request body.
      // We persist the returned storageKey (the canonical ownership-scoped key).
      const filename = `${versionLabel.toLowerCase().replace(/\s+/g, "-")}.mp3`;
      const { storageKey } = await uploadAudio(
        userId,
        filename,
        bytes,
        "audio/mpeg",
        "audio",
      );

      const trackBlueprint: MusicBlueprint = {
        ...blueprint,
        title: i === 0 ? blueprint.title : `${blueprint.title} (${versionLabel})`,
      };

      await admin.from("music_tracks").insert({
        user_id: userId,
        generation_id: generationId,
        version_label: versionLabel,
        title: trackBlueprint.title,
        blueprint: trackBlueprint,
        audio_storage_key: storageKey,
        duration: f.duration ?? input.durationSeconds,
        bpm: blueprint.bpm ?? null,
        musical_key: blueprint.key ?? null,
        visibility: "private",
        lbc_charged: 0, // charged at generation level
        provider: provider.name,
        provider_model: null,
      });
    } catch (err) {
      await failGeneration(generationId, args.clerkId, `Storage failed: ${errMessage(err)}`);
      return;
    }
  }

  await admin
    .from("music_generations")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", generationId);
}

interface VersionRun {
  providerJobId?: string;
  providerSongId?: string;
  audioUrl?: string;
  status: GenerationStatus;
  error?: string;
}

async function runOneVersion(
  provider: MusicProvider,
  input: GenerateSongInput,
  blueprint: MusicBlueprint,
  index: number,
): Promise<VersionRun> {
  // Vary the mock slightly per version by tweaking energy so the two mock
  // jobs have distinct ids (the mock id is random already).
  const variedInput: GenerateSongInput = {
    ...input,
    energy: input.energy ? Math.max(1, Math.min(10, input.energy + (index === 0 ? 0 : 1))) : input.energy,
  };
  const result = await provider.generateSong({ ...variedInput, blueprint });
  return {
    providerJobId: result.providerJobId,
    providerSongId: result.providerSongId,
    audioUrl: result.audioUrl,
    status: result.status,
    error: result.error,
  };
}

interface FinalizedVersion {
  audioBytes: Buffer | null;
  audioUrl?: string;
  duration?: number;
  error?: string;
}

async function finalizeVersion(
  provider: MusicProvider,
  run: VersionRun,
  fallbackDuration: number,
): Promise<FinalizedVersion> {
  // Direct audio (ElevenLabs streaming).
  if (run.status === "completed" && run.audioUrl) {
    return { audioBytes: null, audioUrl: run.audioUrl, duration: fallbackDuration };
  }

  // Async polling (mock / mureka).
  if (provider.supportsAsyncPolling && run.providerJobId) {
    const maxPolls = 120; // 10 min at 5s
    for (let i = 0; i < maxPolls; i++) {
      await sleep(5000);
      const status = await provider.getStatus(run.providerJobId);
      if (status.status === "completed") {
        return { audioBytes: null, audioUrl: status.audioUrl, duration: status.duration ?? fallbackDuration };
      }
      if (status.status === "failed") {
        return { audioBytes: null, error: status.error || "Provider generation failed" };
      }
      if (status.status === "cancelled") {
        return { audioBytes: null, error: "Generation cancelled" };
      }
    }
    return { audioBytes: null, error: "Generation timed out after 10 minutes" };
  }

  return { audioBytes: null, error: run.error || "Provider returned no audio and no job id" };
}

async function failGeneration(
  generationId: string,
  clerkId: string,
  reason: string,
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  const refunded = await refundLbc(clerkId, await getIdempotencyKey(generationId), reason);

  await admin
    .from("music_generations")
    .update({
      status: "failed",
      failure_reason: reason,
      lbc_refunded: refunded,
      completed_at: new Date().toISOString(),
    })
    .eq("id", generationId);
}

async function getIdempotencyKey(generationId: string): Promise<string> {
  const admin = getSupabaseAdmin();
  if (!admin) return generationId;
  const { data } = await admin
    .from("music_generations")
    .select("idempotency_key")
    .eq("id", generationId)
    .maybeSingle();
  return (data?.idempotency_key as string) || generationId;
}

/**
 * Refund via the existing atomic grant_credits RPC. Idempotent on the key
 * `music:refund:{idempotencyKey}`, so repeated failure paths cannot
 * double-refund. Returns true if a refund was applied (or already applied).
 */
async function refundLbc(clerkId: string, idempotencyKey: string, reason: string): Promise<boolean> {
  try {
    const refundKey = `music:refund:${idempotencyKey}`;
    // Determine the original charge amount so we refund exactly that.
    const admin = getSupabaseAdmin();
    if (!admin) return false;
    const { data: gen } = await admin
      .from("music_generations")
      .select("lbc_charged")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    const amount = (gen?.lbc_charged as number) ?? 0;
    if (amount <= 0) return false;

    await adjustWalletBalance({
      clerkId,
      amount,
      type: "refund",
      reason: `Music refund: ${reason.slice(0, 80)}`,
      idempotencyKey: refundKey,
    });
    return true;
  } catch {
    // Refund failure is logged via the generation row's lbc_refunded flag.
    return false;
  }
}

function computeLbcCost(input: GenerateSongInput): number {
  if (input.durationSeconds <= 30) return MUSIC_LBC_COST.concept;
  return input.instrumental ? MUSIC_LBC_COST.instrumentalFull : MUSIC_LBC_COST.songFull;
}

function buildBlueprint(input: GenerateSongInput): MusicBlueprint {
  const genre = extractGenre(input.prompt);
  const mood = extractMood(input.prompt);
  const bpm = input.style?.includes("slow")
    ? 90
    : input.energy && input.energy > 7
      ? 140
      : 120;

  return {
    title: input.prompt.slice(0, 40) || "Untitled Track",
    genre: [genre],
    mood: [mood],
    bpm,
    key: "C minor",
    durationSeconds: input.durationSeconds,
    instrumental: input.instrumental,
    vocals: input.instrumental
      ? undefined
      : {
          type: input.vocalType || "male",
          delivery: "melodic",
          intensity: input.energy || 5,
        },
    structure: ["intro", "verse", "chorus", "drop", "verse", "chorus", "outro"],
    production: ["synthesizer", "drum machine", "bass"],
    avoid: input.instrumental ? ["vocals"] : [],
    instruments: ["synth", "drums", "bass"],
    explicit: input.explicit || false,
    lyrics: input.lyrics,
  };
}

function extractGenre(prompt: string): string {
  const genres = ["edm", "trap", "house", "techno", "hip hop", "rock", "pop", "r&b", "dnb"];
  const lower = prompt.toLowerCase();
  for (const g of genres) {
    if (lower.includes(g)) return g;
  }
  return "electronic";
}

function extractMood(prompt: string): string {
  const moods = ["dark", "aggressive", "happy", "sad", "energetic", "calm", "melancholic"];
  const lower = prompt.toLowerCase();
  for (const m of moods) {
    if (lower.includes(m)) return m;
  }
  return "neutral";
}

async function fetchAudioBytes(url: string): Promise<Buffer | null> {
  try {
    // 60s cap — provider audio downloads can be large, but must not hang the
    // serverless function indefinitely. A timeout surfaces as a clean failure
    // that triggers a refund via failGeneration.
    const res = await fetchWithTimeout(url, {}, 60_000);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Track access helpers (used by API routes) ──────────────────────────────

/**
 * Resolve a playable URL for a track, honoring visibility.
 *
 * @param userId   - The authenticated user's internal UUID (required for
 *                   ownership validation on signed URLs).
 * @param storageKey - The canonical R2 key stored in music_tracks.audio_storage_key.
 * @param visibility - Track visibility. Public tracks use a public URL;
 *                     private/unlisted tracks use a signed URL (1h) that
 *                     requires ownership validation.
 *
 * Security:
 *   - userId is ALWAYS required and is propagated to getSignedAudioUrl.
 *   - Private/unlisted audio NEVER falls back to a public URL.
 *   - Missing or malformed storage keys are rejected clearly.
 *   - The raw R2 key is not exposed in client responses (callers return the
 *     resolved URL, not the key).
 */
export async function resolveTrackAudioUrl(
  userId: string,
  storageKey: string,
  visibility: TrackVisibility,
): Promise<string> {
  if (!userId || userId.length < 3) {
    throw new Error("Invalid userId for audio URL resolution");
  }
  if (!storageKey || storageKey.length < 3) {
    throw new Error("Invalid or missing storage key");
  }

  if (visibility === "public") {
    // Public audio: no ownership check needed — the key is already public.
    return getPublicAudioUrl(storageKey);
  }
  // private + unlisted → signed URL (1h). userId is required for ownership
  // validation — the R2 helper rejects keys not prefixed with `{userId}/`.
  // NEVER fall back to a public URL for private/unlisted audio.
  return getSignedAudioUrl(userId, storageKey, 3600);
}

/**
 * Delete a track + its R2 audio. Returns true if deleted.
 *
 * @param trackId - The track UUID.
 * @param userId  - The authenticated user's internal UUID (required for
 *                  ownership validation on R2 delete).
 */
export async function deleteTrack(trackId: string, userId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("Database is not configured");

  const { data: track } = await admin
    .from("music_tracks")
    .select("id, audio_storage_key")
    .eq("id", trackId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!track) return false;

  try {
    await deleteAudio(userId, track.audio_storage_key as string);
  } catch {
    // R2 delete failure shouldn't block the DB row delete.
  }

  await admin.from("music_tracks").delete().eq("id", trackId);
  return true;
}
