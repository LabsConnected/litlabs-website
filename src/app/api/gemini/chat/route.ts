import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  runLiTT,
  resolveRequestContext,
  buildPrompt,
  executeRunStream,
  verifyResult,
  sanitizeOutput,
  detectActions,
  buildSseHeaders,
  auditRun,
  logLegacyAgentChat,
  type LiTTRunRequest,
} from "@/lib/litt-runtime";
import { resolveRuntimeAgent } from "@/lib/agent-runtime";
import { parseAgentSelection } from "@/lib/agent-selection";
import { AGENTS } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_AGENT_SLUG = "litt";

/**
 * POST /api/gemini/chat  (COMPATIBILITY ADAPTER)
 *
 * This endpoint is kept temporarily for backwards compatibility with
 * existing clients. It now delegates all orchestration to the canonical
 * LiTT Runtime (src/lib/litt-runtime) via /api/litt/run's logic.
 *
 * It no longer owns memory retrieval/saving, provider routing, prompt
 * orchestration, capability resolution, tool selection, canvas action
 * detection, or conversation logging — those live in the runtime.
 *
 * Legacy request body:
 *   { agentSlug, message, history?, provider?, category?, model?, stream?,
 *     userName?, images?, capabilities?, pageContext?, systemPrompt? (ignored) }
 *
 * Legacy response body:
 *   - non-stream: { response, provider, model, latencyMs, actions? }
 *   - stream:     SSE `data: { text }` chunks, then `data: { done, provider, model, latencyMs, actions }`, then `data: [DONE]`
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

  const agentSlug = typeof body.agentSlug === "string" ? body.agentSlug : DEFAULT_AGENT_SLUG;
  const agent = AGENTS[agentSlug as keyof typeof AGENTS] ?? AGENTS[DEFAULT_AGENT_SLUG as keyof typeof AGENTS];

  // Convert legacy images[] into attachments[]
  const images = Array.isArray(body.images) ? body.images : [];
  const attachments: LiTTRunRequest["attachments"] = images
    .filter((u): u is string => typeof u === "string")
    .map((dataUrl) => ({ type: "image" as const, dataUrl }));

  // Convert legacy capabilities{} into runtimeContext{} (a hint only —
  // the server re-resolves project/branch state from Supabase).
  const capabilities = (body.capabilities ?? {}) as Record<string, unknown>;
  const runtimeContext: Record<string, unknown> = { ...capabilities };
  if (typeof body.activeCanvasId === "string") runtimeContext.activeCanvasId = body.activeCanvasId;

  const runRequest: LiTTRunRequest = {
    message,
    conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
    projectId: typeof (capabilities as Record<string, unknown>).projectId === "string"
      ? (capabilities as Record<string, unknown>).projectId as string
      : undefined,
    activeCanvasId: typeof body.activeCanvasId === "string" ? body.activeCanvasId : undefined,
    agentMode: "studio",
    requestedProvider: typeof body.provider === "string" ? body.provider : undefined,
    requestedModel: typeof body.model === "string" ? body.model : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    stream: body.stream === true,
    agentSlug,
    agentInstanceId: typeof body.agentInstanceId === "string" ? body.agentInstanceId : undefined,
    history: Array.isArray(body.history) ? body.history as LiTTRunRequest["history"] : undefined,
    category: typeof body.category === "string" ? body.category : undefined,
    userName: typeof body.userName === "string" ? body.userName : undefined,
    pageContext: body.pageContext as LiTTRunRequest["pageContext"],
    runtimeContext,
    // clientSystemPrompt is intentionally never trusted — always ignored.
  };

  try {
    if (runRequest.stream) {
      // Streaming: run the runtime pipeline directly and emit the LEGACY SSE
      // shape ({ text } chunks + { done: true, ... } final + [DONE]) so
      // existing clients keep working without changes.
      return runLiTTStreamLegacy({ httpRequest: req, req: runRequest, agentId: agent.id });
    }

    const { status, body: resultBody, outcome } = await runLiTT({ httpRequest: req, req: runRequest });
    if (status !== 200) {
      return NextResponse.json({ error: "Runtime error" }, { status });
    }

    // Legacy agent_logs row for backward compatibility.
    logLegacyAgentChat(agent.id, outcome.ctx.userId, message, resultBody.text);

    return NextResponse.json({
      response: resultBody.text,
      provider: resultBody.provider,
      model: resultBody.model,
      latencyMs: resultBody.latencyMs,
      actions: resultBody.actions,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * Streaming adapter: runs the canonical runtime pipeline and re-emits events
 * in the legacy SSE shape consumed by existing clients:
 *   data: { text }
 *   data: { done: true, provider, model, latencyMs, actions }
 *   data: [DONE]
 */
async function runLiTTStreamLegacy(args: {
  httpRequest: NextRequest;
  req: LiTTRunRequest;
  agentId: string;
}): Promise<Response> {
  const { httpRequest, req, agentId } = args;
  const ctx = await resolveRequestContext(httpRequest, req);

  if (!ctx.isAuthenticated && !ctx.isDev && !ctx.isAnonymousCompanion) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve marketplace runtime agent if supplied.
  let runtimeAgent = null;
  if (req.agentInstanceId && ctx.clerkId) {
    const selection = parseAgentSelection(req.agentInstanceId);
    if (selection) {
      const result = await resolveRuntimeAgent({ clerkId: ctx.clerkId, selection });
      if (result.ok && result.agent) runtimeAgent = result.agent;
    }
  }

  const prompt = buildPrompt(ctx, req, runtimeAgent);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let assistantText = "";
      try {
        const result = await executeRunStream(req, prompt.fullPrompt, prompt.systemPrompt, {
          onText: (chunk) => {
            const clean = sanitizeOutput(chunk);
            assistantText += clean;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: clean })}\n\n`));
          },
        });

        const verified = verifyResult(assistantText);
        auditRun({
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          projectId: ctx.projectId,
          mode: ctx.mode,
          agentSlug: req.agentSlug,
          agentInstanceId: runtimeAgent?.agentInstanceId ?? undefined,
          provider: result.provider,
          model: result.model,
          latencyMs: result.latencyMs,
          status: verified.ok ? "completed" : "failed",
          errorClass: verified.warning,
        });
        logLegacyAgentChat(agentId, ctx.userId, req.message, verified.text);

        const actions = detectActions(req.message, verified.text, req.activeCanvasId);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              done: true,
              provider: result.provider,
              model: result.model,
              latencyMs: result.latencyMs,
              actions,
            })}\n\n`,
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "stream error";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: buildSseHeaders() });
}

export const POST = withRateLimit(handler, 60, 60);
