import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { runLiTT, runLiTTStream, type LiTTRunRequest } from "@/lib/litt-runtime";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/litt/run
 *
 * Canonical LiTT runtime endpoint. Every interface (Studio chat, global
 * companion, voice, CLI, mobile) funnels through here. The server resolves
 * auth, project, conversation, capabilities, and provider state itself —
 * client-supplied capability state is a hint only.
 *
 * Body: LiTTRunRequest
 *   {
 *     message: string,
 *     conversationId?: string,
 *     projectId?: string,
 *     missionId?: string,
 *     activeCanvasId?: string,
 *     agentMode?: "studio" | "companion" | "voice" | "cli" | "mobile",
 *     requestedProvider?: string,
 *     requestedModel?: string,
 *     attachments?: { type: "image", dataUrl: string }[],
 *     stream?: boolean,
 *     agentSlug?: string,
 *     agentInstanceId?: string,
 *     history?: { role, content }[],
 *     category?: string,
 *     userName?: string,
 *     pageContext?: { surface?, pageTitle?, route?, activeEntity?, authenticated? },
 *     runtimeContext?: Record<string, unknown>,
 *     clientRequestId?: string,
 *   }
 *
 * Returns:
 *   - Non-stream: { text, provider, model, latencyMs, reasoning?, actions? }
 *   - Stream: SSE with { type: "text"|"reasoning"|"done"|"error", ... } events
 */
async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = body.message;
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  const runRequest: LiTTRunRequest = {
    message,
    conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
    projectId: typeof body.projectId === "string" ? body.projectId : undefined,
    missionId: typeof body.missionId === "string" ? body.missionId : undefined,
    activeCanvasId: typeof body.activeCanvasId === "string" ? body.activeCanvasId : undefined,
    agentMode: body.agentMode as LiTTRunRequest["agentMode"],
    requestedProvider: typeof body.requestedProvider === "string" ? body.requestedProvider : undefined,
    requestedModel: typeof body.requestedModel === "string" ? body.requestedModel : undefined,
    attachments: Array.isArray(body.attachments) ? body.attachments as LiTTRunRequest["attachments"] : undefined,
    stream: body.stream === true,
    agentSlug: typeof body.agentSlug === "string" ? body.agentSlug : undefined,
    agentInstanceId: typeof body.agentInstanceId === "string" ? body.agentInstanceId : undefined,
    history: Array.isArray(body.history) ? body.history as LiTTRunRequest["history"] : undefined,
    category: typeof body.category === "string" ? body.category : undefined,
    userName: typeof body.userName === "string" ? body.userName : undefined,
    pageContext: body.pageContext as LiTTRunRequest["pageContext"],
    runtimeContext: body.runtimeContext as Record<string, unknown> | undefined,
    clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : undefined,
  };

  try {
    if (runRequest.stream) {
      return await runLiTTStream({ httpRequest: req, req: runRequest });
    }

    const { status, body: resultBody } = await runLiTT({ httpRequest: req, req: runRequest });
    return NextResponse.json(resultBody, { status });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
