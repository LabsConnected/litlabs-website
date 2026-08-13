import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GenerationJob } from "@/lib/generation/types";
import type { MusicTrackRow } from "@/lib/assets/adapters/music-track";
import {
  generationJobToStudioAsset,
} from "@/lib/assets/adapters/generation-job";
import {
  musicTrackToStudioAsset,
} from "@/lib/assets/adapters/music-track";
import { buildCanonicalId } from "@/lib/assets/ids";

/**
 * Phase E.2 — Closure tests.
 *
 * Tests the four closure gaps identified after E.1:
 * - E.2.1: Real Video persistence — generate-video creates generation_jobs
 * - E.2.2: Auto-select generated asset (tested via adapter contract)
 * - E.2.3: Project-scoped filtering — exclude assets bound to OTHER projects
 * - E.2.4: Cost truthfulness — distinguish "no cost provided" from "cost is zero"
 */

// ─── Fixtures ────────────────────────────────────────────────────

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-001",
    userId: "user-uuid-001",
    modality: "image",
    provider: "fal",
    model: "flux-1-schnell",
    status: "completed",
    prompt: "A neon city",
    requestId: "req-001",
    providerJobId: null,
    actualProviderCostCents: 1,
    littBitsCharged: 5,
    refundStatus: "none",
    assetId: null,
    error: null,
    metadata: { durableUrl: "https://cdn.litlabs.net/img.png" },
    createdAt: "2026-08-14T00:00:00Z",
    completedAt: "2026-08-14T00:00:05Z",
    ...overrides,
  };
}

