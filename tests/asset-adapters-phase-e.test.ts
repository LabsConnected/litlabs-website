import { describe, it, expect } from "vitest";
import type { GenerationJob } from "@/lib/generation/types";
import type { MusicTrackRow } from "@/lib/assets/adapters/music-track";
import {
  generationJobToStudioAsset,
  generationJobsToStudioAssets,
  modalityToAssetKind,
} from "@/lib/assets/adapters/generation-job";
import {
  musicTrackToStudioAsset,
  musicTracksToStudioAssets,
} from "@/lib/assets/adapters/music-track";
import { StudioAssetSchema } from "@/lib/assets/schemas";

// ─── Test fixtures ───────────────────────────────────────────────

function makeGenerationJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-uuid-001",
    userId: "user-uuid-001",
    modality: "image",
    provider: "fal",
    model: "flux-1-schnell",
    status: "completed",
    prompt: "A neon city skyline at dusk",
    requestId: "req-001",
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

// ─── generation_jobs adapter tests ───────────────────────────────

describe("generation_jobs adapter", () => {
  describe("modalityToAssetKind", () => {
    it("image → image", () => {
      expect(modalityToAssetKind("image")).toBe("image");
    });

    it("video → video", () => {
      expect(modalityToAssetKind("video")).toBe("video");
    });

    it("music → music", () => {
      expect(modalityToAssetKind("music")).toBe("music");
    });

    it("speech → audio", () => {
      expect(modalityToAssetKind("speech")).toBe("audio");
    });

    it("unknown modality → null", () => {
      expect(modalityToAssetKind("unknown" as never)).toBeNull();
    });
  });

  describe("generationJobToStudioAsset", () => {
    it("maps completed image job with full provenance", () => {
      const job = makeGenerationJob();
      const asset = generationJobToStudioAsset(job);
      expect(asset).not.toBeNull();
      expect(asset!.id).toBe("generation_job:job-uuid-001");
      expect(asset!.kind).toBe("image");
      expect(asset!.source).toBe("generated");
      expect(asset!.url).toBe("https://cdn.litlabs.net/generated.png");
      expect(asset!.provider).toBe("fal");
      expect(asset!.model).toBe("flux-1-schnell");
      expect(asset!.prompt).toBe("A neon city skyline at dusk");
      expect(asset!.mimeType).toBe("image/png");
      expect(asset!.width).toBe(1024);
      expect(asset!.height).toBe(1024);
      expect(asset!.costCredits).toBe(5);
      expect(asset!.visibility).toBe("private");
    });

    it("returns null for non-completed job", () => {
      expect(generationJobToStudioAsset(makeGenerationJob({ status: "queued" }))).toBeNull();
      expect(generationJobToStudioAsset(makeGenerationJob({ status: "failed" }))).toBeNull();
      expect(generationJobToStudioAsset(makeGenerationJob({ status: "cancelled" }))).toBeNull();
    });

    it("returns null for job without URL in metadata", () => {
      const job = makeGenerationJob({
        metadata: { contentType: "image/png" }, // no durableUrl
      });
      expect(generationJobToStudioAsset(job)).toBeNull();
    });

    it("returns null for unknown modality", () => {
      const job = makeGenerationJob({ modality: "unknown" as never });
      expect(generationJobToStudioAsset(job)).toBeNull();
    });

    it("maps video job correctly", () => {
      const job = makeGenerationJob({
        modality: "video",
        provider: "veo",
        model: "veo-3.1",
        metadata: {
          durableUrl: "https://cdn.litlabs.net/video.mp4",
          contentType: "video/mp4",
          durationSeconds: 5,
        },
      });
      const asset = generationJobToStudioAsset(job);
      expect(asset).not.toBeNull();
      expect(asset!.kind).toBe("video");
      expect(asset!.mimeType).toBe("video/mp4");
      expect(asset!.durationSeconds).toBe(5);
    });

    it("maps speech (audio) job correctly", () => {
      const job = makeGenerationJob({
        modality: "speech",
        provider: "gemini",
        model: "gemini-2.5-flash-tts",
        metadata: {
          durableUrl: "https://cdn.litlabs.net/audio.wav",
          contentType: "audio/wav",
          durationSeconds: 10,
        },
      });
      const asset = generationJobToStudioAsset(job);
      expect(asset).not.toBeNull();
      expect(asset!.kind).toBe("audio");
      expect(asset!.provider).toBe("gemini");
    });

    it("preserves thumbnailUrl from metadata", () => {
      const job = makeGenerationJob({
        metadata: {
          durableUrl: "https://cdn.litlabs.net/video.mp4",
          thumbUrl: "https://cdn.litlabs.net/thumb.jpg",
        },
      });
      const asset = generationJobToStudioAsset(job);
      expect(asset!.thumbnailUrl).toBe("https://cdn.litlabs.net/thumb.jpg");
    });

    it("does NOT fabricate dimensions when absent", () => {
      const job = makeGenerationJob({
        metadata: { durableUrl: "https://cdn.litlabs.net/img.png" },
      });
      const asset = generationJobToStudioAsset(job);
      expect(asset!.width).toBeUndefined();
      expect(asset!.height).toBeUndefined();
    });

    it("does NOT fabricate provider/model when empty", () => {
      const job = makeGenerationJob({ provider: "", model: "" });
      const asset = generationJobToStudioAsset(job);
      expect(asset!.provider).toBeUndefined();
      expect(asset!.model).toBeUndefined();
    });

    it("preserves jobId and requestId in metadata", () => {
      const job = makeGenerationJob();
      const asset = generationJobToStudioAsset(job);
      expect(asset!.metadata?.jobId).toBe("job-uuid-001");
      expect(asset!.metadata?.requestId).toBe("req-001");
      expect(asset!.metadata?.modality).toBe("image");
    });

    it("validates against Zod schema", () => {
      const asset = generationJobToStudioAsset(makeGenerationJob());
      const result = StudioAssetSchema.safeParse(asset);
      expect(result.success).toBe(true);
    });

    it("derives name from prompt when no title in metadata", () => {
      const job = makeGenerationJob({ prompt: "A very long prompt that exceeds sixty characters and should be truncated for the name field" });
      const asset = generationJobToStudioAsset(job);
      // Truncated to 57 chars + "..."
      expect(asset!.name).toBe("A very long prompt that exceeds sixty characters and shou...");
      expect(asset!.name.length).toBe(60); // 57 + 3 for "..."
    });

    it("uses title from metadata when available", () => {
      const job = makeGenerationJob({
        metadata: {
          durableUrl: "https://cdn.litlabs.net/img.png",
          title: "My Generated Image",
        },
      });
      const asset = generationJobToStudioAsset(job);
      expect(asset!.name).toBe("My Generated Image");
    });

    it("reads projectId from metadata when present (E.1.8)", () => {
      const job = makeGenerationJob({
        metadata: {
          durableUrl: "https://cdn.litlabs.net/img.png",
          projectId: "proj-uuid-001",
        },
      });
      const asset = generationJobToStudioAsset(job);
      expect(asset).not.toBeNull();
      expect(asset!.projectId).toBe("proj-uuid-001");
    });

    it("returns null projectId when metadata has no projectId (E.1.8)", () => {
      const job = makeGenerationJob({
        metadata: {
          durableUrl: "https://cdn.litlabs.net/img.png",
        },
      });
      const asset = generationJobToStudioAsset(job);
      expect(asset).not.toBeNull();
      expect(asset!.projectId).toBeNull();
    });

    it("returns null projectId when metadata projectId is empty string", () => {
      const job = makeGenerationJob({
        metadata: {
          durableUrl: "https://cdn.litlabs.net/img.png",
          projectId: "",
        },
      });
      const asset = generationJobToStudioAsset(job);
      expect(asset).not.toBeNull();
      expect(asset!.projectId).toBeNull();
    });
  });

  describe("generationJobsToStudioAssets (batch)", () => {
    it("filters out incomplete jobs", () => {
      const jobs = [
        makeGenerationJob({ id: "job-1" }),
        makeGenerationJob({ id: "job-2", status: "failed" }),
        makeGenerationJob({ id: "job-3", metadata: {} }), // no URL
        makeGenerationJob({ id: "job-4" }),
      ];
      const assets = generationJobsToStudioAssets(jobs);
      expect(assets).toHaveLength(2);
      expect(assets[0].id).toBe("generation_job:job-1");
      expect(assets[1].id).toBe("generation_job:job-4");
    });
  });
});

