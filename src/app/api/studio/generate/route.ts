import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { getConversation } from "@/lib/studio/conversation-service";
import { generateImage, type ImageGenerationInput } from "@/lib/generation/image-service";
import type { MediaProviderId } from "@/lib/media";
import { withRateLimit } from "@/lib/rate-limiter";

function statusForCode(code: string): number {
  if (code === "INSUFFICIENT_FUNDS") return 402;
  if (code === "QUOTA_EXCEEDED") return 429;
  if (code === "UNAUTHORIZED") return 401;
  if (code === "BAD_REQUEST") return 400;
  return 422;
}

async function handler(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (prompt.length < 3) {
      return NextResponse.json({ error: "Prompt must be at least 3 characters" }, { status: 400 });
    }

    const requestedProjectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const requestedConversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    const project = requestedProjectId ? await getProject(requestedProjectId, userId) : null;
    if (requestedProjectId && !project) {
      return NextResponse.json({ error: "Project is not available" }, { status: 403 });
    }
    const conversation = requestedConversationId ? await getConversation(requestedConversationId, userId) : null;
    if (requestedConversationId && (!conversation || (project && conversation.projectId !== project.id))) {
      return NextResponse.json({ error: "Conversation is not available for this project" }, { status: 403 });
    }

    const ratio = typeof body.aspectRatio === "string" ? body.aspectRatio : "1:1";
    const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
    const width = typeof body.width === "number" ? body.width : ratioWidth && ratioHeight
      ? Math.round(Math.min(1024 / ratioWidth, 1024 / ratioHeight) * ratioWidth) : 1024;
    const height = typeof body.height === "number" ? body.height : ratioWidth && ratioHeight
      ? Math.round(Math.min(1024 / ratioWidth, 1024 / ratioHeight) * ratioHeight) : 1024;
    const batchSize = Math.min(Math.max(typeof body.batchSize === "number" ? body.batchSize : 1, 1), 4);
    const providerId = typeof body.provider === "string" ? body.provider as MediaProviderId : "openai";
    const results = [];

    for (let index = 0; index < batchSize; index += 1) {
      const input: ImageGenerationInput = {
        prompt, providerId, generationMode: "manual", aspectRatio: ratio,
        width, height, format: "image", operation: "generate",
      };
      const result = await generateImage(
        {
          userId, projectId: project?.id, conversationId: conversation?.id,
          requestId: typeof body.requestId === "string" && body.requestId
            ? `${body.requestId}:${index}` : undefined,
        },
        input,
      );
      if (!result.success) {
        return NextResponse.json(
          { error: result.error, code: result.code, provider: result.providerId, requestId: result.requestId },
          { status: statusForCode(result.code) },
        );
      }
      results.push({
        url: result.downloadUrl, prompt, provider: result.providerId,
        model: providerId === "openai"
          ? (input.operation === "edit" ? "gpt-image-2.5-sunburst" : "gpt-image-2.5-flare")
          : undefined,
        timestamp: Date.now(), id: result.id, cost: result.cost,
      });
    }

    return NextResponse.json({
      images: results, provider: providerId,
      free: results.every((image) => image.cost === 0),
    });
  } catch {
    return NextResponse.json({ error: "Failed to generate image" }, { status: 500 });
  }
}

async function getHandler() {
  return NextResponse.json({
    status: "ok",
    providers: ["openai", "cloudflare", "alibaba", "gemini", "fal", "recraft", "pollinations"],
    default: "openai", pollinations: "manual-only",
  });
}

export const POST = withRateLimit(handler, 10, 60);
export const GET = withRateLimit(getHandler, 30, 60);
