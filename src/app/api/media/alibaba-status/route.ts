import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pollAlibabaVideoTask, downloadVideo } from "@/lib/alibaba-video";
import { uploadAudio } from "@/lib/r2";
import { adjustWalletBalance } from "@/lib/wallet-ledger";
import { isBillingExempt, getActiveSimulation } from "@/lib/owner";
import { findJobByOperationId, markVideoJobRefunded } from "@/lib/video-jobs";
import { getGenerationJobByProviderJobId, completeGenerationJob, updateGenerationJobMetadata } from "@/lib/generation/jobs";
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
    // Never trust client-supplied cost — resolve from the job store.
    const job = findJobByOperationId(taskId);
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
          cost: job.cost,
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
          cost: job.cost,
        });
      }
    }

    // If the task failed, refund the reserved LiTTBits
    // using the server-authoritative cost from the job store.
    let refunded = false;
    if (result.taskStatus === "FAILED") {
      const canRefund = markVideoJobRefunded(job.jobId);
      // Skip refund for billing-exempt owner (they were never debited)
      const alibabaSim = await getActiveSimulation().catch(() => null);
      const alibabaExempt = isBillingExempt(userId, alibabaSim);
      if (canRefund && job.cost > 0 && !alibabaExempt) {
        await adjustWalletBalance({
          clerkId: userId,
          amount: job.cost,
          type: "refund",
          reason: `Video refund: ${job.model} task failed`,
          idempotencyKey: `video_refund_${taskId}`,
        });
        refunded = true;
      }
    }

    return NextResponse.json({
      done: result.taskStatus === "SUCCEEDED" || result.taskStatus === "FAILED",
      taskStatus: result.taskStatus,
      videoUrl: result.videoUrl,
      error: result.error,
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
