import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { createConversation, listConversations } from "@/lib/studio/conversation-service";
import { isValidAgentSlug } from "@/lib/studio/agent-registry";
import { studioLog } from "@/lib/studio/logger";
import type { AgentSlug } from "@/lib/studio/types";
import { createBlankProject, getProject, listProjects } from "@/lib/projects/project-repository";

export const runtime = "nodejs";

async function getHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId") || undefined;
  const conversations = await listConversations(userId, projectId || undefined);

  return NextResponse.json({ conversations });
}

async function postHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Chat must not be gated by project setup. Conversations currently retain a
  // project foreign key for memory/file scoping, so resolve that detail here:
  // use the requested owned project, otherwise reuse the user's latest project,
  // and finally create a lightweight private chat workspace. The client never
  // has to create or choose a project just to speak to LiTT or Spark.
  const requestedProjectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  let projectId = requestedProjectId;
  if (projectId && !(await getProject(projectId, userId))) {
    projectId = "";
  }
  if (!projectId) {
    const existing = await listProjects(userId);
    projectId = existing.projects[0]?.id ?? existing.legacyOnly[0]?.id ?? "";
  }
  if (!projectId) {
    const chatProject = await createBlankProject({
      userId,
      name: "LiTT Chat",
      templateId: "blank-static",
      accessMode: "private",
    });
    projectId = chatProject.id;
  }

  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) || null : null;
  const rawAgentSlug = body.activeAgentSlug;
  const activeAgentSlug: AgentSlug = isValidAgentSlug(rawAgentSlug as string) ? rawAgentSlug as AgentSlug : "litt";

  // Server generates ID, sets owner, sets revision to 1
  // Caller-provided id, ownerId, revision are ignored
  const conversation = await createConversation(userId, projectId, title, activeAgentSlug);
  if (!conversation) {
    return NextResponse.json({ error: "Project not found or not owned by user" }, { status: 403 });
  }

  studioLog("conversation:created", {
    conversationId: conversation.id,
    projectId,
    userId: userId,
    agentSlug: activeAgentSlug,
    revisionAfter: conversation.revision,
  });

  return NextResponse.json({ conversation, projectId }, { status: 201 });
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 30, 60);
