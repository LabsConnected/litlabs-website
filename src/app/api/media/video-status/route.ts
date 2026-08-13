import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import { adjustWalletBalance } from "@/lib/wallet-ledger";
import { findJobByOperationId, markVideoJobRefunded } from "@/lib/video-jobs";
import { getGenerationJobByProviderJobId, completeGenerationJob, updateGenerationJobMetadata, failGenerationJob } from "@/lib/generation/jobs";
import { resolveInternalUserId } from "@/lib/generation/identity";
import { uploadAudio } from "@/lib/r2";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!GEMINI_API_KEY)
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
    // Never trust client-supplied cost — resolve from the job store.
    const job = findJobByOperationId(operationName);
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

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const op = new GenerateVideosOperation();
    op.name = operationName;

    const updated = await ai.operations.getVideosOperation({ operation: op });

    // If done, get the video URI
    let videoUri: string | null = null;
    if (updated.done && updated.response?.generatedVideos?.[0]?.video?.uri) {
      videoUri = updated.response.generatedVideos[0].video.uri;
    }

    // If the operation failed (done but no video), refund the user
    // using the server-authoritative cost from the job store.
    let refunded = false;
    if (updated.done && !videoUri) {
      // Idempotent refund — can only happen once per job
      const canRefund = markVideoJobRefunded(job.jobId);
      if (canRefund && job.cost > 0) {
        await adjustWalletBalance({
          clerkId: userId,
          amount: job.cost,
          type: "refund",
          reason: `Video refund: ${job.model} operation failed (no video output)`,
          idempotencyKey: `video_refund_${operationName}`,
        });
        refunded = true;
      }

      // Mark the generation job as failed.
      // Uses internal UUID for lookup, NOT the Clerk ID.
      if (internalUserId) {
        const genJob = await getGenerationJobByProviderJobId(internalUserId, operationName);
        if (genJob) {
          await failGenerationJob(genJob.id, "Video generation failed — no video output");
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
      cost: job.cost,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Polling failed" },
      { status: 500 },
    );
  }
}
