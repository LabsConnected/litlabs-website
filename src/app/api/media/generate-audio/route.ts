import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { withRateLimit } from "@/lib/rate-limiter";
import { isBillingExempt, getActiveSimulation } from "@/lib/owner";
import { GoogleGenAI, Modality } from "@google/genai";
import { uploadBinaryAsset } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase";
import {
  createGenerationJob,
  completeGenerationJob,
} from "@/lib/generation/jobs";
import { resolveInternalUserId } from "@/lib/generation/identity";

// ── Route configuration ──────────────────────────────────────────
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const COST = 2;

/**
 * Persist generated audio to durable storage (R2 → Supabase fallback).
 * Mirrors the persistImage pattern from /api/media/generate.
 * Returns a durable public URL, or the data URL if all storage fails.
 */
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

  // Try R2 first
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) {
    try {
      const result = await uploadBinaryAsset(userId, filename, buffer, contentType, "audio");
      return { durableUrl: result.publicUrl, persisted: true };
    } catch {
      // Fall through to Supabase Storage
    }
  }

  // Fallback: Supabase Storage (bucket: studio-audio)
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

  // Last resort: return the data URL (not durable, but still playable)
  return { durableUrl: `data:audio/wav;base64,${base64Data}`, persisted: false };
}

async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY)
    return NextResponse.json(
      { error: "Gemini API key not configured" },
      { status: 500 },
    );

  // Check balance using canonical ledger
  const balances = await getCreditBalances(userId);
  if (balances.total < COST) {
    return NextResponse.json(
      { error: `Need ${COST} LiTTBits` },
      { status: 402 },
    );
  }

  try {
    const { prompt, voice = "Kore", styleDirection } = await req.json();
    if (!prompt?.trim())
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });

    // Compose final prompt with optional delivery direction
    const finalPrompt = styleDirection
      ? `${prompt.trim()}\n\nDelivery direction: ${styleDirection}`
      : prompt.trim();

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: finalPrompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const base64Audio =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("No audio data returned.");

    // Check billing exemption — owner skips debit
    const audioSim = await getActiveSimulation().catch(() => null);
    const audioExempt = isBillingExempt(userId, audioSim);

    let audioBalance: number | null = null;
    if (audioExempt) {
      try {
        const balances = await getCreditBalances(userId);
        audioBalance = balances.total;
      } catch {
        audioBalance = null;
      }
    } else {
      // Atomic debit via canonical ledger
      const reservation = await adjustWalletBalance({
        clerkId: userId,
        amount: -COST,
        type: "spend",
        reason: `TTS: voice=${voice}`,
        idempotencyKey: `tts_${userId}_${Date.now()}`,
      });
      audioBalance = reservation.balance;
    }

    // Persist audio to durable storage (R2 → Supabase → data URL fallback).
    // This fixes the bug where generated audio vanished on reload because
    // it was only returned as an inline base64 data URL with no persistence.
    const { durableUrl, persisted } = await persistAudio(userId, base64Audio, prompt, voice);

    // Register in generation_jobs so the audio appears in the Asset Lake.
    // The Asset Lake generation-job adapter maps "speech" → "audio" kind
    // and extracts the URL from metadata.durableUrl.
    let generationJobId: string | null = null;
    let assetId: string | null = null;
    let assetPersistenceFailed = false;
    const internalUserId = await resolveInternalUserId(userId);
    if (internalUserId && persisted) {
      try {
        const jobId = crypto.randomUUID();
        await createGenerationJob({
          id: jobId,
          userId: internalUserId,
          modality: "speech",
          provider: "gemini",
          model: "gemini-2.5-flash-preview-tts",
          prompt: finalPrompt,
          requestId: `tts_${userId}_${Date.now()}`,
          littBitsCharged: audioExempt ? 0 : COST,
          metadata: {
            durableUrl,
            contentType: "audio/wav",
            voice,
            styleDirection: styleDirection || undefined,
          },
        });
        await completeGenerationJob(jobId, `generation_job:${jobId}`);
        generationJobId = jobId;
        assetId = `generation_job:${jobId}`;
      } catch {
        assetPersistenceFailed = true;
      }
    } else if (!persisted) {
      assetPersistenceFailed = true;
    }

    return NextResponse.json({
      audioBase64: `data:audio/wav;base64,${base64Audio}`,
      audioUrl: durableUrl,
      cost: COST,
      balance: audioBalance,
      generationJobId,
      assetId,
      assetPersistenceFailed,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "TTS failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
