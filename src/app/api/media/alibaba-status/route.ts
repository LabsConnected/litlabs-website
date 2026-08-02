import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pollAlibabaVideoTask, downloadVideo } from "@/lib/alibaba-video";
import { uploadAudio } from "@/lib/r2";

export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { taskId, saveToR2 = true } = await req.json();
    if (!taskId)
      return NextResponse.json({ error: "Missing taskId" }, { status: 400 });

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
        });
      }
    }

    return NextResponse.json({
      done: result.taskStatus === "SUCCEEDED" || result.taskStatus === "FAILED",
      taskStatus: result.taskStatus,
      videoUrl: result.videoUrl,
      error: result.error,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Polling failed" },
      { status: 500 },
    );
  }
}
