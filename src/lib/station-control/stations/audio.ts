/**
 * Station Control Bridge — audio station (chunk C, server-only).
 *
 * Backend wiring (verified against /api/media/generate-audio/route.ts):
 * - audio.tts calls the route's real provider substrate directly —
 *   GoogleGenAI gemini-2.5-flash-preview-tts with a prebuilt voice — and
 *   mirrors the route's durability ladder: R2 (uploadBinaryAsset) →
 *   Supabase Storage bucket `studio-audio` → data URL last resort. Both
 *   storage clients are server-side importables (@/lib/r2, @/lib/supabase).
 *   The route's wallet billing is NOT replicated (see video.ts rationale);
 *   the action is requiresApproval:true → STATION_MUTATION_APPROVAL.
 * - Completed audio saves into the project as /assets/audio/tts-x.wav when a
 *   project transport is present.
 * - audio.sfx IS registered but fails honestly (not_implemented): the route
 *   is speech-only (a TTS model) — no provider backs non-speech sound
 *   effects, so wiring it would be a lie.
 */
import "server-only";

import { z } from "zod";
import { GoogleGenAI, Modality } from "@google/genai";

import { registerStationAction } from "../registry";
import type {
  StationAction,
  StationExecutionContext,
  StationResult,
} from "../types";
import {
  fail,
  getTransport,
  ok,
  saveMediaToProject,
  stationResultSchema,
} from "./creator-helpers";
import { creatorKey, pushCreatorResult } from "./creator-state";
import { uploadBinaryAsset } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase";

const TTS_MODEL = "gemini-2.5-flash-preview-tts";

/**
 * Register a station action. Generic over the args schema so execute bodies
 * get a typed `args` instead of unknown (zod v4: bare z.ZodType infers
 * unknown — same pattern as chunk B's browser.ts). The executor safeParses
 * raw args against argsSchema before invoking execute, so the cast to the
 * erased StationAction is sound.
 */
function defineAction<A extends z.ZodType>(
  action: StationAction<A, StationResult>,
): void {
  registerStationAction(action as StationAction);
}

/** Mirror of the route's persistAudio durability ladder (R2 → studio-audio → data URL). */
async function persistAudio(
  userId: string,
  base64Data: string,
  prompt: string,
  voice: string,
): Promise<{ durableUrl: string; persisted: boolean }> {
  const buffer = Buffer.from(base64Data, "base64");
  const contentType = "audio/wav";
  const safePrompt = prompt.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "-");
  const filename = `tts-${voice}-${safePrompt}.wav`;

  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) {
    try {
      const result = await uploadBinaryAsset(userId, filename, buffer, contentType, "audio");
      return { durableUrl: result.publicUrl, persisted: true };
    } catch {
      // Fall through to Supabase Storage
    }
  }

  if (supabaseAdmin) {
    try {
      const filePath = `${userId}/${Date.now()}_${filename}`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from("studio-audio")
        .upload(filePath, buffer, { contentType, upsert: false });
      if (!uploadError) {
        const { data: urlData } = supabaseAdmin.storage
          .from("studio-audio")
          .getPublicUrl(filePath);
        if (urlData?.publicUrl) return { durableUrl: urlData.publicUrl, persisted: true };
      }
    } catch {
      // Fall through to data URL
    }
  }

  return { durableUrl: `data:audio/wav;base64,${base64Data}`, persisted: false };
}

defineAction({
  id: "audio.tts",
  station: "audio",
  description:
    "Synthesize speech from text with the real Gemini 2.5 Flash TTS backend (key-gated). Persists to durable storage and saves the finished audio into the project as /assets/audio/tts-x.wav when a project transport is present.",
  argsSchema: z.object({
    text: z.string().min(1).max(5000),
    voice: z.string().optional().describe("Prebuilt voice name, e.g. Kore"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  requiresApproval: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const key = creatorKey(ctx);
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return fail("Gemini API key not configured", "not_configured");
    }

    const voice = args.voice?.trim() || "Kore";
    let base64Audio: string | undefined;
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ parts: [{ text: args.text.trim() }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          },
        },
      });
      base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    } catch (err) {
      return fail(
        err instanceof Error ? err.message : "TTS generation failed",
        "execution_failed",
      );
    }
    if (!base64Audio) {
      return fail("No audio data returned by the TTS provider.", "execution_failed");
    }

    const { durableUrl, persisted } = await persistAudio(ctx.userId, base64Audio, args.text, voice);
    const resultId = `aud_${Date.now()}`;
    pushCreatorResult(key, { id: resultId, url: durableUrl, kind: "audio" });

    ctx.emitEvent({
      type: "live_state",
      actionId: "audio.tts",
      station: "audio",
      summary: `Speech synthesized (${voice})${persisted ? "" : " — storage unavailable, data URL only"}`,
    });

    const transport = getTransport(ctx);
    if (transport && ctx.projectId) {
      const saved = await saveMediaToProject(
        durableUrl,
        { nameHint: "tts", subdir: "audio", allowedMimes: ["audio/wav"], extension: "wav" },
        transport,
        ctx.signal,
      );
      if (!saved.success) {
        return ok({ status: "completed", audioUrl: durableUrl, resultId, persisted, savedToProject: false, saveError: saved.error, voice });
      }
      ctx.reportLiveState({ station: "audio", action: "audio.tts", status: "completed", voice });
      return ok({
        status: "completed",
        audioUrl: durableUrl,
        resultId,
        persisted,
        savedToProject: true,
        assetPath: saved.path,
        sitePath: saved.sitePath,
        voice,
      });
    }
    return ok({
      status: "completed",
      audioUrl: durableUrl,
      resultId,
      persisted,
      savedToProject: false,
      reason: "No project transport in this context — audio is chat-only.",
      voice,
    });
  },
});

defineAction({
  id: "audio.sfx",
  station: "audio",
  description:
    "Generate a non-speech sound effect from a description. NOT BACKED BY A PROVIDER: the audio backend is a speech-only TTS model. Registered so the capability is explicit, but it fails honestly.",
  argsSchema: z.object({ description: z.string().min(1) }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (): Promise<StationResult> => {
    return fail(
      "SFX generation is not backed by a provider — the audio backend is speech-only (Gemini TTS).",
      "not_implemented",
    );
  },
});
