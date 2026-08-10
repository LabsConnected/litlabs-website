import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { withRateLimit } from "@/lib/rate-limiter";
import { GoogleGenAI, Modality } from "@google/genai";

// ── Route configuration ──────────────────────────────────────────
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  // Check balance using canonical ledger
  const balances = await getCreditBalances(userId);
  if (balances.total < COST) {
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
    const allParts = response.candidates?.[0]?.content?.parts ?? [];
    const audioPart = allParts.find((p) => p.inlineData?.data);
    if (!audioPart?.inlineData?.data) {
      throw new Error("Music generation returned empty audio.");
    }

    const audioMime = audioPart.inlineData.mimeType || "audio/mp3";

    // Atomic debit via canonical ledger
    const reservation = await adjustWalletBalance({
      clerkId: userId,
      amount: -COST,
      type: "spend",
      reason: `Music: model=${model}`,
      idempotencyKey: `music_${userId}_${Date.now()}`,
    });

    return NextResponse.json({
      audioBase64: `data:${audioMime};base64,${audioPart.inlineData.data}`,
      cost: COST,
      balance: reservation.balance,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Music generation failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
