import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCreditBalances, adjustWalletBalance } from "@/lib/wallet-ledger";
import { withRateLimit } from "@/lib/rate-limiter";
import { isBillingExempt, getActiveSimulation } from "@/lib/owner";
import { GoogleGenAI } from "@google/genai";
import { submitAlibabaVideoTask, isAlibabaConfigured } from "@/lib/alibaba-video";
import { getVideoModel, getVideoModelPricing } from "@/lib/studio-models";
import { createVideoJob } from "@/lib/video-jobs";
import { refundVideoCharge } from "@/lib/video-refunds";
import { calculateRetailBits } from "@/lib/generation/cost-engine";
import { buildChargeRating } from "@/lib/billing/canonical-pricing";
import {
  createGenerationJob,
  getGenerationJobByRequestId,
  updateGenerationJobStatus,
  updateGenerationJobMetadata,
  failGenerationJob,
  setGenerationRefundStatus,
} from "@/lib/generation/jobs";
import type { RefundStatus } from "@/lib/generation/types";
import { resolveInternalUserId } from "@/lib/generation/identity";

// ── Route configuration ──────────────────────────────────────────
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read at request time (not module load) so tests and key rotation see the
// current value, and a missing key fails before any debit.

// ── Staged-refund helpers (P1-3) ─────────────────────────────────
// The pipeline stages are: validation → debit → provider submission →
// outcome polling. Every stage that can hold user LiTTBits records its
// outcome on the durable generation_jobs row so a refund is never lost.

/**
 * Create the durable generation_jobs row BEFORE the debit, in `queued`
 * state. Returns the row id, or null when it could not be recorded —
 * in which case the caller must fail WITHOUT debiting.
 */
async function createQueuedVideoRow(opts: {
  internalUserId: string;
  provider: string;
  model: string;
  prompt: string;
  requestId: string;
  littBitsCharged: number;
  aspectRatio: string;
  resolution: string;
  duration: number;
}): Promise<string | null> {
  const row = await createGenerationJob({
    id: crypto.randomUUID(),
    userId: opts.internalUserId,
    modality: "video",
    provider: opts.provider,
    model: opts.model,
    prompt: opts.prompt ?? "",
    requestId: opts.requestId,
    littBitsCharged: opts.littBitsCharged,
    metadata: {
      aspectRatio: opts.aspectRatio,
      resolution: opts.resolution,
      duration: opts.duration,
    },
  });
  return row ? row.id : null;
}

/**
 * Settle a failed provider submission: refund the debit (bounded retries,
 * exactly-once via the wallet idempotency key), record the outcome on the
 * durable row, and build the honest error to surface.
 *
 * Never throws — the refund outcome is always recorded, so a `pending`
 * refund can be completed by a later retry with the same requestId.
 */
async function settleFailedSubmission(opts: {
  genRowId: string | null;
  userId: string;
  exempt: boolean;
  cost: number;
  modelLabel: string;
  requestId: string;
  submitErr: unknown;
}): Promise<Error> {
  let refundStatus: RefundStatus = "none";
  if (!opts.exempt) {
    const r = await refundVideoCharge({
      clerkId: opts.userId,
      amount: opts.cost,
      reason: `Video refund: ${opts.modelLabel} submission failed`,
      idempotencyKey: `video:refund:${opts.requestId}`,
    });
    refundStatus = r.ok ? "refunded" : "pending";
  }
  if (opts.genRowId) {
    const msg =
      opts.submitErr instanceof Error
        ? opts.submitErr.message
        : "Video submission failed";
    await failGenerationJob(opts.genRowId, msg, refundStatus);
  }
  const baseMsg =
    opts.submitErr instanceof Error
      ? opts.submitErr.message
      : "Video submission failed";
  return new Error(
    refundStatus === "pending"
      ? `${baseMsg} (LiTTBits charge of ${opts.cost} is pending automatic refund)`
      : baseMsg,
  );
}