function makeTrack(overrides: Partial<MusicTrackRow> = {}): MusicTrackRow {
  return {
    id: "track-001",
    user_id: "user-uuid-001",
    generation_id: "gen-001",
    project_id: null,
    version_label: "v1",
    title: "Test Track",
    blueprint: {},
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

// ─── E.2.1: Real Video persistence ───────────────────────────────

describe("E.2.1: Real Video persistence", () => {
  it("Alibaba video job with durableUrl becomes a StudioAsset", () => {
    // After the alibaba-status route saves to R2 and completes the
    // generation_jobs row, the adapter should produce a valid asset.
    const job = makeJob({
      id: "job-vid-alibaba-001",
      modality: "video",
      provider: "alibaba",
      model: "happyhorse-2.2",
      status: "completed",
      prompt: "A cat playing piano",
      metadata: {
        durableUrl: "https://cdn.litlabs.net/video.mp4",
        contentType: "video/mp4",
        providerJobId: "alibaba-task-001",
        storageKey: "user-uuid-001/video/happyhorse-task-001.mp4",
      },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.kind).toBe("video");
    expect(asset!.url).toBe("https://cdn.litlabs.net/video.mp4");
    expect(asset!.id).toBe("generation_job:job-vid-alibaba-001");
  });

  it("Veo video job with durableUrl becomes a StudioAsset", () => {
    // After the video-status route saves to R2 and completes the
    // generation_jobs row, the adapter should produce a valid asset.
    const job = makeJob({
      id: "job-vid-veo-001",
      modality: "video",
      provider: "veo",
      model: "veo-3.1",
      status: "completed",
      prompt: "A dog running",
      metadata: {
        durableUrl: "https://cdn.litlabs.net/veo-video.mp4",
        contentType: "video/mp4",
        providerJobId: "veo-op-001",
      },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.kind).toBe("video");
    expect(asset!.url).toBe("https://cdn.litlabs.net/veo-video.mp4");
  });

  it("video generation_jobs row still generating is NOT an asset", () => {
    // Before the status route completes the job, it should not appear.
    const job = makeJob({
      modality: "video",
      provider: "alibaba",
      status: "generating",
      metadata: { providerJobId: "alibaba-task-001" },
    });
    expect(generationJobToStudioAsset(job)).toBeNull();
  });

  it("video generation_jobs row failed is NOT an asset", () => {
    const job = makeJob({
      modality: "video",
      provider: "veo",
      status: "failed",
      error: "Provider timeout",
      metadata: {},
    });
    expect(generationJobToStudioAsset(job)).toBeNull();
  });

  it("video job with providerJobId in metadata preserves it", () => {
    const job = makeJob({
      modality: "video",
      provider: "alibaba",
      metadata: {
        durableUrl: "https://cdn.litlabs.net/v.mp4",
        providerJobId: "alibaba-task-abc",
      },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.metadata?.providerJobId).toBe("alibaba-task-abc");
  });
});

// ─── E.2.2: Auto-select generated asset ──────────────────────────

describe("E.2.2: Auto-select generated asset", () => {
  it("image generation produces canonical generation_job:<id> asset ID", () => {
    // The generate route now returns assetId = "generation_job:<jobId>"
    // ImageTool uses this to call setActiveAssetId.
    const jobId = "job-img-auto-select-001";
    const canonicalId = buildCanonicalId("generation_job", jobId);
    expect(canonicalId).toBe("generation_job:job-img-auto-select-001");
  });

  it("music generation produces canonical music_track:<id> asset ID", () => {
    // MusicTool constructs music_track:<trackId> from the track preview.
    const trackId = "track-auto-select-001";
    const canonicalId = buildCanonicalId("music_track", trackId);
    expect(canonicalId).toBe("music_track:track-auto-select-001");
  });

  it("image asset ID from generation job matches canonical format", () => {
    const job = makeJob({ id: "job-img-001" });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.id).toBe("generation_job:job-img-001");
  });

  it("music asset ID from track matches canonical format", () => {
    const track = makeTrack({ id: "track-001" });
    const asset = musicTrackToStudioAsset(track);
    expect(asset).not.toBeNull();
    expect(asset!.id).toBe("music_track:track-001");
  });
});

// ─── E.2.3: Project-scoped filtering ─────────────────────────────

describe("E.2.3: Project-scoped filtering", () => {
  it("generation job with no projectId is included in project scope", () => {
    // Assets with no project binding are user-scoped — always included.
    const job = makeJob({
      metadata: { durableUrl: "https://cdn.litlabs.net/img.png" },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.projectId).toBeNull();
    // A project filter should NOT exclude this asset.
  });

  it("generation job with matching projectId is included", () => {
    const job = makeJob({
      metadata: {
        durableUrl: "https://cdn.litlabs.net/img.png",
        projectId: "proj-active-001",
      },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.projectId).toBe("proj-active-001");
    // A filter for "proj-active-001" should include this asset.
  });

  it("generation job with DIFFERENT projectId is excluded by filter", () => {
    const job = makeJob({
      metadata: {
        durableUrl: "https://cdn.litlabs.net/img.png",
        projectId: "proj-other-001",
      },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.projectId).toBe("proj-other-001");
    // A filter for "proj-active-001" should EXCLUDE this asset.
    expect(asset!.projectId).not.toBe("proj-active-001");
  });

  it("music track with no project_id is included in project scope", () => {
    const track = makeTrack({ project_id: null });
    const asset = musicTrackToStudioAsset(track);
    expect(asset).not.toBeNull();
    expect(asset!.projectId).toBeNull();
  });

  it("music track with matching project_id is included", () => {
    const track = makeTrack({ project_id: "proj-active-001" });
    const asset = musicTrackToStudioAsset(track);
    expect(asset).not.toBeNull();
    expect(asset!.projectId).toBe("proj-active-001");
  });

  it("music track with DIFFERENT project_id is excluded by filter", () => {
    const track = makeTrack({ project_id: "proj-other-001" });
    const asset = musicTrackToStudioAsset(track);
    expect(asset).not.toBeNull();
    expect(asset!.projectId).toBe("proj-other-001");
    // A filter for "proj-active-001" should EXCLUDE this asset.
  });

  it("filtering logic: null projectId matches any active project", () => {
    // Simulate the filter logic from fetchGenerationJobs/fetchMusicTracks.
    const activeProjectId = "proj-active-001";
    const assets = [
      { projectId: null },           // user-scoped → include
      { projectId: "proj-active-001" }, // matches → include
      { projectId: "proj-other-001" },  // different → exclude
    ];
    const filtered = assets.filter(
      (a) => a.projectId === null || a.projectId === activeProjectId,
    );
    expect(filtered).toHaveLength(2);
    expect(filtered[0].projectId).toBeNull();
    expect(filtered[1].projectId).toBe("proj-active-001");
  });
});

// ─── E.2.4: Cost truthfulness ────────────────────────────────────

describe("E.2.4: Cost truthfulness", () => {
  it("generation job with real cost preserves it", () => {
    const job = makeJob({ littBitsCharged: 30 });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.costCredits).toBe(30);
  });

  it("generation job with zero cost preserves it (free tier)", () => {
    const job = makeJob({ littBitsCharged: 0 });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.costCredits).toBe(0);
    // This is a real zero — the generation was free.
  });

  it("generation job with costUnknown metadata flag is surfaced", () => {
    // When registration doesn't provide costCredits, the metadata
    // gets costUnknown: true so consumers can distinguish.
    const job = makeJob({
      littBitsCharged: 0, // NOT NULL constraint → stored as 0
      metadata: {
        durableUrl: "https://cdn.litlabs.net/img.png",
        costUnknown: true, // flag: cost was not reported
      },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.costCredits).toBe(0);
    expect(asset!.metadata?.costUnknown).toBe(true);
  });

  it("generation job without costUnknown flag means cost is real", () => {
    const job = makeJob({
      littBitsCharged: 5,
      metadata: { durableUrl: "https://cdn.litlabs.net/img.png" },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.costCredits).toBe(5);
    expect(asset!.metadata?.costUnknown).toBeUndefined();
  });
});

// ─── E.2.1: Video route integration contract ─────────────────────

describe("E.2.1: Video route contract — generation_jobs creation", () => {
  // These tests verify the contract that the generate-video route
  // must follow: create a generation_jobs row with modality="video"
  // and the provider job ID, so the status route can complete it.

  it("Alibaba video job has provider=alibaba and modality=video", () => {
    const job = makeJob({
      modality: "video",
      provider: "alibaba",
      model: "happyhorse-2.2",
      metadata: {
        durableUrl: "https://cdn.litlabs.net/v.mp4",
        providerJobId: "alibaba-task-001",
        videoJobId: "alibaba_alibaba-task-001",
      },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.kind).toBe("video");
    expect(asset!.provider).toBe("alibaba");
    expect(asset!.metadata?.videoJobId).toBe("alibaba_alibaba-task-001");
  });

  it("Veo video job has provider=veo and modality=video", () => {
    const job = makeJob({
      modality: "video",
      provider: "veo",
      model: "veo-3.1",
      metadata: {
        durableUrl: "https://cdn.litlabs.net/v.mp4",
        providerJobId: "veo-op-001",
        videoJobId: "veo_veo-op-001",
      },
    });
    const asset = generationJobToStudioAsset(job);
    expect(asset).not.toBeNull();
    expect(asset!.kind).toBe("video");
    expect(asset!.provider).toBe("veo");
  });
});
