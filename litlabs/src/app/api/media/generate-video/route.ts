import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserWallet, updateWalletBalance } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const COST = 5;

async function handler(req: NextRequest) {
  const { userId } = await auth();
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
      { error: `Need ${COST} LiTBit Coins` },
      { status: 402 },
    );
  }

  try {
    const body = await req.json();
    const {
      prompt,
      aspectRatio = "16:9",
      resolution = "720p",
      imageBytes,
      mimeType,
      model = "veo-3.1-fast-generate-preview",
    } = body;
    if (!prompt?.trim())
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const config = {
      numberOfVideos: 1,
      resolution: resolution === "1080p" ? "1080p" : "720p",
      aspectRatio: aspectRatio || "16:9",
    };

    const payload: {
      model: string;
      prompt: string;
      config: typeof config;
      image?: { imageBytes: string; mimeType: string };
    } = { model, prompt: prompt.trim(), config };
    if (imageBytes) {
      payload.image = { imageBytes, mimeType: mimeType || "image/png" };
    }

    const operation = await ai.models.generateVideos(payload);
    if (!operation.name) {
      throw new Error(
        "Video generation failed to return an operation identifier.",
      );
    }

    // Deduct coins
    const newBalance = await updateWalletBalance(userId, -COST);

    return NextResponse.json({
      operationName: operation.name,
      cost: COST,
      balance: newBalance,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Video generation failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
