import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import { adjustWalletBalance } from "@/lib/wallet-ledger";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY)
    return NextResponse.json(
      { error: "Gemini API key not configured" },
      { status: 500 },
    );

  try {
    const { operationName, cost = 0, model = "veo" } = await req.json();
    if (!operationName)
      return NextResponse.json(
        { error: "Missing operationName" },
        { status: 400 },
      );

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const op = new GenerateVideosOperation();
    op.name = operationName;

    const updated = await ai.operations.getVideosOperation({ operation: op });

    // If done, get the video URI
    let videoUri: string | null = null;
    if (updated.done && updated.response?.generatedVideos?.[0]?.video?.uri) {
      videoUri = updated.response.generatedVideos[0].video.uri;
    }

    // If the operation failed (done but no video), refund the user
    if (updated.done && !videoUri && cost > 0) {
      await adjustWalletBalance({
        clerkId: userId,
        amount: cost,
        type: "refund",
        reason: `Video refund: ${model} operation failed (no video output)`,
        idempotencyKey: `video_refund_${operationName}`,
      });
    }

    return NextResponse.json({
      done: updated.done,
      videoUri,
      refunded: updated.done && !videoUri && cost > 0,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Polling failed" },
      { status: 500 },
    );
  }
}
