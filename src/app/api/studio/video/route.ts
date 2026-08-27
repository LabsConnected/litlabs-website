import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { adjustWalletBalance, getCreditBalances } from "@/lib/wallet-ledger";
import { isBillingExempt, getActiveSimulation } from "@/lib/owner";
import {
  getVideoTier,
  type VideoAspectRatio,
} from "@/config/video-tiers";

const FAL_API_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY;

async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      prompt,
      tierId = "draft",
      aspectRatio = "16:9",
    } = body as {
      prompt?: string;
      tierId?: string;
      aspectRatio?: VideoAspectRatio;
    };

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return NextResponse.json(
        { error: "Prompt must be at least 3 characters" },
        { status: 400 },
      );
    }

    const tier = getVideoTier(tierId);
    if (!tier) {
      return NextResponse.json(
        { error: `Unknown video tier: ${tierId}` },
        { status: 400 },
      );
    }

    if (!tier.enabled) {
      return NextResponse.json(
        { error: `${tier.name} is coming soon. Try Draft, Quality, or Video with Audio.` },
        { status: 503 },
      );
    }

    // Check billing exemption — owner skips balance check and debit
    const studioVideoSim = await getActiveSimulation().catch(() => null);
    const studioVideoExempt = isBillingExempt(userId, studioVideoSim);
    let studioBalance: number | null = null;

    if (!studioVideoExempt) {
      // Check balance
      const balances = await getCreditBalances(userId);
      if (balances.total < tier.priceLiTTBits) {
        return NextResponse.json(
          {
            error: `Need ${tier.priceLiTTBits} LiTTBits for ${tier.name}. You have ${balances.total}.`,
            required: tier.priceLiTTBits,
            balance: balances.total,
          },
          { status: 402 },
        );
      }

      // Reserve LiTTBits (atomic debit)
      const adjustment = await adjustWalletBalance({
        clerkId: userId,
        amount: -tier.priceLiTTBits,
        type: "spend",
        reason: `Video: ${tier.name} — ${tier.maxDuration}s clip`,
        idempotencyKey: `video_${tierId}_${userId}_${Date.now()}`,
      });

      if (adjustment.replayed) {
        return NextResponse.json(
          { error: "This video request was already processed." },
          { status: 409 },
        );
      }
      studioBalance = adjustment.balance;
    }

    // Submit to fal.ai
    if (!FAL_API_KEY) {
      return NextResponse.json(
        {
          error: "Video provider not configured. Set FAL_KEY environment variable.",
          setup_required: true,
        },
        { status: 503 },
      );
    }

    const falResponse = await fetch("https://fal.run/fal-ai/" + tier.model, {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: prompt.trim(),
        duration: tier.maxDuration,
        aspect_ratio: aspectRatio,
        resolution: tier.resolution,
      }),
    });

    if (!falResponse.ok) {
      // Refund the reserved LiTTBits on failure (skip if exempt)
      if (!studioVideoExempt) {
        await adjustWalletBalance({
          clerkId: userId,
          amount: tier.priceLiTTBits,
          type: "refund",
          reason: `Video refund: ${tier.name} failed (provider error ${falResponse.status})`,
          idempotencyKey: `video_refund_${tierId}_${userId}_${Date.now()}`,
        });
      }

      const errText = await falResponse.text().catch(() => "");
      return NextResponse.json(
        { error: `Video provider error: ${falResponse.status} ${errText.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const result = await falResponse.json();

    return NextResponse.json({
      tier: tier.id,
      tierName: tier.name,
      model: tier.model,
      cost: tier.priceLiTTBits,
      balance: studioBalance,
      videoUrl: result.video?.url ?? result.url ?? null,
      requestId: result.request_id ?? null,
      status: "completed",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Video generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 60, 60);