// ─── music_tracks adapter tests ──────────────────────────────────

describe("music_tracks adapter", () => {
  describe("musicTrackToStudioAsset", () => {
    it("maps track with full metadata", () => {
      const track = makeMusicTrack();
      const asset = musicTrackToStudioAsset(track);
      expect(asset).not.toBeNull();
      expect(asset!.id).toBe("music_track:track-uuid-001");
      expect(asset!.kind).toBe("music");
      expect(asset!.source).toBe("generated");
      expect(asset!.name).toBe("Neon Dreams");
      expect(asset!.url).toBe("https://cdn.litlabs.net/audio/track.mp3");
      expect(asset!.provider).toBe("elevenlabs");
      expect(asset!.durationSeconds).toBe(30);
      expect(asset!.costCredits).toBe(8);
      expect(asset!.visibility).toBe("private");
    });

    it("returns null for track without audio_url", () => {
      const track = makeMusicTrack({ audio_url: null });
      expect(musicTrackToStudioAsset(track)).toBeNull();
    });

    it("preserves project_id when present", () => {
      const track = makeMusicTrack({ project_id: "proj-uuid-001" });
      const asset = musicTrackToStudioAsset(track);
      expect(asset!.projectId).toBe("proj-uuid-001");
    });

    it("preserves null project_id truthfully", () => {
      const track = makeMusicTrack({ project_id: null });
      const asset = musicTrackToStudioAsset(track);
      expect(asset!.projectId).toBeNull();
    });

    it("does NOT fabricate model when provider_model is null", () => {
      const track = makeMusicTrack({ provider_model: null });
      const asset = musicTrackToStudioAsset(track);
      expect(asset!.model).toBeUndefined();
    });

    it("preserves model when provider_model is present", () => {
      const track = makeMusicTrack({ provider_model: "lyria-3-pro" });
      const asset = musicTrackToStudioAsset(track);
      expect(asset!.model).toBe("lyria-3-pro");
    });

    it("preserves BPM and musical key in metadata", () => {
      const track = makeMusicTrack();
      const asset = musicTrackToStudioAsset(track);
      expect(asset!.metadata?.bpm).toBe(120);
      expect(asset!.metadata?.musicalKey).toBe("C major");
    });

    it("preserves blueprint in metadata", () => {
      const track = makeMusicTrack();
      const asset = musicTrackToStudioAsset(track);
      expect(asset!.metadata?.blueprint).toEqual({ genre: ["synthwave"], mood: ["energetic"] });
    });

    it("preserves version label in metadata", () => {
      const track = makeMusicTrack({ version_label: "Version B" });
      const asset = musicTrackToStudioAsset(track);
      expect(asset!.metadata?.versionLabel).toBe("Version B");
    });

    it("preserves visibility correctly", () => {
      expect(musicTrackToStudioAsset(makeMusicTrack({ visibility: "public" }))!.visibility).toBe("public");
      expect(musicTrackToStudioAsset(makeMusicTrack({ visibility: "unlisted" }))!.visibility).toBe("unlisted");
      expect(musicTrackToStudioAsset(makeMusicTrack({ visibility: "private" }))!.visibility).toBe("private");
    });

    it("validates against Zod schema", () => {
      const asset = musicTrackToStudioAsset(makeMusicTrack());
      const result = StudioAssetSchema.safeParse(asset);
      expect(result.success).toBe(true);
    });
  });

  describe("musicTracksToStudioAssets (batch)", () => {
    it("filters out tracks without audio_url", () => {
      const tracks = [
        makeMusicTrack({ id: "track-1" }),
        makeMusicTrack({ id: "track-2", audio_url: null }),
        makeMusicTrack({ id: "track-3" }),
      ];
      const assets = musicTracksToStudioAssets(tracks);
      expect(assets).toHaveLength(2);
      expect(assets[0].id).toBe("music_track:track-1");
      expect(assets[1].id).toBe("music_track:track-3");
    });
  });
});
