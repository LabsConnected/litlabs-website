// src/lib/music/providers/elevenlabs.ts
// ElevenLabs Music adapter. NOT exercised until the mock flow is verified.
//
// The generation service handles audio storage (download → R2). This provider
// only returns either a direct audio URL (when the provider streams) or a
// provider job id (when async). It never touches the filesystem or
// URL.createObjectURL (that is a browser-only API and leaks memory).

import type {
  GenerateSongInput,
  GenerationStatus,
  ProviderGenerationResult,
  ProviderStatusResult,
} from "@/types/music";
import type { MusicProvider } from "./index";
import { fetchWithTimeout } from "./http";

export class ElevenMusicProvider implements MusicProvider {
  readonly name = "elevenlabs" as const;
  readonly supportsStreaming = true;
  readonly supportsAsyncPolling = false;

  private readonly apiKey: string;
  private readonly baseUrl = "https://api.elevenlabs.io/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateSong(
    input: GenerateSongInput & { blueprint: unknown },
  ): Promise<ProviderGenerationResult> {
    if (!this.apiKey) {
      return { status: "failed", error: "ELEVENLABS_API_KEY not configured", estimatedCostCents: 0 };
    }
    const { blueprint, prompt, instrumental, durationSeconds } = input;
    const b = blueprint as { genre?: string[]; mood?: string[]; production?: string[]; bpm?: number; key?: string; avoid?: string[]; lyrics?: string };

    const response = await fetchWithTimeout(`${this.baseUrl}/music/compose`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": this.apiKey,
      },
      body: JSON.stringify({
        prompt: this.buildPrompt(b, prompt),
        duration: Math.min(durationSeconds, 300),
        instrumental,
        model_id: "music-v2",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { status: "failed", error: `ElevenLabs error: ${response.status} - ${error}`, estimatedCostCents: 0 };
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("audio/")) {
      // Direct audio response — return the request URL as a fetchable source.
      // The generation service downloads the bytes and uploads to R2.
      // We cannot return the consumed body here; instead signal streaming
      // completion and let the service re-fetch via a signed request.
      return {
        status: "completed",
        audioUrl: response.url,
        estimatedCostCents: this.estimateCost(durationSeconds),
      };
    }

    const data = (await response.json()) as {
      job_id?: string; id?: string; status?: string; audio_url?: string;
    };
    return {
      providerJobId: data.job_id || data.id,
      status: this.mapStatus(data.status || "generating"),
      audioUrl: data.audio_url,
      estimatedCostCents: this.estimateCost(durationSeconds),
    };
  }

  async getStatus(providerJobId: string): Promise<ProviderStatusResult> {
    const response = await fetchWithTimeout(`${this.baseUrl}/music/compose/${providerJobId}`, {
      headers: { "xi-api-key": this.apiKey },
    });
    if (!response.ok) {
      return { status: "failed", error: "ElevenLabs status check failed" };
    }
    const data = (await response.json()) as {
      status?: string; audio_url?: string; duration?: number; error?: string;
    };
    return {
      status: this.mapStatus(data.status || "generating"),
      audioUrl: data.audio_url,
      duration: data.duration,
      error: data.error,
    };
  }

  async cancel(providerJobId: string): Promise<boolean> {
    const response = await fetchWithTimeout(`${this.baseUrl}/music/compose/${providerJobId}/cancel`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey },
    });
    return response.ok;
  }

  private buildPrompt(b: {
    genre?: string[]; mood?: string[]; production?: string[];
    bpm?: number; key?: string; avoid?: string[]; lyrics?: string;
  }, originalPrompt: string): string {
    const parts = [
      originalPrompt,
      b.genre?.length ? `Genre: ${b.genre.join(", ")}` : "",
      b.mood?.length ? `Mood: ${b.mood.join(", ")}` : "",
      b.production?.length ? `Production: ${b.production.join(", ")}` : "",
      b.bpm ? `BPM: ${b.bpm}` : "",
      b.key ? `Key: ${b.key}` : "",
      b.avoid?.length ? `Avoid: ${b.avoid.join(", ")}` : "",
      b.lyrics ? `Lyrics: ${b.lyrics}` : "",
    ].filter(Boolean);
    return parts.join(". ");
  }

  private mapStatus(providerStatus: string): GenerationStatus {
    const map: Record<string, GenerationStatus> = {
      pending: "queued",
      processing: "generating",
      generating: "generating",
      completed: "completed",
      done: "completed",
      failed: "failed",
      cancelled: "cancelled",
    };
    return map[providerStatus] || "generating";
  }

  private estimateCost(durationSeconds: number): number {
    // ElevenLabs Music v2: ~$0.15/min ≈ 0.25 cents/sec.
    return Math.ceil(durationSeconds * 0.25);
  }
}
