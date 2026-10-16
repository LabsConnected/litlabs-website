import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { GoogleGenAI, Modality } from "@google/genai";
import { withRateLimit } from "@/lib/rate-limiter";
import { emitUsageEvent } from "@/lib/metering";
import { calculateRetailBits } from "@/lib/generation/cost-engine";
import {
  assertGenerationWithinPlanCaps,
  planLimitResponse,
  releaseMediaCapHold,
  settleMediaCapHold,
} from "@/lib/generation/enforce-media-caps";
import { resolveInternalUserId } from "@/lib/generation/identity";

async function handler(request: NextRequest) {
  const { userId, clerkId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let openHold: string | null = null;
  const clerk = clerkId ?? userId;
  async function settleOpen() {
    const requestId = openHold;
    if (!requestId) return;
    openHold = null;
    const internalUserId = await resolveInternalUserId(clerk).catch(() => null);
    if (!internalUserId) return;
    await settleMediaCapHold({ internalUserId, requestId }).catch(() => undefined);
  }
  async function releaseOpen() {
    const requestId = openHold;
    if (!requestId) return;
    openHold = null;
    const internalUserId = await resolveInternalUserId(clerk).catch(() => null);
    if (!internalUserId) return;
    await releaseMediaCapHold({ internalUserId, requestId }).catch(() => undefined);
  }
  try {
    const body = await request.json();
    const { prompt, provider, aspectRatio, batchSize = 1 } = body;

    // Validate prompt
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 },
      );
    }

    if (prompt.length < 3) {
      return NextResponse.json(
        { error: "Prompt must be at least 3 characters" },
        { status: 400 },
      );
    }

    // Calculate dimensions based on aspect ratio
    const getDimensions = (ratio: string) => {
      const [w, h] = ratio.split(":").map(Number);
      if (!w || !h) return { width: 1024, height: 1024 };
      // Scale to reasonable image size while maintaining aspect
      const scale = Math.min(1024 / w, 1024 / h);
      return {
        width: Math.round(w * scale),
        height: Math.round(h * scale),
      };
    };

    const { width, height } = getDimensions(aspectRatio || "1:1");
    const batchCount = Math.min(Math.max(Number(batchSize) || 1, 1), 4);

    async function reserve(opts: {
      requestId: string;
      provider: string;
      model: string;
      providerCostCents: number;
      units?: number;
    }) {
      const denial = await assertGenerationWithinPlanCaps({
        clerkId: clerk,
        requestId: opts.requestId,
        modality: "image",
        provider: opts.provider,
        model: opts.model,
        providerCostCents: opts.providerCostCents,
        units: opts.units,
      });
      if (!denial) openHold = opts.requestId;
      return denial;
    }

    // Pollinations.ai fallback (always works, no API key needed)
    if (provider === "pollinations" || !provider) {
      const pollinationsLimit = await reserve({
        requestId: `studio:${clerk}:pollinations:${crypto.randomUUID()}`,
        provider: "pollinations",
        model: "flux",
        providerCostCents: 0,
        units: batchCount,
      });
      if (pollinationsLimit) return planLimitResponse(pollinationsLimit);
      // Use a stable seed based on prompt hash to prevent infinite reloading
      const promptHash = prompt
        .split("")
        .reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const baseSeed = promptHash % 1000000;

      const images = Array.from({ length: Math.min(batchSize, 4) }, (_, i) => ({
        url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&n=${batchSize}${batchSize > 1 ? `&index=${i}` : ""}&seed=${baseSeed + i}&noCache=true`,
        prompt,
        provider: "pollinations",
        timestamp: Date.now(),
      }));

      await settleOpen();
      return NextResponse.json({
        images,
        provider: "pollinations",
        free: true,
      });
    }

    // For other providers, try to use their APIs if keys are available
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    // Canonical metering: one usage_event per Gemini image attempt (the
    // pollinations branch above is free — no provider cost to record).
    // P0 invariant: this single attempt is THE billable usage_event
    // (emitter defaults billable=true on success); failures are
    // billable=false. Image models are not token-priced and the cost
    // engine has no image calculator yet, so providerCostMicros is
    // recorded as 0 with imageCount 1 — not a claim that the model is
    // free. Currently uncharged: chargedBits stays 0.
    const meteringRequestId = crypto.randomUUID();
    const meteringStartedAt = new Date();

    if (provider === "gemini" && GEMINI_API_KEY) {
      try {
        // Migrated from deprecated Imagen 3 to Nano Banana (gemini-2.5-flash-image).
        // Imagen 3 shuts down August 17, 2026.
        const imageModel = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
        const geminiCents = calculateRetailBits({
          modality: "image",
          provider: "gemini",
          model: imageModel,
        }).providerCostCents;
        const geminiLimit = await reserve({
          requestId: meteringRequestId,
          provider: "gemini",
          model: imageModel,
          providerCostCents: geminiCents,
        });
        if (geminiLimit) return planLimitResponse(geminiLimit);
        let geminiDelivered = false;
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

        const response = await ai.models.generateContent({
          model: imageModel,
          contents: prompt.trim(),
          config: {
            responseModalities: [Modality.IMAGE],
          },
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const imagePart = parts.find((p) => p.inlineData?.data);
        if (!imagePart?.inlineData?.data) {
          // Provider call succeeded but yielded no image — meter the
          // attempt (failed, non-billable) before the pollinations fallback.
          void emitUsageEvent({
            clerkId: clerkId ?? undefined,
            feature: "studio-generate",
            capability: "image",
            provider: "gemini",
            model: imageModel,
            providerCostMicros: 0,
            chargedBits: 0,
            status: "failed",
            billable: false,
            error: "no-image-part-in-response",
            idempotencyKey: `metering:image:${meteringRequestId}:0`,
            startedAt: meteringStartedAt,
            finishedAt: new Date(),
          });
        } else {
          const mimeType = imagePart.inlineData.mimeType || "image/png";
          void emitUsageEvent({
            clerkId: clerkId ?? undefined,
            feature: "studio-generate",
            capability: "image",
            provider: "gemini",
            model: imageModel,
            imageCount: 1,
            providerCostMicros: 0, // see comment above — engine lacks an image cost calculator
            chargedBits: 0,
            status: "success",
            idempotencyKey: `metering:image:${meteringRequestId}:0`,
            startedAt: meteringStartedAt,
            finishedAt: new Date(),
          });
          geminiDelivered = true;
          await settleOpen();
          return NextResponse.json({
            images: [
              {
                url: `data:${mimeType};base64,${imagePart.inlineData.data}`,
                prompt,
                provider: "gemini",
                timestamp: Date.now(),
              },
            ],
            provider: "gemini",
            cost: 1,
          });
        }
        if (!geminiDelivered) {
          await releaseOpen();
        }
      } catch (geminiErr) {
        await releaseOpen();
        // Silenced for the caller (falls back to pollinations below), but
        // the failed attempt is still metered for retry-waste analysis.
        void emitUsageEvent({
          clerkId: clerkId ?? undefined,
          feature: "studio-generate",
          capability: "image",
          provider: "gemini",
          model: process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image",
          providerCostMicros: 0,
          chargedBits: 0,
          status: "failed",
          billable: false,
          error: geminiErr instanceof Error ? geminiErr.message.slice(0, 500) : "Gemini image generation failed",
          idempotencyKey: `metering:image:${meteringRequestId}:0`,
          startedAt: meteringStartedAt,
          finishedAt: new Date(),
        });
      }
    }

    // Default fallback to pollinations with stable seed
    const fallbackLimit = await reserve({
      requestId: `studio:${clerk}:pollinations-fallback:${meteringRequestId}`,
      provider: "pollinations",
      model: "flux",
      providerCostCents: 0,
    });
    if (fallbackLimit) return planLimitResponse(fallbackLimit);
    const promptHash2 = prompt
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const stableSeed = promptHash2 % 1000000;

    await settleOpen();
    return NextResponse.json({
      images: [
        {
          url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${stableSeed}`,
          prompt,
          provider: "pollinations",
          timestamp: Date.now(),
        },
      ],
      provider: "pollinations",
      free: true,
      note:
        provider !== "pollinations"
          ? "API key not configured, using free fallback"
          : undefined,
    });
  } catch {
    await releaseOpen();
    return NextResponse.json(
      { error: "Failed to generate image" },
      { status: 500 },
    );
  }
}

// Also handle GET for health check
async function getHandler() {
  return NextResponse.json({
    status: "ok",
    providers: [
      "pollinations",
      "gemini",
      "together",
      "fal",
      "openai",
      "recraft",
    ],
    default: "pollinations",
  });
}

export const POST = withRateLimit(handler, 10, 60);
export const GET = withRateLimit(getHandler, 30, 60);
