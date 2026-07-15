import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserWallet, updateWalletBalance } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import { sanitizeProviderError } from "@/lib/provider-error";
import { GoogleGenAI, Modality } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const COST = 2;

async function handler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY)
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 },
    );

  const wallet = await getUserWallet(userId);
  if (wallet.balance < COST) {
    return NextResponse.json(
      { error: `Need ${COST} LiTBit Coins` },
      { status: 402 },
    );
  }

  try {
    const { prompt, voice = "Kore" } = await req.json();
    if (!prompt?.trim())
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-tts-preview",
      contents: [{ parts: [{ text: prompt.trim() }] }],
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

    const newBalance = await updateWalletBalance(userId, -COST);

    return NextResponse.json({
      audioBase64: `data:audio/wav;base64,${base64Audio}`,
      cost: COST,
      balance: newBalance,
    });
  } catch (err: unknown) {
    console.error("[api/media/generate-audio] error:", err);
    const { status, error: message, retryAfter } = sanitizeProviderError(err);
    return NextResponse.json(
      { error: message, retryAfter },
      { status },
    );
  }
}

export const POST = withRateLimit(handler, 10, 60);
