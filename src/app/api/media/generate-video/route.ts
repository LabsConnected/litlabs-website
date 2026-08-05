import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { withRateLimit } from "@/lib/rate-limiter";
import { GoogleGenAI } from "@google/genai";
import { submitAlibabaVideoTask, isAlibabaConfigured } from "@/lib/alibaba-video";

// ── Route configuration ──────────────────────────────────────────
// Video generation is long-running; needs headroom beyond the default
// 10s function timeout, otherwise Vercel returns an HTML 504 page.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const {
      prompt,
      aspectRatio = "16:9",
      resolution = "720p",
      imageBytes,
      mimeType,
      model = "veo-3.1-fast-generate-preview",
      imageUrl, // public HTTPS URL for Alibaba i2v
      duration = 5,
      cost = 5,
    } = body;

    // ── Alibaba HappyHorse path (image-to-video) ──────────────────────
    if (model.startsWith("happyhorse")) {
      if (!isAlibabaConfigured())
        return NextResponse.json(
          { error: "Alibaba video not configured. Set ALIBABA_DASHSCOPE_API_KEY and ALIBABA_MODELSTUDIO_WORKSPACE_ID." },
          { status: 503 },
        );
      if (!imageUrl)
        return NextResponse.json(
          { error: "A public image URL is required for HappyHorse image-to-video." },
          { status: 400 },
        );

      // Check balance
      const balances = await getCreditBalances(userId);
      if (balances.total < cost)
        return NextResponse.json({ error: `Need ${cost} LiTTBits` }, { status: 402 });

      // Reserve LiTTBits (atomic debit — refunded on failure)
      const reservation = await adjustWalletBalance({
        clerkId: userId,
        amount: -cost,
        type: "spend",
        reason: `Video: ${model} — Alibaba i2v`,
        idempotencyKey: `video_${model}_${userId}_${Date.now()}`,
      });

      if (reservation.replayed) {
        return NextResponse.json(
          { error: "This video request was already processed." },
          { status: 409 },
        );
      }

      try {
        const result = await submitAlibabaVideoTask({
          model,
          prompt: prompt?.trim(),
          imageUrl,
          resolution: resolution === "1080p" ? "1080P" : "720P",
          duration: Math.min(Math.max(Number(duration) || 5, 3), 15),
        });

        return NextResponse.json({
          provider: "alibaba",
          taskId: result.taskId,
          taskStatus: result.taskStatus,
          cost,
          balance: reservation.balance,
        });
      } catch (submitErr) {
        // Refund the reserved LiTTBits on submission failure
        await adjustWalletBalance({
          clerkId: userId,
          amount: cost,
          type: "refund",
          reason: `Video refund: ${model} submission failed`,
          idempotencyKey: `video_refund_${model}_${userId}_${Date.now()}`,
        });
        throw submitErr;
      }
    }

    // ── Google Veo path (default) ─────────────────────────────────────
    if (!GEMINI_API_KEY)
      return NextResponse.json(
        { error: "Gemini API key not configured" },
        { status: 500 },
      );

    // Check balance
    const balances = await getCreditBalances(userId);
    if (balances.total < cost) {
      return NextResponse.json(
        { error: `Need ${cost} LiTTBits` },
        { status: 402 },
      );
    }

    if (!prompt?.trim())
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });

    // Reserve LiTTBits (atomic debit — refunded on failure)
    const reservation = await adjustWalletBalance({
      clerkId: userId,
      amount: -cost,
      type: "spend",
      reason: `Video: ${model} — Veo generation`,
      idempotencyKey: `video_${model}_${userId}_${Date.now()}`,
    });

    if (reservation.replayed) {
      return NextResponse.json(
        { error: "This video request was already processed." },
        { status: 409 },
      );
    }

    try {
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

      return NextResponse.json({
        provider: "veo",
        operationName: operation.name,
        cost,
        balance: reservation.balance,
      });
    } catch (genErr) {
      // Refund the reserved LiTTBits on generation failure
      await adjustWalletBalance({
        clerkId: userId,
        amount: cost,
        type: "refund",
        reason: `Video refund: ${model} generation failed`,
        idempotencyKey: `video_refund_${model}_${userId}_${Date.now()}`,
      });
      throw genErr;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Video generation failed";
    return NextResponse.json(
      { error: msg },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
