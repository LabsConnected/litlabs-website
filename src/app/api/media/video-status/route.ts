import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import { adjustWalletBalance } from "@/lib/wallet-ledger";
import { findJobByOperationId, markVideoJobRefunded } from "@/lib/video-jobs";

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
    const { operationName } = await req.json();
    if (!operationName)
      return NextResponse.json(
        { error: "Missing operationName" },
        { status: 400 },
      );

    // ── Server-authoritative cost resolution ──────────────────────
    // Never trust client-supplied cost — resolve from the job store.
    const job = findJobByOperationId(operationName);
    if (!job) {
      return NextResponse.json(
        { error: "Video job not found. Cost must be resolved server-side." },
        { status: 404 },
      );
    }

    // Verify the job belongs to the authenticated user
    if (job.userId !== userId) {
      return NextResponse.json(
        { error: "Video job does not belong to this user." },
        { status: 403 },
      );
    }

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
    // using the server-authoritative cost from the job store.
    let refunded = false;
    if (updated.done && !videoUri) {
      // Idempotent refund — can only happen once per job
      const canRefund = markVideoJobRefunded(job.jobId);
      if (canRefund && job.cost > 0) {
        await adjustWalletBalance({
          clerkId: userId,
          amount: job.cost,
          type: "refund",
          reason: `Video refund: ${job.model} operation failed (no video output)`,
          idempotencyKey: `video_refund_${operationName}`,
        });
        refunded = true;
      }
    }

    return NextResponse.json({
      done: updated.done,
      videoUri,
      refunded,
      cost: job.cost,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Polling failed" },
      { status: 500 },
    );
  }
}
