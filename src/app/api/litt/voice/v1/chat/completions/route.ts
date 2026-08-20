import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { runLiTT, runLiTTStream, type LiTTRunRequest } from "@/lib/litt-runtime";

export const runtime = "nodejs";

/**
 * POST /api/litt/voice/v1/chat/completions
 *
 * OpenAI-compatible chat completions endpoint for voice providers
 * (ElevenLabs Custom LLM, OpenAI Realtime, or any OpenAI-compatible
 * voice transport). This is the single point where voice conversations
 * enter the LiTT Runtime — voice providers must NOT maintain their own
 * separate reasoning brain.
 *
 * Voice flow:
 *   Caller speaks
 *   → Voice provider transcribes (STT)
 *   → POST /api/litt/voice/v1/chat/completions  (this endpoint)
 *   → LiTT Runtime (auth, project, memory, Kernel, model, tools)
 *   → Streaming response
 *   → Voice provider speaks response (TTS)
 *
 * Request: OpenAI chat completions format
 *   {
 *     model: string,
 *     messages: [{ role: "system"|"user"|"assistant", content: string }],
 *     stream?: boolean,
 *     temperature?: number,
 *     max_tokens?: number,
 *     // LiTT extensions (optional, passed as metadata):
 *     metadata?: { conversationId?, projectId?, agentMode?, agentSlug?, agentInstanceId? }
 *   }
 *
 * Response: OpenAI chat completions format (streaming or non-streaming)
 *
 * Auth: Bearer token via the standard auth() layer (Clerk session).
 *       Voice providers pass the user's session token.
 */
async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: { message: "Method not allowed", type: "invalid_request_error" } }, { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return openaiError("Invalid JSON body", "invalid_request_error", 400);
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return openaiError("messages is required and must be a non-empty array", "invalid_request_error", 400);
  }

  // Extract the latest user message from the OpenAI messages array.
  // System messages are ignored — the LiTT Runtime composes its own system
  // prompt server-side (Kernel + project + capabilities + memory).
  const userMessages = messages.filter(
    (m): m is { role: "user"; content: string } =>
      typeof m === "object" && m !== null && (m as { role: string }).role === "user" && typeof (m as { content: unknown }).content === "string",
  );
  if (userMessages.length === 0) {
    return openaiError("No user message found in messages array", "invalid_request_error", 400);
  }
  const message = userMessages[userMessages.length - 1].content;

  // Convert prior messages into history (excluding the current user message
  // and any system messages — the runtime builds its own system prompt).
  const history = messages
    .slice(0, -1) // exclude the last message (current user message)
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        typeof m === "object" &&
        m !== null &&
        ((m as { role: string }).role === "user" || (m as { role: string }).role === "assistant") &&
        typeof (m as { content: unknown }).content === "string",
    )
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Extract LiTT metadata (passed by the voice provider as optional metadata).
  const metadata = (body.metadata ?? {}) as Record<string, unknown>;

  const runRequest: LiTTRunRequest = {
    message,
    conversationId: typeof metadata.conversationId === "string" ? metadata.conversationId : undefined,
    projectId: typeof metadata.projectId === "string" ? metadata.projectId : undefined,
    agentMode: "voice",
    requestedModel: typeof body.model === "string" ? body.model : undefined,
    stream: body.stream === true,
    agentSlug: typeof metadata.agentSlug === "string" ? metadata.agentSlug : "litt",
    agentInstanceId: typeof metadata.agentInstanceId === "string" ? metadata.agentInstanceId : undefined,
    history: history.length > 0 ? history : undefined,
  };

  try {
    if (runRequest.stream) {
      return await runLiTTStreamOpenAI({ httpRequest: req, req: runRequest });
    }

    const { status, body: resultBody } = await runLiTT({ httpRequest: req, req: runRequest });
    if (status !== 200) {
      return openaiError("Runtime error", "server_error", status);
    }

    // Return OpenAI chat completions format (non-streaming)
    const completionId = `chatcmpl-litt-${Date.now()}`;
    return NextResponse.json({
      id: completionId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: resultBody.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: resultBody.text },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: Math.ceil(message.length / 4),
        completion_tokens: Math.ceil(resultBody.text.length / 4),
        total_tokens: Math.ceil(message.length / 4) + Math.ceil(resultBody.text.length / 4),
      },
    });
  } catch (err) {
    return openaiError(
      err instanceof Error ? err.message : "Internal server error",
      "server_error",
      500,
    );
  }
}

/**
 * Streaming adapter: runs the LiTT runtime stream and re-emits in the
 * OpenAI SSE streaming format (data: { choices: [{ delta: { content } }] }).
 */
async function runLiTTStreamOpenAI(args: { httpRequest: NextRequest; req: LiTTRunRequest }): Promise<Response> {
  const { httpRequest, req } = args;
  // Run the runtime in streaming mode and transform the canonical SSE events
  // into OpenAI streaming format.
  const { resolveRequestContext, buildPrompt, executeRunStream, verifyResult, sanitizeOutput, auditRun } = await import("@/lib/litt-runtime");
  const { resolveRuntimeAgent } = await import("@/lib/agent-runtime");
  const { parseAgentSelection } = await import("@/lib/agent-selection");

  const ctx = await resolveRequestContext(httpRequest, req);
  if (!ctx.isAuthenticated && !ctx.isDev && !ctx.isAnonymousCompanion) {
    return openaiError("Authentication required", "authentication_error", 401);
  }

  let runtimeAgent = null;
  if (req.agentInstanceId && ctx.clerkId) {
    const selection = parseAgentSelection(req.agentInstanceId);
    if (selection) {
      const result = await resolveRuntimeAgent({ clerkId: ctx.clerkId, selection });
      if (result.ok && result.agent) runtimeAgent = result.agent;
    }
  }

  const prompt = buildPrompt(ctx, req, runtimeAgent);
  const completionId = `chatcmpl-litt-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let assistantText = "";
      try {
        // Send the initial role chunk
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model: "litt-voice",
              choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
            })}\n\n`,
          ),
        );

        const result = await executeRunStream(req, prompt.fullPrompt, prompt.systemPrompt, {
          onText: (chunk) => {
            const clean = sanitizeOutput(chunk);
            assistantText += clean;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: completionId,
                  object: "chat.completion.chunk",
                  created,
                  model: result.model || "litt-voice",
                  choices: [{ index: 0, delta: { content: clean }, finish_reason: null }],
                })}\n\n`,
              ),
            );
          },
        });

        const verified = verifyResult(assistantText);
        auditRun({
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          projectId: ctx.projectId,
          mode: "voice",
          agentSlug: req.agentSlug,
          agentInstanceId: runtimeAgent?.agentInstanceId ?? undefined,
          provider: result.provider,
          model: result.model,
          latencyMs: result.latencyMs,
          status: verified.ok ? "completed" : "failed",
          errorClass: verified.warning,
        });

        // Send the final chunk with finish_reason
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model: result.model || "litt-voice",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "stream error";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              error: { message: errorMsg, type: "server_error" },
            })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function openaiError(message: string, type: string, status: number): NextResponse {
  return NextResponse.json(
    { error: { message, type } },
    { status },
  );
}

export const POST = withRateLimit(handler, 60, 60);
