import "server-only";

/**
 * Lyria 3 music provider adapter.
 *
 * Uses the Google Gemini API to generate music via the Lyria 3 models:
 *   - lyria-3-clip-preview: 30-second clips, $0.04/request
 *   - lyria-3-pro-preview: full songs with vocals, $0.08/request
 *
 * This is a streaming provider — it returns audio bytes directly,
 * similar to ElevenLabs Music v2.
 */

import { GoogleGenAI, Modality } from "@google/genai";
import type {
  GenerateSongInput,
  GenerationStatus,
  MusicBlueprint,
  MusicProviderName,
  ProviderGenerationResult,
  ProviderStatusResult,
} from "@/types/music";
import type { MusicProvider } from "./index";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export class LyriaMusicProvider implements MusicProvider {
  readonly name = "lyria" as const;
  readonly supportsStreaming = true;
  readonly supportsAsyncPolling = false;

  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || GEMINI_API_KEY || "";
    this.model = model || "lyria-3-pro-preview";
  }

  async generateSong(
    input: GenerateSongInput & { blueprint: unknown },
  ): Promise<ProviderGenerationResult> {
    if (!this.apiKey) {
      return {
        status: "failed",
        error: "GEMINI_API_KEY not configured for Lyria",
        estimatedCostCents: 0,
      };
    }

    const { blueprint, prompt, instrumental, durationSeconds, lyrics } = input;
    const b = blueprint as MusicBlueprint | undefined;

    // Build the prompt with blueprint context
    const fullPrompt = this.buildPrompt(b, prompt, lyrics, instrumental);

    try {
      const ai = new GoogleGenAI({ apiKey: this.apiKey });

      const parts: Array<{ text: string }> = [{ text: fullPrompt }];

      const response = await ai.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts }],
        config: {
          responseModalities: [Modality.AUDIO],
        },
      });

      const allParts = response.candidates?.[0]?.content?.parts ?? [];
      const audioPart = allParts.find(
        (p: { inlineData?: { data?: string; mimeType?: string } }) => p.inlineData?.data,
      );

      if (!audioPart?.inlineData?.data) {
        return {
          status: "failed",
          error: "Lyria returned empty audio",
          estimatedCostCents: 0,
        };
      }

      const audioMime = audioPart.inlineData.mimeType || "audio/wav";
      const base64 = audioPart.inlineData.data;
      const dataUrl = `data:${audioMime};base64,${base64}`;

      return {
        status: "completed",
        audioUrl: dataUrl,
        estimatedCostCents: this.estimateCost(durationSeconds),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lyria generation failed";
      return {
        status: "failed",
        error: msg,
        estimatedCostCents: 0,
      };
    }
  }

  async getStatus(_providerJobId: string): Promise<ProviderStatusResult> {
    // Lyria is streaming — no polling needed
    return {
      status: "completed",
      error: "Lyria is a streaming provider — status polling is not supported",
    };
  }

  async cancel(_providerJobId: string): Promise<boolean> {
    // Streaming provider — nothing to cancel
    return true;
  }

  private buildPrompt(
    b: MusicBlueprint | undefined,
    originalPrompt: string,
    lyrics?: string,
    instrumental?: boolean,
  ): string {
    const parts = [
      originalPrompt,
      b?.genre?.length ? `Genre: ${b.genre.join(", ")}` : "",
      b?.mood?.length ? `Mood: ${b.mood.join(", ")}` : "",
      b?.production?.length ? `Production: ${b.production.join(", ")}` : "",
      b?.bpm ? `BPM: ${b.bpm}` : "",
      b?.key ? `Key: ${b.key}` : "",
      b?.avoid?.length ? `Avoid: ${b.avoid.join(", ")}` : "",
      instrumental ? "Instrumental only — no vocals" : "",
      lyrics ? `Lyrics: ${lyrics}` : "",
    ].filter(Boolean);
    return parts.join(". ");
  }

  private estimateCost(durationSeconds: number): number {
    // Lyria 3 Pro: $0.08/request = 8 cents
    // Lyria 3 Clip: $0.04/request = 4 cents
    if (this.model === "lyria-3-clip-preview") {
      return 4;
    }
    // Pro: scale slightly by duration (base 8 cents for full song)
    return Math.max(8, Math.ceil(durationSeconds * 0.05));
  }
}