async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Resolve Clerk ID → internal public.users.id UUID.
  // generation_jobs.user_id requires the internal UUID, NOT the Clerk ID.
  // Wallet operations and video-jobs still use the Clerk ID.
  const internalUserId = await resolveInternalUserId(userId);

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
      requestId: clientRequestId, // client-provided for idempotent retries
    } = body;
    let duration = body.duration ?? 5;

    // ── Idempotency: use client-provided requestId or generate one ──
    // The same requestId across retries prevents double-charging.
    const requestId = clientRequestId || crypto.randomUUID();

    // ── Cost calculation (server-authoritative) ────────────────────
    // Use the cost engine for real provider-cost-based pricing.
    // Fall back to registry pricing if the cost engine returns lower.

    // ── Server-authoritative model resolution ──────────────────────
    // Resolve the model from our registry — never trust client cost.
    const videoModel = getVideoModel(clientModel);
    if (!videoModel || !videoModel.available) {
      return NextResponse.json(
        { error: `Video model "${clientModel}" is not available.` },
        { status: 400 },
      );
    }
    const registryCost = getVideoModelPricing(videoModel.id);
    const costResult = calculateRetailBits({
      modality: "video",
      provider: videoModel.id === "happyhorse" ? "alibaba" : "veo",
      model: videoModel.apiModel,
      durationSeconds: Number(duration),
      resolution,
    });
    const cost = Math.max(registryCost, costResult.retailLiTTBits);
    const model = videoModel.apiModel;
    const isHappyHorse = videoModel.id === "happyhorse";

    // ── Idempotency: check for existing job ────────────────────────
    // Uses internal UUID, not Clerk ID.
    const existingJob = internalUserId
      ? await getGenerationJobByRequestId(internalUserId, requestId)
      : null;
    if (existingJob && (existingJob.status === "completed" || existingJob.status === "generating")) {
      return NextResponse.json({
        provider: existingJob.provider,
        operationName: existingJob.providerJobId,
        taskId: existingJob.providerJobId,
        taskStatus: existingJob.status === "completed" ? "SUCCEEDED" : "PENDING",
        cost: existingJob.littBitsCharged,
        balance: null,
        replayed: true,
      });
    }
    // A previous attempt failed after debiting but its refund never
    // completed (recorded as `pending`). The client is retrying with the
    // same requestId: take another shot at completing that refund now.
    // The wallet idempotency key makes this exactly-once.
    if (
      existingJob &&
      existingJob.status === "failed" &&
      existingJob.refundStatus === "pending" &&
      existingJob.littBitsCharged > 0
    ) {
      const rr = await refundVideoCharge({
        clerkId: userId,
        amount: existingJob.littBitsCharged,
        reason: `Video refund retry: ${existingJob.model} submission failed`,
        idempotencyKey: `video:refund:${requestId}`,
      });
      await setGenerationRefundStatus(
        existingJob.id,
        rr.ok ? "refunded" : "pending",
      );
    }

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

    // Prompt is required for both providers — validated before any debit.
    if (!prompt?.trim())
      return NextResponse.json({ error: "Prompt required" }, { status: 400 });

    // ── Alibaba HappyHorse path (image-to-video) ──────────────────────
    if (isHappyHorse) {
      if (!isAlibabaConfigured())
        return NextResponse.json(
          // 422, not 503: gateway statuses make the edge serve branded HTML
          // instead of this JSON body (verified in production).
          { error: "Alibaba video not configured. Set ALIBABA_DASHSCOPE_API_KEY and ALIBABA_MODELSTUDIO_WORKSPACE_ID." },
          { status: 422 },
        );
      if (!imageUrl)
        return NextResponse.json(
          { error: "A public image URL is required for HappyHorse image-to-video." },
          { status: 400 },
        );

      // Check billing exemption — owner skips balance check and debit
      const sim = await getActiveSimulation().catch(() => null);
      const exempt = isBillingExempt(userId, sim);
      let alibabaBalance: number | null = null;

      if (!exempt) {
        // Check balance
        const balances = await getCreditBalances(userId);
        if (balances.total < cost)
          return NextResponse.json({ error: `Need ${cost} LiTTBits` }, { status: 402 });
      }

      // Staged refunds: record the durable job row BEFORE the debit so
      // every later stage has a persistent anchor for charge/refund state.
      // If the row cannot be recorded, fail WITHOUT debiting.
      // Billing-exempt requests record 0 charged (nothing was debited).
      let genRowId: string | null = null;
      if (internalUserId) {
        genRowId = await createQueuedVideoRow({
          internalUserId,
          provider: "alibaba",
          model,
          prompt: prompt.trim(),
          requestId,
          littBitsCharged: exempt ? 0 : cost,
          aspectRatio,
          resolution,
          duration: Number(duration),
        });
        if (!genRowId) {
          return NextResponse.json(
            { error: "Could not record the video job. No LiTTBits were charged — please retry." },
            { status: 500 },
          );
        }
      }

      // Reserve LiTTBits (atomic debit — refunded on failure).
      // Keyed on requestId so client retries can never double-charge.
      if (!exempt) {
        let reservation;
        try {
          reservation = await adjustWalletBalance({
            clerkId: userId,
            amount: -cost,
            type: "spend",
            reason: `Video: ${videoModel.label} — Alibaba i2v`,
            idempotencyKey: `video:charge:${requestId}`,
            rating: buildChargeRating({
              capability: "video",
              provider: "alibaba",
              model,
              providerCostMicros: costResult.providerCostCents * 10_000,
              bitsCharged: cost,
              lane: "generation",
            }),
            usage: { videoSeconds: Number(duration) || 0 },
          });
        } catch (debitErr) {
          // The debit itself failed — nothing was charged.
          if (genRowId) {
            await failGenerationJob(
              genRowId,
              debitErr instanceof Error ? debitErr.message : "Debit failed",
              "none",
            );
          }
          throw debitErr;
        }

        if (reservation.replayed) {
          return NextResponse.json(
            {
              error:
                existingJob?.status === "failed"
                  ? "This video request already failed and its LiTTBits were refunded. Please start a new request."
                  : "This video request was already processed.",
            },
            { status: 409 },
          );
        }
        alibabaBalance = reservation.balance;
      }

      try {
        const result = await submitAlibabaVideoTask({
          model,
          prompt: prompt?.trim(),
          imageUrl,
          resolution: resolution === "1080p" ? "1080P" : "720P",
          duration: Math.min(Math.max(Number(duration) || 5, 3), 15),
        });

        // Store job for server-authoritative refund tracking.
        // `charged` reflects reality: billing-exempt requests never debit,
        // so the status routes must never refund them.
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
          charged: !exempt,
          refunded: false,
        });

        // Move the durable row to generating with the provider job id.
        // The status route will mark it completed with the durable URL.
        if (genRowId) {
          await updateGenerationJobStatus(genRowId, "generating", {
            providerJobId: result.taskId,
          });
          await updateGenerationJobMetadata(genRowId, {
            providerJobId: result.taskId,
            videoJobId: jobId,
          });
        }

        return NextResponse.json({
          provider: "alibaba",
          taskId: result.taskId,
          taskStatus: result.taskStatus,
          cost,
          balance: alibabaBalance,
        });
      } catch (submitErr) {
        // Staged refund: the debit happened but the provider never accepted
        // the job. Refund with bounded retries; the outcome is recorded on
        // the durable row so a pending refund is never silently lost.
        throw await settleFailedSubmission({
          genRowId,
          userId,
          exempt,
          cost,
          modelLabel: videoModel.label,
          requestId,
          submitErr,
        });
      }
    }

    // ── Google Veo path (default) ─────────────────────────────────────
    // Key check before any debit: missing key → 500 with 0 charged.
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey)
      return NextResponse.json(
        { error: "Gemini API key not configured" },
        { status: 500 },
      );

    // Check billing exemption — owner skips balance check and debit
    const veoSim = await getActiveSimulation().catch(() => null);
    const veoExempt = isBillingExempt(userId, veoSim);

    if (!veoExempt) {
      // Check balance
      const balances = await getCreditBalances(userId);
      if (balances.total < cost) {
        return NextResponse.json(
          { error: `Need ${cost} LiTTBits` },
          { status: 402 },
        );
      }
    }

    // Staged refunds: record the durable job row BEFORE the debit (see
    // the Alibaba path above for the rationale).
    let veoGenRowId: string | null = null;
    if (internalUserId) {
      veoGenRowId = await createQueuedVideoRow({
        internalUserId,
        provider: "veo",
        model,
        prompt: prompt.trim(),
        requestId,
        littBitsCharged: veoExempt ? 0 : cost,
        aspectRatio,
        resolution,
        duration: Number(duration),
      });
      if (!veoGenRowId) {
        return NextResponse.json(
          { error: "Could not record the video job. No LiTTBits were charged — please retry." },
          { status: 500 },
        );
      }
    }

    // Reserve LiTTBits (atomic debit — refunded on failure).
    // Keyed on requestId so client retries can never double-charge.
    let reservation: { balance: number; replayed: boolean } | null = null;
    if (!veoExempt) {
      try {
        const res = await adjustWalletBalance({
          clerkId: userId,
          amount: -cost,
          type: "spend",
          reason: `Video: ${videoModel.label} — Veo generation`,
          idempotencyKey: `video:charge:${requestId}`,
          rating: buildChargeRating({
            capability: "video",
            provider: "veo",
            model,
            providerCostMicros: costResult.providerCostCents * 10_000,
            bitsCharged: cost,
            lane: "generation",
          }),
          usage: { videoSeconds: Number(duration) || 0 },
        });

        if (res.replayed) {
          return NextResponse.json(
            {
              error:
                existingJob?.status === "failed"
                  ? "This video request already failed and its LiTTBits were refunded. Please start a new request."
                  : "This video request was already processed.",
            },
            { status: 409 },
          );
        }
        reservation = res;
      } catch (debitErr) {
        // The debit itself failed — nothing was charged.
        if (veoGenRowId) {
          await failGenerationJob(
            veoGenRowId,
            debitErr instanceof Error ? debitErr.message : "Debit failed",
            "none",
          );
        }
        throw debitErr;
      }
    }

    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });

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

      // Store job for server-authoritative refund tracking.
      // `charged` reflects reality: billing-exempt requests never debit.
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
        charged: !veoExempt,
        refunded: false,
      });

      // Move the durable row to generating with the provider operation id.
      // The status route will mark it completed with the durable URL.
      if (veoGenRowId) {
        await updateGenerationJobStatus(veoGenRowId, "generating", {
          providerJobId: operation.name,
        });
        await updateGenerationJobMetadata(veoGenRowId, {
          providerJobId: operation.name,
          videoJobId: jobId,
        });
      }

      return NextResponse.json({
        provider: "veo",
        operationName: operation.name,
        cost,
        balance: reservation ? reservation.balance : null,
      });
    } catch (genErr) {
      // Staged refund: the debit happened but the provider never accepted
      // the job. Refund with bounded retries; the outcome is recorded on
      // the durable row so a pending refund is never silently lost.
      throw await settleFailedSubmission({
        genRowId: veoGenRowId,
        userId,
        exempt: veoExempt,
        cost,
        modelLabel: videoModel.label,
        requestId,
        submitErr: genErr,
      });
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
