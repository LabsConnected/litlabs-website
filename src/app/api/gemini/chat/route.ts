import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { streamText, generateText } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/gemini/chat
 * Body: { message, systemPrompt?, task?, stream?: boolean }
 *
 * When stream=true: returns Server-Sent Events with `data: {"text":"..."}\n\n` chunks
 *                  and ends with `data: [DONE]\n\n`.
 * When stream=false: returns JSON { response, provider, model, latencyMs }.
 */
async function handler(req: NextRequest) {
  try {
    const body = await req.json();
    const { systemPrompt, task, stream = false, preferFree } = body;

    /* Support both single message and multi-turn history array */
    let prompt: string;
    if (Array.isArray(body.messages) && body.messages.length > 0) {
      /* Flatten history into a single prompt Gemini can understand */
      prompt = body.messages
        .map((m: { role: string; content: string }) =>
          `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
        )
        .join("\n\n");
    } else if (typeof body.message === "string") {
      prompt = body.message;
    } else {
      return NextResponse.json({ error: "Missing message or messages" }, { status: 400 });
    }

    if (!stream) {
      const r = await generateText(
        prompt,
        { task: task || "chat", preferFree: !!preferFree, maxTokens: 2048 },
        systemPrompt,
      );
      return NextResponse.json({
        response: r.text,
        text: r.text,
        provider: r.provider,
        model: r.model,
        latencyMs: r.latencyMs,
        failover: r.failover,
      });
    }

    /* Streaming SSE response */
    const encoder = new TextEncoder();
    const sse = new ReadableStream({
      async start(controller) {
        try {
          const r = await streamText(
            prompt,
            (chunk) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
            },
            { task: task || "chat", preferFree: !!preferFree, maxTokens: 2048 },
            systemPrompt,
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, provider: r.provider, model: r.model, latencyMs: r.latencyMs })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          const msg = err instanceof Error ? err.message : "stream error";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(sse, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("LLM chat route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 60, 60);
