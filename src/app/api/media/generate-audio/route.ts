import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { withRateLimit } from "@/lib/rate-limiter";
import { GoogleGenAI, Modality } from "@google/genai";

// ── Route configuration ──────────────────────────────────────────
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const COST = 2;

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

    // Atomic debit via canonical ledger
    const reservation = await adjustWalletBalance({
      clerkId: userId,
      amount: -COST,
      type: "spend",
      reason: `TTS: voice=${voice}`,
      idempotencyKey: `tts_${userId}_${Date.now()}`,
    });

    return NextResponse.json({
      audioBase64: `data:audio/wav;base64,${base64Audio}`,
      cost: COST,
      balance: reservation.balance,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "TTS failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
