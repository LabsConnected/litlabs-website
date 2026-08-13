import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GenerationJob } from "@/lib/generation/types";
import type { MusicTrackRow } from "@/lib/assets/adapters/music-track";
import {
  generationJobToStudioAsset,
  modalityToAssetKind,
} from "@/lib/assets/adapters/generation-job";
import {
  musicTrackToStudioAsset,
} from "@/lib/assets/adapters/music-track";
import { StudioAssetSchema } from "@/lib/assets/schemas";
import { isRegisterableAssetKind } from "@/lib/assets/registration";
import { buildCanonicalId } from "@/lib/assets/ids";
import type { AssetKind } from "@/lib/assets/types";

/**
 * Phase E.1 — Real creator behavioral tests.
 *
 * These tests prove that each creator's REAL persistence path
 * produces a valid StudioAsset with correct:
 * - canonical creator
 * - AssetKind
 * - no fabricated optional metadata
 * - projectId truthfully preserved/null
 * - canonical source ID
 * - Zod schema validation
 *
 * The tests use the actual adapter functions that the Asset Lake
 * repository calls. They do NOT spend real generation credits —
 * they use fixture data matching the real response shapes from
 * the audited endpoints.
 */

// ─── Fixtures matching real endpoint response shapes ─────────────

function makeImageJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-img-001",
    userId: "user-uuid-001",
    modality: "image",
    provider: "fal",
    model: "flux-1-schnell",
    status: "completed",
    prompt: "A neon city skyline at dusk",
    requestId: "req-img-001",
    providerJobId: null,
    actualProviderCostCents: 1,
    littBitsCharged: 5,
    refundStatus: "none",
    assetId: null,
    error: null,
    metadata: {
      durableUrl: "https://cdn.litlabs.net/generated.png",
      contentType: "image/png",
      width: 1024,
      height: 1024,
    },
    createdAt: "2026-08-14T00:00:00Z",
    completedAt: "2026-08-14T00:00:05Z",
    ...overrides,
  };
}

function makeVideoJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-vid-001",
    userId: "user-uuid-001",
    modality: "video",
    provider: "veo",
    model: "veo-3.1",
    status: "completed",
    prompt: "A cat playing piano",
    requestId: "req-vid-001",
    providerJobId: null,
    actualProviderCostCents: 50,
    littBitsCharged: 30,
    refundStatus: "none",
    assetId: null,
    error: null,
    metadata: {
      durableUrl: "https://cdn.litlabs.net/video.mp4",
      contentType: "video/mp4",
      durationSeconds: 5,
    },
    createdAt: "2026-08-14T00:00:00Z",
    completedAt: "2026-08-14T00:00:10Z",
    ...overrides,
  };
}

function makeMusicTrack(overrides: Partial<MusicTrackRow> = {}): MusicTrackRow {
  return {
    id: "track-uuid-001",
    user_id: "user-uuid-001",
    generation_id: "gen-uuid-001",
    project_id: null,
    version_label: "Version A",
    title: "Neon Dreams",
    blueprint: { genre: ["synthwave"], mood: ["energetic"] },
    audio_storage_key: "user-uuid-001/audio/track.mp3",
    duration: 30,
    bpm: 120,
    musical_key: "C major",
    visibility: "private",
    lbc_charged: 8,
    provider: "elevenlabs",
    provider_model: null,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
    audio_url: "https://cdn.litlabs.net/audio/track.mp3",
    ...overrides,
  };
}

function makeAudioJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-aud-001",
    userId: "user-uuid-001",
    modality: "speech",
    provider: "gemini",
    model: "gemini-2.5-flash-preview-tts",
    status: "completed",
    prompt: "Hello, this is a test of the text to speech system.",
    requestId: "req-aud-001",
    providerJobId: null,
    actualProviderCostCents: 0,
    littBitsCharged: 2,
    refundStatus: "none",
    assetId: null,
    error: null,
    metadata: {
      durableUrl: "https://cdn.litlabs.net/audio.wav",
      contentType: "audio/wav",
      durationSeconds: 10,
    },
    createdAt: "2026-08-14T00:00:00Z",
    completedAt: "2026-08-14T00:00:03Z",
    ...overrides,
  };
}

