import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { withRateLimit } from "@/lib/rate-limiter";
import { GoogleGenAI } from "@google/genai";
import { submitAlibabaVideoTask, isAlibabaConfigured } from "@/lib/alibaba-video";
import { getVideoModel, getVideoModelPricing } from "@/lib/studio-models";
import { createVideoJob } from "@/lib/video-jobs";

// ── Route configuration ──────────────────────────────────────────
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
      model: clientModel = "veo",
      imageUrl, // public HTTPS URL for Alibaba i2v
    } = body;
    let duration = body.duration ?? 5;

    // ── Server-authoritative model resolution ──────────────────────
    // Resolve the model from our registry — never trust client cost.
    const videoModel = getVideoModel(clientModel);
    if (!videoModel || !videoModel.available) {
      return NextResponse.json(
        { error: `Video model "${clientModel}" is not available.` },
        { status: 400 },
      );
    }
    const cost = getVideoModelPricing(videoModel.id);
    const model = videoModel.apiModel;
    const isHappyHorse = videoModel.id === "happyhorse";

    // ── Validate capabilities ──────────────────────────────────────
    const caps = videoModel.capabilities;

    // Validate aspect ratio
    if (!caps.aspectRatios.includes(aspectRatio)) {
      return NextResponse.json(
        { error: `Aspect ratio ${aspectRatio} is not supported by ${videoModel.label}.` },
        { status: 400 },
      );
    }

    // Validate resolution
    if (!caps.resolutions.includes(resolution)) {
      return NextResponse.json(
        { error: `Resolution ${resolution} is not supported by ${videoModel.label}.` },
        { status: 400 },
      );
    }

    // Validate duration if the model supports it
    if (caps.durations.length > 0 && !caps.durations.includes(Number(duration))) {
      // Clamp to nearest supported duration instead of rejecting
      const nearest = caps.durations.reduce((prev, curr) =>
        Math.abs(curr - Number(duration)) < Math.abs(prev - Number(duration)) ? curr : prev,
      );
      duration = nearest;
    }

    // ── Alibaba HappyHorse path (image-to-video) ──────────────────────
    if (isHappyHorse) {
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
        reason: `Video: ${videoModel.label} — Alibaba i2v`,
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

        // Store job for server-authoritative refund tracking
        const jobId = `alibaba_${result.taskId}`;
        createVideoJob({
          jobId,
          userId,
          provider: "alibaba",
          providerOperationId: result.taskId,
          model: videoModel.id,
          cost,
          status: "pending",
          createdAt: Date.now(),
          charged: true,
          refunded: false,
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
          reason: `Video refund: ${videoModel.label} submission failed`,
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
      reason: `Video: ${videoModel.label} — Veo generation`,
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

      const config: Record<string, unknown> = {
        numberOfVideos: 1,
        resolution: resolution === "1080p" ? "1080p" : "720p",
        aspectRatio: aspectRatio || "16:9",
      };

      // Send duration to Veo if the model supports it
      if (caps.durations.length > 0) {
        config.durationSeconds = Number(duration);
      }

      const payload: {
        model: string;
        prompt: string;
        config: typeof config;
        image?: { imageBytes: string; mimeType: string };
      } = { model, prompt: prompt.trim(), config };

      // Send reference image to Veo if provided and supported
      if (imageBytes && caps.supportsReferenceImage) {
        payload.image = { imageBytes, mimeType: mimeType || "image/png" };
      }

      const operation = await ai.models.generateVideos(payload);
      if (!operation.name) {
        throw new Error(
          "Video generation failed to return an operation identifier.",
        );
      }

      // Store job for server-authoritative refund tracking
      const jobId = `veo_${operation.name}`;
      createVideoJob({
        jobId,
        userId,
        provider: "veo",
        providerOperationId: operation.name,
        model: videoModel.id,
        cost,
        status: "pending",
        createdAt: Date.now(),
        charged: true,
        refunded: false,
      });

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
        reason: `Video refund: ${videoModel.label} generation failed`,
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
