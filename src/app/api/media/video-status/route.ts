import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import { findJobByOperationId, markVideoJobRefunded, markVideoJobFailed } from "@/lib/video-jobs";
import { refundVideoCharge } from "@/lib/video-refunds";
import { getGenerationJobByProviderJobId, completeGenerationJob, updateGenerationJobMetadata, failGenerationJob, setGenerationRefundStatus } from "@/lib/generation/jobs";
import type { RefundStatus } from "@/lib/generation/types";
import { resolveInternalUserId } from "@/lib/generation/identity";
import { uploadAudio } from "@/lib/r2";

export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Read at request time (not module load) so key rotation and tests see
  // the current value.
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey)
    return NextResponse.json(
      { error: "Gemini API key not configured" },
      { status: 500 },
    );

  // Resolve Clerk ID → internal public.users.id UUID for generation_jobs.
  const internalUserId = await resolveInternalUserId(userId);

  try {
    const { operationName } = await req.json();
    if (!operationName)
      return NextResponse.json(
        { error: "Missing operationName" },
        { status: 400 },
      );

    // ── Server-authoritative cost resolution ──────────────────────
    // Never trust client-supplied cost — resolve from the job records.
    // The in-memory job is the fast path; the durable generation_jobs row
    // is the cross-instance / post-restart fallback, so a refund is never
    // gated on which instance handled the original request.
    const job = findJobByOperationId(operationName);
    const genRow = internalUserId
      ? await getGenerationJobByProviderJobId(internalUserId, operationName)
      : null;
    if (!job && !genRow) {
      return NextResponse.json(
        { error: "Video job not found. Cost must be resolved server-side." },
        { status: 404 },
      );
    }

    // Verify the job belongs to the authenticated user
    if (job && job.userId !== userId) {
      return NextResponse.json(
        { error: "Video job does not belong to this user." },
        { status: 403 },
      );
    }
    if (!job && genRow && genRow.userId !== internalUserId) {
      return NextResponse.json(
        { error: "Video job does not belong to this user." },
        { status: 403 },
      );
    }

    // Charge-time truth: only refund when a debit actually happened.
    // Billing-exempt requests record charged=false / littBitsCharged=0,
    // so they can never be refunded — even if the exemption lapses
    // between the charge and this poll.
    const cost = job ? job.cost : genRow!.littBitsCharged;
    const charged = job ? job.charged : genRow!.littBitsCharged > 0;

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const op = new GenerateVideosOperation();
    op.name = operationName;

    const updated = await ai.operations.getVideosOperation({ operation: op });

    // If done, get the video URI
    let videoUri: string | null = null;
    if (updated.done && updated.response?.generatedVideos?.[0]?.video?.uri) {
      videoUri = updated.response.generatedVideos[0].video.uri;
    }

    // If the operation failed (done but no video), refund the user
    // using the server-authoritative cost from the job records.
    let refunded = false;
    let refundPending = false;
    if (updated.done && !videoUri) {
      if (charged && cost > 0) {
        const alreadyRefunded = genRow
          ? genRow.refundStatus === "refunded"
          : job!.refunded;
        if (!alreadyRefunded) {
          // Record the refund intent first so a crash or retry can observe
          // it; the wallet idempotency key is the exactly-once arbiter, so
          // concurrent polls across instances cannot double-credit.
          if (genRow) await setGenerationRefundStatus(genRow.id, "pending");
          const r = await refundVideoCharge({
            clerkId: userId,
            amount: cost,
            reason: `Video refund: ${job?.model ?? genRow?.model ?? "video"} operation failed (no video output)`,
            idempotencyKey: `video_refund_${operationName}`,
          });
          if (r.ok) {
            if (genRow) await setGenerationRefundStatus(genRow.id, "refunded");
            if (job) markVideoJobRefunded(job.jobId);
            // `replayed` means another poll/instance already completed this
            // refund — the money is back either way.
            refunded = !r.replayed;
          } else {
            // Wallet unreachable: stays `pending` so the next poll retries.
            if (genRow) await setGenerationRefundStatus(genRow.id, "pending");
            refundPending = true;
          }
        }
      }

      if (job) markVideoJobFailed(job.jobId);

      // Mark the durable generation job as failed with the refund outcome.
      const refundStatus: RefundStatus = refunded
        ? "refunded"
        : refundPending
          ? "pending"
          : "none";
      if (genRow) {
        await failGenerationJob(
          genRow.id,
          "Video generation failed — no video output",
          refundStatus,
        );
      } else if (internalUserId) {
        const row = await getGenerationJobByProviderJobId(internalUserId, operationName);
        if (row) {
          await failGenerationJob(
            row.id,
            "Video generation failed — no video output",
            refundStatus,
          );
        }
      }
    }

    // If the operation succeeded, persist the video to R2 and complete
    // the generation_jobs row so it becomes visible in the Asset Lake.
    let durableUrl: string | null = null;
    let assetId: string | null = null;
    if (updated.done && videoUri) {
      try {
        // Download the video from Google's signed URL and upload to R2.
        const videoResponse = await fetch(videoUri);
        if (videoResponse.ok) {
          const buffer = Buffer.from(await videoResponse.arrayBuffer());
          const filename = `veo-${operationName.replace(/[^a-zA-Z0-9]/g, "_")}.mp4`;
          const saved = await uploadAudio(userId, filename, buffer, "video/mp4", "video");
          durableUrl = saved.publicUrl;

          // Complete the persistent generation_jobs row.
          // Uses internal UUID for lookup, NOT the Clerk ID.
          if (internalUserId) {
            const genJob = await getGenerationJobByProviderJobId(internalUserId, operationName);
            if (genJob) {
              await updateGenerationJobMetadata(genJob.id, {
                durableUrl: saved.publicUrl,
                contentType: "video/mp4",
                storageKey: saved.storageKey,
              });
              await completeGenerationJob(genJob.id, `generation_job:${genJob.id}`);
              assetId = `generation_job:${genJob.id}`;
            }
          }
        }
      } catch {
        // If R2 persistence fails, fall back to the Google signed URL.
        // The generation job remains in "generating" state — it will
        // not appear in Asset Lake until a durable URL is available.
        durableUrl = videoUri;
      }
    }

    return NextResponse.json({
      done: updated.done,
      videoUri: durableUrl ?? videoUri,
      saved: durableUrl !== null,
      assetId,
      refunded,
      refundPending,
      cost,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Polling failed" },
      { status: 500 },
    );
  }
}
