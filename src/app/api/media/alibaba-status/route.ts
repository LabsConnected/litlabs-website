import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pollAlibabaVideoTask, downloadVideo } from "@/lib/alibaba-video";
import { uploadAudio } from "@/lib/r2";
import { adjustWalletBalance } from "@/lib/wallet-ledger";
import { findJobByOperationId, markVideoJobRefunded } from "@/lib/video-jobs";

export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
        return NextResponse.json({
          done: true,
          taskStatus: result.taskStatus,
          videoUrl: saved.publicUrl,
          storageKey: saved.storageKey,
          saved: true,
          cost: job.cost,
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
      if (canRefund && job.cost > 0) {
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
