// src/lib/music/providers/elevenlabs.ts
// ElevenLabs Music v2 adapter.
//
// Audited against current ElevenLabs Music v2 API docs (August 2026):
//   - Endpoint: POST https://api.elevenlabs.io/v1/music
//   - Model ID: "music_v2" (NOT "music-v2")
//   - Duration: music_length_ms in milliseconds (NOT duration in seconds)
//   - Composition plans: structured chunks with per-section styles/lyrics/duration
//   - Response: audio bytes streamed directly (content-type: audio/mpeg)
//
// The generation service handles audio storage (download → R2). This provider
// only returns either a direct audio URL (when the provider streams) or a
// provider job id (when async). It never touches the filesystem or
// URL.createObjectURL (that is a browser-only API and leaks memory).

import type {
  CompositionPlan,
  GenerateSongInput,
  GenerationStatus,
  MusicBlueprint,
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
    const { blueprint, prompt, instrumental, durationSeconds, compositionPlan } = input;
    const b = blueprint as MusicBlueprint;

    // Build request body — either composition_plan OR prompt, never both.
    const body: Record<string, unknown> = {
      model_id: "music_v2",
      music_length_ms: Math.min(durationSeconds, 600) * 1000,
    };

    if (compositionPlan) {
      // Structured composition plan mode — use the plan directly.
      body.composition_plan = compositionPlan;
      // Add instrumental to negative styles if needed
      if (instrumental) {
        body.composition_plan = {
          ...compositionPlan,
          negative_global_styles: [
            ...compositionPlan.negative_global_styles,
            "vocals", "singing", "rap", "spoken word",
          ],
        };
      }
    } else {
      // Simple prompt mode — build a rich prompt from the blueprint.
      body.prompt = this.buildPrompt(b, prompt);
      if (instrumental) {
        body.negative_global_styles = ["vocals", "singing", "rap", "spoken word"];
      }
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/music`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return { status: "failed", error: `ElevenLabs error: ${response.status} - ${error}`, estimatedCostCents: 0 };
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("audio/")) {
      // Direct audio streaming response — read the body and encode as data URL
      // so the generation service can download and upload to R2.
      try {
        const audioBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(audioBuffer).toString("base64");
        const dataUrl = `data:audio/mpeg;base64,${base64}`;
        return {
          status: "completed",
          audioUrl: dataUrl,
          estimatedCostCents: this.estimateCost(durationSeconds),
        };
      } catch {
        return { status: "failed", error: "Failed to read audio response from ElevenLabs", estimatedCostCents: 0 };
      }
    }

    // JSON response (unexpected for v2 streaming, but handle gracefully)
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
    // ElevenLabs Music v2 streams audio directly — no async polling.
    // This method exists for interface compliance but should not be called
    // when supportsAsyncPolling is false.
    const response = await fetchWithTimeout(`${this.baseUrl}/music/${providerJobId}`, {
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
    // ElevenLabs Music v2 is synchronous (streaming) — cancellation
    // is best-effort. The generation service handles local cancel + refund.
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/music/${providerJobId}/cancel`, {
        method: "POST",
        headers: { "xi-api-key": this.apiKey },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Build a rich text prompt from the blueprint metadata.
   * Used in simple prompt mode (not composition plan mode).
   */
  private buildPrompt(b: MusicBlueprint | undefined, originalPrompt: string): string {
    if (!b) return originalPrompt;
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

/**
 * Build a composition plan from a MusicBlueprint's structure and lyrics.
 * Maps the blueprint's song structure (intro, verse, chorus, etc.) into
 * ElevenLabs Music v2 composition plan chunks.
 */
export function buildCompositionPlanFromBlueprint(
  blueprint: MusicBlueprint,
  lyrics?: string,
): CompositionPlan {
  const genreStyles = blueprint.genre?.length ? blueprint.genre : ["electronic"];
  const moodStyles = blueprint.mood?.length ? blueprint.mood : [];
  const productionStyles = blueprint.production?.length ? blueprint.production : [];

  const globalPositive = [
    ...genreStyles,
    ...moodStyles,
    ...productionStyles,
    "great production quality",
    blueprint.bpm ? `${blueprint.bpm} BPM` : "",
    blueprint.key ? `key of ${blueprint.key}` : "",
  ].filter(Boolean) as string[];

  const globalNegative = [
    ...blueprint.avoid,
    ...(blueprint.instrumental ? ["vocals", "singing", "rap"] : []),
  ].filter(Boolean) as string[];

  // Parse lyrics into sections if provided
  const lyricSections = parseLyricSections(lyrics);

  // Build chunks from the blueprint structure
  const totalDurationMs = blueprint.durationSeconds * 1000;
  const chunkCount = blueprint.structure.length || 4;
  // Distribute duration across chunks, with chorus/hook getting more time
  const chunkDurations = distributeDurations(totalDurationMs, chunkCount, blueprint.structure);

  const chunks = blueprint.structure.map((section, i) => {
    const sectionLower = section.toLowerCase();
    const isChorus = sectionLower.includes("chorus") || sectionLower.includes("hook") || sectionLower.includes("drop");
    const isIntro = sectionLower.includes("intro");
    const isOutro = sectionLower.includes("outro");
    const isVerse = sectionLower.includes("verse");
    const isBridge = sectionLower.includes("bridge");

    const sectionLyrics = lyricSections.get(section) || lyricSections.get(sectionLower);

    const positiveStyles = [
      ...genreStyles,
      isChorus ? "catchy hook" : "",
      isChorus ? "memorable melody" : "",
      isVerse ? "steady groove" : "",
      isIntro ? "atmospheric build" : "",
      isOutro ? "fade out" : "",
      isBridge ? "contrast and tension" : "",
      ...moodStyles,
    ].filter(Boolean) as string[];

    const text = sectionLyrics
      ? `[${section}]\n${sectionLyrics}`
      : `[${section}]`;

    return {
      text,
      duration_ms: chunkDurations[i],
      positive_styles: positiveStyles,
      negative_styles: globalNegative.length > 0 ? globalNegative : undefined,
      context_adherence: isIntro || isOutro ? ("low" as const) : ("high" as const),
    };
  });

  return {
    chunks,
    positive_global_styles: globalPositive,
    negative_global_styles: globalNegative,
  };
}

/**
 * Parse lyrics text into sections keyed by section name.
 * Expected format: [Verse 1]\nlyrics here\n[Chorus]\nmore lyrics
 */
function parseLyricSections(lyrics?: string): Map<string, string> {
  const sections = new Map<string, string>();
  if (!lyrics) return sections;

  const lines = lyrics.split("\n");
  let currentSection = "";
  let currentText: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\[([^\]]+)\]/);
    if (match) {
      if (currentSection && currentText.length > 0) {
        sections.set(currentSection, currentText.join("\n"));
        sections.set(currentSection.toLowerCase(), currentText.join("\n"));
      }
      currentSection = match[1];
      currentText = [];
    } else if (line.trim()) {
      currentText.push(line);
    }
  }

  if (currentSection && currentText.length > 0) {
    sections.set(currentSection, currentText.join("\n"));
    sections.set(currentSection.toLowerCase(), currentText.join("\n"));
  }

  return sections;
}

/**
 * Distribute total duration across chunks, giving more time to choruses/hooks.
 */
function distributeDurations(
  totalMs: number,
  chunkCount: number,
  structure: string[],
): number[] {
  const weights = structure.map((s) => {
    const lower = s.toLowerCase();
    if (lower.includes("chorus") || lower.includes("hook") || lower.includes("drop")) return 1.5;
    if (lower.includes("verse")) return 1.2;
    if (lower.includes("bridge")) return 0.8;
    if (lower.includes("intro") || lower.includes("outro")) return 0.6;
    return 1;
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => {
    const ms = Math.round((w / totalWeight) * totalMs);
    // Clamp to valid range: 3000ms - 120000ms
    return Math.max(3000, Math.min(120000, ms));
  });
}
