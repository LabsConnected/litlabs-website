import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserWallet, updateWalletBalance } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import { GoogleGenAI, Modality } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const COST = 3;

async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY)
    return NextResponse.json(
      { error: "Gemini API key not configured" },
      { status: 500 },
    );

  const wallet = await getUserWallet(userId);
  if (wallet.balance < COST) {
    return NextResponse.json(
      { error: `Need ${COST} LiTTBits` },
      { status: 402 },
    );
  }

  try {
    const {
      prompt,
      model = "lyria-3-clip-preview",
      imageBytes,
      mimeType,
    } = await req.json();
    if (!prompt?.trim())
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const parts: Array<
      { text: string } | { inlineData: { data: string; mimeType: string } }
    > = [{ text: prompt.trim() }];
    if (imageBytes) {
      parts.push({
        inlineData: { data: imageBytes, mimeType: mimeType || "image/jpg" },
      });
    }

    const response = await ai.models.generateContent({
      model,
      contents: { parts },
      config: { responseModalities: [Modality.AUDIO] },
    });

    // Lyria can return both audio and text (lyrics) parts.
    // Find the audio part — don't assume the first part is audio.
    const allParts = response.candidates?.[0]?.content?.parts ?? [];
    const audioPart = allParts.find((p) => p.inlineData?.data);
    if (!audioPart?.inlineData?.data) {
      throw new Error("Music generation returned empty audio.");
    }

    // Lyria Clip output is MP3, not WAV.
    const audioMime = audioPart.inlineData.mimeType || "audio/mp3";
    const newBalance = await updateWalletBalance(userId, -COST);

    return NextResponse.json({
      audioBase64: `data:${audioMime};base64,${audioPart.inlineData.data}`,
      cost: COST,
      balance: newBalance,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Music generation failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
