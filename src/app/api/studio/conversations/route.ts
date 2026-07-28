import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { createConversation, listConversations } from "@/lib/studio/conversation-service";
import { isValidAgentSlug } from "@/lib/studio/agent-registry";
import { studioLog } from "@/lib/studio/logger";
import type { AgentSlug } from "@/lib/studio/types";

export const runtime = "nodejs";

async function getHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId") || undefined;
  const conversations = await listConversations(userId, projectId || undefined);

  return NextResponse.json({ conversations });
}

async function postHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const projectId = body.projectId;
  if (typeof projectId !== "string" || !projectId.trim()) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) || null : null;
  const rawAgentSlug = body.activeAgentSlug;
  const activeAgentSlug: AgentSlug = isValidAgentSlug(rawAgentSlug as string) ? rawAgentSlug as AgentSlug : "litt";

  // Server generates ID, sets owner, sets revision to 1
  // Caller-provided id, ownerId, revision are ignored
  const conversation = await createConversation(userId, projectId, title, activeAgentSlug);
  if (!conversation) {
    return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });
  }

  studioLog("conversation:created", {
    conversationId: conversation.id,
    projectId,
    userId: userId,
    agentSlug: activeAgentSlug,
    revisionAfter: conversation.revision,
  });

  return NextResponse.json({ conversation }, { status: 201 });
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 30, 60);
