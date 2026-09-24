import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pollAlibabaVideoTask, downloadVideo } from "@/lib/alibaba-video";
import { uploadAudio } from "@/lib/r2";
import { findJobByOperationId, markVideoJobRefunded, markVideoJobFailed } from "@/lib/video-jobs";
import { refundVideoCharge } from "@/lib/video-refunds";
import { getGenerationJobByProviderJobId, completeGenerationJob, updateGenerationJobMetadata, failGenerationJob, setGenerationRefundStatus } from "@/lib/generation/jobs";
import type { RefundStatus } from "@/lib/generation/types";
import { resolveInternalUserId } from "@/lib/generation/identity";

export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Resolve Clerk ID → internal public.users.id UUID for generation_jobs.
  const internalUserId = await resolveInternalUserId(userId);

  try {
    const { taskId, saveToR2 = true } = await req.json();
    if (!taskId)
      return NextResponse.json({ error: "Missing taskId" }, { status: 400 });

    // ── Server-authoritative cost resolution ──────────────────────
    // Never trust client-supplied cost — resolve from the job records.
    // The in-memory job is the fast path; the durable generation_jobs row
    // is the cross-instance / post-restart fallback, so a refund is never
    // gated on which instance handled the original request.
    const job = findJobByOperationId(taskId);
    const genRow = internalUserId
      ? await getGenerationJobByProviderJobId(internalUserId, taskId)
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

    const result = await pollAlibabaVideoTask(taskId);

    // When the task succeeds, download the video and save to R2 so the
    // URL doesn't expire (Alibaba URLs are only valid for 24 hours).
    if (result.taskStatus === "SUCCEEDED" && result.videoUrl && saveToR2) {
      try {
        const buffer = await downloadVideo(result.videoUrl);
        const saved = await uploadAudio(userId, `happyhorse-${taskId}.mp4`, buffer, "video/mp4", "video");

        // Complete the persistent generation_jobs row with the durable URL
        // so the video becomes visible in the Asset Lake.
        // Uses internal UUID for lookup, NOT the Clerk ID.
        let assetId: string | null = null;
        if (internalUserId) {
          const genJob = await getGenerationJobByProviderJobId(internalUserId, taskId);
          if (genJob) {
            // Update metadata with the durable R2 URL first.
            await updateGenerationJobMetadata(genJob.id, {
              durableUrl: saved.publicUrl,
              contentType: "video/mp4",
              storageKey: saved.storageKey,
            });
            // Then mark the job as completed.
            await completeGenerationJob(genJob.id, `generation_job:${genJob.id}`);
            assetId = `generation_job:${genJob.id}`;
          }
        }

        return NextResponse.json({
          done: true,
          taskStatus: result.taskStatus,
          videoUrl: saved.publicUrl,
          storageKey: saved.storageKey,
          saved: true,
          cost,
          assetId,
        });
      } catch (saveErr) {
        // If R2 save fails, return the temporary Alibaba URL so the user
        // can still view/download the video before it expires.
        return NextResponse.json({
          done: true,
          taskStatus: result.taskStatus,
          videoUrl: result.videoUrl,
          saved: false,
          warning: saveErr instanceof Error ? saveErr.message : "R2 save failed",
          cost,
        });
      }
    }

    // If the task failed, refund the reserved LiTTBits
    // using the server-authoritative cost from the job records.
    let refunded = false;
    let refundPending = false;
    if (result.taskStatus === "FAILED") {
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
            reason: `Video refund: ${job?.model ?? genRow?.model ?? "video"} task failed`,
            idempotencyKey: `video_refund_${taskId}`,
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

      // Mark the durable generation job as failed with the refund outcome
      // (previously the row was left stuck in "generating" forever).
      const refundStatus: RefundStatus = refunded
        ? "refunded"
        : refundPending
          ? "pending"
          : "none";
      if (genRow) {
        await failGenerationJob(
          genRow.id,
          result.error ?? "Alibaba video task failed",
          refundStatus,
        );
      }
    }

    return NextResponse.json({
      done: result.taskStatus === "SUCCEEDED" || result.taskStatus === "FAILED",
      taskStatus: result.taskStatus,
      videoUrl: result.videoUrl,
      error: result.error,
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
