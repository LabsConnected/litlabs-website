import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { getConversation } from "@/lib/studio/conversation-service";
import { withRateLimit } from "@/lib/rate-limiter";
import { generateImage } from "@/lib/generation/image-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!imageUrl || !/^https?:\/\/|^data:image\//.test(imageUrl)) {
    return NextResponse.json({ error: "imageUrl must be an image URL or data URL" }, { status: 400 });
  }
  if (prompt.trim().length < 3) return NextResponse.json({ error: "Edit prompt required" }, { status: 400 });

  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId.trim() : "";
  const project = projectId ? await getProject(projectId, userId) : null;
  if (projectId && !project) return NextResponse.json({ error: "Project is not available" }, { status: 403 });
  const conversation = conversationId ? await getConversation(conversationId, userId) : null;
  if (conversationId && (!conversation || (project && conversation.projectId !== project.id))) {
    return NextResponse.json({ error: "Conversation is not available for this project" }, { status: 403 });
  }

  const result = await generateImage(
    {
      userId,
      projectId: project?.id,
      conversationId: conversation?.id,
      requestId: typeof body?.requestId === "string" && body.requestId ? body.requestId : undefined,
    },
    {
      prompt: prompt.trim(),
      format: "image",
      providerId: "openai",
      operation: "edit",
      referenceUrl: imageUrl,
    },
  );
  if (!result.success) {
    const status = result.code === "INSUFFICIENT_FUNDS" ? 402 : result.code === "UNAUTHORIZED" ? 401 : 422;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({
    success: true,
    downloadUrl: result.downloadUrl,
    durableUrl: result.downloadUrl,
    cost: result.cost,
    balance: result.balance,
    generationJobId: result.generationJobId,
    assetId: result.assetId,
    assetPersistenceFailed: result.assetPersistenceFailed,
    providerId: result.providerId,
  });
}

export const POST = withRateLimit(handler, 60, 60);
