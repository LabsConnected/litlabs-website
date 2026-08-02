// src/lib/music/providers/mock.ts
// Stateless mock provider for development and testing. Never burns API credits.
//
// Status is derived from elapsed time since creation, encoded in the job id,
// so polling survives page refresh and works across serverless invocations
// (no in-memory state). The returned audioUrl is a royalty-free sample; the
// generation service downloads + uploads it to R2 so the storage flow is
// exercised end-to-end.

import type {
  GenerateSongInput,
  GenerationStatus,
  ProviderGenerationResult,
  ProviderStatusResult,
} from "@/types/music";
import type { MusicProvider } from "./index";

// Royalty-free sample (same source the existing public.tracks demo table uses).
const MOCK_AUDIO_URL =
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";

// Time-based progression thresholds (ms since creation).
const T_GENERATING = 1_000;
const T_PROCESSING = 3_000;
const T_COMPLETED = 6_000;

function encodeJobId(): string {
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseCreatedAt(jobId: string): number | null {
  const match = /^mock-(\d+)-[a-z0-9]+$/.exec(jobId);
  return match ? Number(match[1]) : null;
}

function statusForElapsed(elapsed: number): GenerationStatus {
  if (elapsed >= T_COMPLETED) return "completed";
  if (elapsed >= T_PROCESSING) return "processing";
  if (elapsed >= T_GENERATING) return "generating";
  return "queued";
}

export class MockMusicProvider implements MusicProvider {
  readonly name = "mock" as const;
  readonly supportsStreaming = false;
  readonly supportsAsyncPolling = true;

  async generateSong(
    _input: GenerateSongInput & { blueprint: unknown },
  ): Promise<ProviderGenerationResult> {
    const jobId = encodeJobId();
    return {
      providerJobId: jobId,
      status: "queued",
      estimatedCostCents: 1, // 1 cent for testing
    };
  }

  async getStatus(providerJobId: string): Promise<ProviderStatusResult> {
    const createdAt = parseCreatedAt(providerJobId);
    if (createdAt === null) {
      return { status: "failed", error: "Mock job not found" };
    }
    const elapsed = Date.now() - createdAt;
    const status = statusForElapsed(elapsed);
    return {
      status,
      audioUrl: status === "completed" ? MOCK_AUDIO_URL : undefined,
      duration: 180,
    };
  }

  async cancel(providerJobId: string): Promise<boolean> {
    // Stateless: a cancelled job is recorded by the generation service.
    // We accept the cancel as long as the job id is well-formed.
    return parseCreatedAt(providerJobId) !== null;
  }
}
