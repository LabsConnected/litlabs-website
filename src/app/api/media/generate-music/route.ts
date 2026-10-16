import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { withRateLimit } from "@/lib/rate-limiter";
import { isBillingExempt, getActiveSimulation } from "@/lib/owner";
import { GoogleGenAI, Modality } from "@google/genai";
import { calculateRetailBits } from "@/lib/generation/cost-engine";
import {
  assertGenerationWithinPlanCaps,
  planLimitResponse,
  releaseMediaCapHold,
  settleMediaCapHold,
} from "@/lib/generation/enforce-media-caps";
import { resolveInternalUserId } from "@/lib/generation/identity";
import { buildChargeRating } from "@/lib/billing/canonical-pricing";

// ── Route configuration ──────────────────────────────────────────
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  let claimedRequestId: string | null = null;
  try {
    const {
      prompt,
      model = "lyria-3-clip-preview",
      imageBytes,
      mimeType,
      requestId: clientRequestId,
    } = await req.json();
    // Stable key for the debit — client retries with the same requestId
    // can never double-charge.
    const requestId = clientRequestId || crypto.randomUUID();
    if (!prompt?.trim())
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });

    const musicSim = await getActiveSimulation().catch(() => null);
    const musicExempt = isBillingExempt(userId, musicSim);
    const costResult = calculateRetailBits({
      modality: "music",
      provider: "google",
      model,
    });
    const musicLimit = await assertGenerationWithinPlanCaps({
      clerkId: userId,
      requestId,
      modality: "music",
      provider: "google",
      model,
      providerCostCents: costResult.providerCostCents,
      billingExempt: musicExempt,
    });
    if (musicLimit) return planLimitResponse(musicLimit);
    claimedRequestId = requestId;

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

    let musicBalance: number | null = null;
    if (musicExempt) {
      try {
        const balances = await getCreditBalances(userId);
        musicBalance = balances.total;
      } catch {
        musicBalance = null;
      }
    } else {
      // Atomic debit via canonical ledger — keyed on requestId.
      const reservation = await adjustWalletBalance({
        clerkId: userId,
        amount: -COST,
        type: "spend",
        reason: `Music: model=${model}`,
        idempotencyKey: `music:charge:${requestId}`,
        rating: buildChargeRating({
          capability: "music",
          provider: "google",
          model,
          providerCostMicros: costResult.providerCostCents * 10_000,
          bitsCharged: COST,
          billingClass: "flat",
          lane: "flat",
        }),
      });
      musicBalance = reservation.balance;
    }

    const internalUserId = await resolveInternalUserId(userId).catch(() => null);
    if (internalUserId) {
      await settleMediaCapHold({ internalUserId, requestId }).catch(() => undefined);
    }
    claimedRequestId = null;

    return NextResponse.json({
      audioBase64: `data:${audioMime};base64,${audioPart.inlineData.data}`,
      cost: COST,
      balance: musicBalance,
    });
  } catch (err: unknown) {
    if (claimedRequestId) {
      const internalUserId = await resolveInternalUserId(userId).catch(() => null);
      if (internalUserId) {
        await releaseMediaCapHold({
          internalUserId,
          requestId: claimedRequestId,
        }).catch(() => undefined);
      }
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Music generation failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
