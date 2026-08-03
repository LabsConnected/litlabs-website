// src/lib/music/providers/mureka.ts
// Mureka async adapter. Behind the ENABLE_MUREKA server-side feature flag.
// Not exercised in the mock vertical slice.

import type {
  GenerateSongInput,
  GenerationStatus,
  ProviderGenerationResult,
  ProviderStatusResult,
} from "@/types/music";
import type { MusicProvider } from "./index";
import { fetchWithTimeout } from "./http";

export class MurekaMusicProvider implements MusicProvider {
  readonly name = "mureka" as const;
  readonly supportsStreaming = false;
  readonly supportsAsyncPolling = true;

  private readonly apiKey: string;
  private readonly baseUrl = "https://api.mureka.ai/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateSong(
    input: GenerateSongInput & { blueprint: unknown },
  ): Promise<ProviderGenerationResult> {
    if (!this.apiKey) {
      return { status: "failed", error: "MUREKA_API_KEY not configured", estimatedCostCents: 0 };
    }
    const { blueprint, prompt, instrumental, durationSeconds, lyrics } = input;
    const b = blueprint as { genre?: string[]; mood?: string[]; production?: string[] };

    const response = await fetchWithTimeout(`${this.baseUrl}/songs/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        prompt: this.buildPrompt(b, prompt),
        instrumental,
        duration: durationSeconds,
        lyrics: lyrics || undefined,
        style: b.genre?.join(", "),
        mood: b.mood?.join(", "),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { status: "failed", error: `Mureka error: ${response.status} - ${error}`, estimatedCostCents: 0 };
    }

    const data = (await response.json()) as { task_id?: string; id?: string };
    return {
      providerJobId: data.task_id || data.id,
      status: "queued",
      estimatedCostCents: this.estimateCost(),
    };
  }

  async getStatus(providerJobId: string): Promise<ProviderStatusResult> {
    const response = await fetchWithTimeout(`${this.baseUrl}/songs/status/${providerJobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) {
      return { status: "failed", error: "Mureka status check failed" };
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
    const response = await fetchWithTimeout(`${this.baseUrl}/songs/cancel/${providerJobId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    return response.ok;
  }

  private buildPrompt(
    b: { genre?: string[]; mood?: string[]; production?: string[] },
    originalPrompt: string,
  ): string {
    return [
      originalPrompt,
      b.genre?.length ? `Style: ${b.genre.join(", ")}` : "",
      b.mood?.length ? `Mood: ${b.mood.join(", ")}` : "",
      b.production?.length ? `Production: ${b.production.join(", ")}` : "",
    ].filter(Boolean).join(". ");
  }

  private mapStatus(providerStatus: string): GenerationStatus {
    const map: Record<string, GenerationStatus> = {
      queued: "queued",
      processing: "generating",
      generating: "generating",
      completed: "completed",
      done: "completed",
      failed: "failed",
      cancelled: "cancelled",
    };
    return map[providerStatus] || "generating";
  }

  private estimateCost(): number {
    // Mureka: ~$0.045/song ≈ 5 cents.
    return 5;
  }
}