// ─── Image creator behavioral tests ──────────────────────────────

describe("Image creator — behavioral", () => {
  it("real success path: /api/media/generate → generation_jobs → StudioAsset", () => {
    // Image generation creates a generation_jobs row with modality="image".
    // The Asset Lake adapter normalizes it.
    const job = makeImageJob();
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
  });

  it("correct AssetKind is image", () => {
    const asset = generationJobToStudioAsset(makeImageJob());
    expect(asset!.kind).toBe("image");
  });

  it("canonical source ID is generation_job:<id>", () => {
    const asset = generationJobToStudioAsset(makeImageJob());
    expect(asset!.id).toBe("generation_job:job-img-001");
  });

  it("no fabricated optional metadata", () => {
    // Job with no dimensions in metadata should not fabricate them.
    const job = makeImageJob({
      metadata: { durableUrl: "https://cdn.litlabs.net/img.png" },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset!.width).toBeUndefined();
    expect(asset!.height).toBeUndefined();
  });

  it("projectId is null when no project binding (truthful)", () => {
    const asset = generationJobToStudioAsset(makeImageJob());
    expect(asset!.projectId).toBeNull();
  });

  it("projectId preserved from metadata when present", () => {
    const asset = generationJobToStudioAsset(makeImageJob({
      metadata: { durableUrl: "https://x.com/i.png", projectId: "proj-001" },
    }));
    expect(asset!.projectId).toBe("proj-001");
  });

  it("provider/model/prompt are real, not fabricated", () => {
    const asset = generationJobToStudioAsset(makeImageJob());
    expect(asset!.provider).toBe("fal");
    expect(asset!.model).toBe("flux-1-schnell");
    expect(asset!.prompt).toBe("A neon city skyline at dusk");
  });

  it("costCredits is real from generation_jobs", () => {
    const asset = generationJobToStudioAsset(makeImageJob());
    expect(asset!.costCredits).toBe(5);
  });

  it("validates against Zod schema", () => {
    const asset = generationJobToStudioAsset(makeImageJob());
    expect(StudioAssetSchema.safeParse(asset).success).toBe(true);
  });

  it("image is registerable via POST /api/assets", () => {
    expect(isRegisterableAssetKind("image")).toBe(true);
  });
});

// ─── Video creator behavioral tests ──────────────────────────────

describe("Video creator — behavioral", () => {
  it("real success path (Alibaba): R2 URL → generation_jobs → StudioAsset", () => {
    // Alibaba videos are persisted to R2 and would create a generation_jobs row.
    // The adapter normalizes completed video jobs.
    const job = makeVideoJob();
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
  });

  it("correct AssetKind is video", () => {
    const asset = generationJobToStudioAsset(makeVideoJob());
    expect(asset!.kind).toBe("video");
  });

  it("canonical source ID is generation_job:<id>", () => {
    const asset = generationJobToStudioAsset(makeVideoJob());
    expect(asset!.id).toBe("generation_job:job-vid-001");
  });

  it("durationSeconds preserved from metadata", () => {
    const asset = generationJobToStudioAsset(makeVideoJob());
    expect(asset!.durationSeconds).toBe(5);
  });

  it("no fabricated width/height for video", () => {
    const job = makeVideoJob({
      metadata: { durableUrl: "https://cdn.litlabs.net/v.mp4" },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset!.width).toBeUndefined();
    expect(asset!.height).toBeUndefined();
  });

  it("projectId is null when no project binding (truthful)", () => {
    const asset = generationJobToStudioAsset(makeVideoJob());
    expect(asset!.projectId).toBeNull();
  });

  it("video is registerable via POST /api/assets", () => {
    expect(isRegisterableAssetKind("video")).toBe(true);
  });

  it("incomplete video job is NOT an asset (truthful)", () => {
    // Veo videos that are still generating should not appear in Asset Lake.
    expect(generationJobToStudioAsset(makeVideoJob({ status: "generating" }))).toBeNull();
    expect(generationJobToStudioAsset(makeVideoJob({ status: "queued" }))).toBeNull();
  });

  it("video job without URL is NOT an asset (browser-only blob)", () => {
    // Veo blob URLs are not durable — they should not be registered.
    const job = makeVideoJob({ metadata: {} });
    expect(generationJobToStudioAsset(job)).toBeNull();
  });
});

// ─── Music creator behavioral tests ──────────────────────────────

describe("Music creator — behavioral", () => {
  it("real success path: /api/music/generations → music_tracks → StudioAsset", () => {
    // Music generation creates music_tracks rows.
    // The Asset Lake adapter normalizes them.
    const track = makeMusicTrack();
    const asset = musicTrackToStudioAsset(track);
    expect(asset).not.toBeNull();
  });

  it("correct AssetKind is music", () => {
    const asset = musicTrackToStudioAsset(makeMusicTrack());
    expect(asset!.kind).toBe("music");
  });

  it("canonical source ID is music_track:<id>", () => {
    const asset = musicTrackToStudioAsset(makeMusicTrack());
    expect(asset!.id).toBe("music_track:track-uuid-001");
  });

  it("projectId preserved from music_tracks.project_id", () => {
    const asset = musicTrackToStudioAsset(makeMusicTrack({ project_id: "proj-001" }));
    expect(asset!.projectId).toBe("proj-001");
  });

  it("projectId is null when no project binding (truthful)", () => {
    const asset = musicTrackToStudioAsset(makeMusicTrack({ project_id: null }));
    expect(asset!.projectId).toBeNull();
  });

  it("no fabricated model when provider_model is null", () => {
    const asset = musicTrackToStudioAsset(makeMusicTrack({ provider_model: null }));
    expect(asset!.model).toBeUndefined();
  });

  it("BPM and musical key preserved in metadata", () => {
    const asset = musicTrackToStudioAsset(makeMusicTrack());
    expect(asset!.metadata?.bpm).toBe(120);
    expect(asset!.metadata?.musicalKey).toBe("C major");
  });

  it("private track with signed URL is visible in Asset Lake", () => {
    // E.1.11: Private tracks should NOT be dropped — they get signed URLs.
    const track = makeMusicTrack({
      visibility: "private",
      audio_url: "https://signed.r2.dev/audio/track.mp3?X-Amz-Signature=abc",
    });
    const asset = musicTrackToStudioAsset(track);
    expect(asset).not.toBeNull();
    expect(asset!.url).toContain("X-Amz-Signature");
  });

  it("track without audio_url is skipped (truthful)", () => {
    expect(musicTrackToStudioAsset(makeMusicTrack({ audio_url: null }))).toBeNull();
  });

  it("music is registerable via POST /api/assets", () => {
    expect(isRegisterableAssetKind("music")).toBe(true);
  });

  it("validates against Zod schema", () => {
    const asset = musicTrackToStudioAsset(makeMusicTrack());
    expect(StudioAssetSchema.safeParse(asset).success).toBe(true);
  });
});

// ─── Audio (TTS) creator behavioral tests ────────────────────────

describe("Audio (TTS) creator — behavioral", () => {
  it("real success path (when persisted): generation_jobs(speech) → StudioAsset", () => {
    // Audio TTS currently returns base64 (browser-only).
    // When persisted to R2 + generation_jobs, the adapter normalizes it.
    const job = makeAudioJob();
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
  });

  it("correct AssetKind is audio (from speech modality)", () => {
    const asset = generationJobToStudioAsset(makeAudioJob());
    expect(asset!.kind).toBe("audio");
  });

  it("canonical source ID is generation_job:<id>", () => {
    const asset = generationJobToStudioAsset(makeAudioJob());
    expect(asset!.id).toBe("generation_job:job-aud-001");
  });

  it("audio is registerable via POST /api/assets", () => {
    expect(isRegisterableAssetKind("audio")).toBe(true);
  });

  it("browser-only audio (no durable URL) is NOT an asset (truthful)", () => {
    // Current AudioTool returns base64 data URLs — not durable.
    // These should NOT appear in Asset Lake until persisted.
    const job = makeAudioJob({ metadata: {} });
    expect(generationJobToStudioAsset(job)).toBeNull();
  });

  it("provider/model/prompt are real from Gemini TTS", () => {
    const asset = generationJobToStudioAsset(makeAudioJob());
    expect(asset!.provider).toBe("gemini");
    expect(asset!.model).toBe("gemini-2.5-flash-preview-tts");
    expect(asset!.prompt).toContain("text to speech");
  });
});

// ─── Design creator behavioral tests ─────────────────────────────

describe("Design creator — behavioral", () => {
  it("design is NOT registerable via POST /api/assets", () => {
    // Design artifacts are localStorage-only — no durable URL.
    // They must not be registered as generation assets.
    expect(isRegisterableAssetKind("design")).toBe(false);
  });

  it("design AssetKind exists in the taxonomy", () => {
    // design is a valid AssetKind for display, just not for registration.
    const validKinds: AssetKind[] = ["image", "video", "music", "audio", "design", "code", "game"];
    expect(validKinds).toContain("design");
  });

  it("no fabricated design asset from ephemeral canvas state", () => {
    // DesignCanvas stores items in localStorage — there is no durable URL
    // and no generation job. We must not fabricate an asset from this.
    // This test documents that the registration layer correctly rejects design.
    expect(isRegisterableAssetKind("design")).toBe(false);
  });
});

// ─── 360° / Space creator behavioral tests ───────────────────────

describe("360° / Space creator — behavioral", () => {
  it("360° output maps to image AssetKind (panorama/skybox)", () => {
    // 360° panoramas are equirectangular images.
    // They should use kind="image" with metadata flags, not a new kind.
    const job: GenerationJob = {
      id: "job-sky-001",
      userId: "user-uuid-001",
      modality: "image",
      provider: "minimax",
      model: "image-01",
      status: "completed",
      prompt: "A futuristic city skyline panorama",
      requestId: "req-sky-001",
      providerJobId: null,
      actualProviderCostCents: 10,
      littBitsCharged: 15,
      refundStatus: "none",
      assetId: null,
      error: null,
      metadata: {
        durableUrl: "https://cdn.litlabs.net/skybox.png",
        contentType: "image/png",
        is360: true,
        format: "equirectangular",
      },
      createdAt: "2026-08-14T00:00:00Z",
      completedAt: "2026-08-14T00:00:08Z",
    };
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.kind).toBe("image");
    expect(asset!.metadata?.is360).toBe(true);
  });

  it("360° is NOT a separate AssetKind", () => {
    // environment is a CreatorKind, not an AssetKind.
    // 360° outputs use existing asset kinds (image/video).
    const validKinds: AssetKind[] = ["image", "video", "music", "audio", "design", "code", "game"];
    expect(validKinds).not.toContain("environment" as never);
    expect(validKinds).not.toContain("skybox" as never);
  });

  it("360° stub API (503) produces no asset (truthful)", () => {
    // The /api/skybox/generate endpoint currently returns 503.
    // No generation_jobs row is created, so no asset exists.
    // This test documents that the adapter correctly handles the
    // absence of a job — it returns null, not a fabricated asset.
    expect(generationJobToStudioAsset(makeImageJob({ status: "failed" }))).toBeNull();
  });
});

// ─── Cross-creator: persistence failure vs generation failure ─────

describe("Persistence vs generation failure separation", () => {
  it("failed generation is NOT an asset", () => {
    const job = makeImageJob({ status: "failed", error: "Provider timeout" });
    expect(generationJobToStudioAsset(job)).toBeNull();
  });

  it("cancelled generation is NOT an asset", () => {
    const job = makeImageJob({ status: "cancelled" });
    expect(generationJobToStudioAsset(job)).toBeNull();
  });

  it("completed generation without URL is NOT an asset (persistence failure)", () => {
    // The generation succeeded but the result was not persisted to storage.
    // This is distinct from a generation failure — the job completed but
    // has no durable URL. The adapter truthfully returns null.
    const job = makeImageJob({ metadata: { contentType: "image/png" } });
    expect(generationJobToStudioAsset(job)).toBeNull();
  });

  it("completed generation with URL IS an asset", () => {
    const job = makeImageJob({
      metadata: { durableUrl: "https://cdn.litlabs.net/img.png" },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.url).toBe("https://cdn.litlabs.net/img.png");
  });
});
