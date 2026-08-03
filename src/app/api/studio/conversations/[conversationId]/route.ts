import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getConversation, updateConversation, archiveConversation } from "@/lib/studio/conversation-service";
import { isValidAgentSlug } from "@/lib/studio/agent-registry";
import { studioLog } from "@/lib/studio/logger";
import type { AgentSlug } from "@/lib/studio/types";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

async function getHandler(req: NextRequest, ctx?: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await (ctx?.params ?? Promise.resolve({ conversationId: "" }));
  const conversation = await getConversation(conversationId, userId);
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ conversation });
}

async function patchHandler(req: NextRequest, ctx?: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const expectedRevision = body.expectedRevision;
  if (typeof expectedRevision !== "number" || expectedRevision < 1) {
    return NextResponse.json({ error: "expectedRevision is required and must be a positive number" }, { status: 400 });
  }

  const patch: { title?: string | null; activeAgentSlug?: AgentSlug } = {};
  if (body.title !== undefined) {
    patch.title = typeof body.title === "string" ? body.title.trim().slice(0, 120) || null : null;
  }
  if (body.activeAgentSlug !== undefined) {
    if (!isValidAgentSlug(body.activeAgentSlug as string)) {
      return NextResponse.json({ error: "Unsupported agent" }, { status: 400 });
    }
    patch.activeAgentSlug = body.activeAgentSlug as AgentSlug;
  }

  const { conversationId } = await (ctx?.params ?? Promise.resolve({ conversationId: "" }));
  const { conversation, conflict } = await updateConversation(
    conversationId,
    userId,
    expectedRevision,
    patch,
  );

  if (conflict) {
    return NextResponse.json(
      { error: "Stale revision", detail: "The conversation was modified by another request" },
      { status: 409 },
    );
  }

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  studioLog("conversation:updated", {
    conversationId: conversation.id,
    userId,
    revisionBefore: expectedRevision,
    revisionAfter: conversation.revision,
  });

  return NextResponse.json({ conversation });
}

async function deleteHandler(req: NextRequest, ctx?: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await (ctx?.params ?? Promise.resolve({ conversationId: "" }));
  const success = await archiveConversation(conversationId, userId);
  if (!success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  studioLog("conversation:archived", {
    conversationId,
    userId,
  });

  return NextResponse.json({ ok: true });
}

export const GET = withRateLimit(getHandler, 100, 60) as (req: NextRequest, ctx: RouteParams) => Promise<Response>;
export const PATCH = withRateLimit(patchHandler, 60, 60) as (req: NextRequest, ctx: RouteParams) => Promise<Response>;
export const DELETE = withRateLimit(deleteHandler, 30, 60) as (req: NextRequest, ctx: RouteParams) => Promise<Response>;
