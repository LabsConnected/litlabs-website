import { Supermemory } from "supermemory";
import { generateText, streamText, type LLMProvider } from "@/lib/llm";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { sanitizeProviderError } from "@/lib/provider-error";

export const runtime = "nodejs";
export const maxDuration = 60;

function getSupermemory() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) return null;
  try {
    return new Supermemory({ apiKey: key });
  } catch {
    return null;
  }
}

const MODELS: Record<string, string> = {
  "gemini-flash": "gemini",
  "llama-nemotron": "openrouter-llama",
  "gpt-4o": "openrouter-free",
  "claude-sonnet": "openrouter-free",
  "qwen-coder": "openrouter-qwen",
};

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  } as const;
}

function sseEncode(encoder: TextEncoder, data: unknown) {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

async function handler(req: NextRequest) {
  try {
    const { userId } = await auth();
    const uid = userId || "anonymous";

    const { messages, model = "gemini-flash", stream = false } = await req.json();
    if (!messages || !messages.length) {
      return NextResponse.json({ error: "Messages required" }, { status: 400 });
    }

    const lastMessage = messages[messages.length - 1]?.content || "";

    let memoryContext = "";
    const sm = getSupermemory();
    if (sm) {
      try {
        const memoryResults = await sm.search.memories({
          q: lastMessage,
          containerTag: uid,
          limit: 8,
        });
        memoryContext = (memoryResults.results || [])
          .map((m: { memory?: string; chunk?: string }) => m.memory || m.chunk)
          .filter(Boolean)
          .join("\n");
      } catch {
        // non-fatal
      }
    }

    const systemPrompt = `You are a helpful code builder assistant. Generate clean, working code.
Always wrap code in triple backticks with the language specified.
If generating HTML, make it a complete standalone file.
If multiple files, use comments like // filename.ext before each code block.

${memoryContext ? `Relevant context from memory:\n${memoryContext}` : ""}

Be direct, professional, and code-focused.`;

    const selectedProvider = (MODELS[model] || "gemini") as LLMProvider;

    // ---- Streaming path (faster perceived time-to-first-token) ----
    if (stream) {
      const encoder = new TextEncoder();
      const sse = new ReadableStream({
        async start(controller) {
          let fullText = "";
          try {
            const r = await streamText(
              lastMessage,
              (chunk) => {
                fullText += chunk;
                controller.enqueue(sseEncode(encoder, { text: chunk }));
              },
              { task: "code", provider: selectedProvider, maxTokens: 4096 },
              systemPrompt,
            );
            controller.enqueue(
              sseEncode(encoder, {
                done: true,
                provider: r.provider,
                model: r.model,
                latencyMs: r.latencyMs,
              }),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            // Persist to memory in the background
            if (sm && fullText) {
              sm.add({
                content: `User: ${lastMessage}\nAssistant: ${fullText}`,
                containerTag: uid,
                metadata: { type: "canvas-build", model },
              }).catch(() => { });
            }
          } catch (err) {
            const { error: msg } = sanitizeProviderError(err);
            controller.enqueue(sseEncode(encoder, { error: msg }));
          } finally {
            controller.close();
          }
        },
      });
      return new Response(sse, { headers: sseHeaders() });
    }

    // ---- Non-streaming path (back-compat) ----
    const result = await generateText(
      lastMessage,
      { task: "code", provider: selectedProvider, maxTokens: 4096 },
      systemPrompt,
    );

    if (sm) {
      sm.add({
        content: `User: ${lastMessage}\nAssistant: ${result.text}`,
        containerTag: uid,
        metadata: { type: "canvas-build", model },
      }).catch(() => { });
    }

    return NextResponse.json({
      text: result.text,
      provider: result.provider,
      model: result.model,
    });
  } catch (error: unknown) {
    console.error("[ai-chat] Error:", error);
    const { status, error: errorMessage, retryAfter } =
      sanitizeProviderError(error);
    return NextResponse.json(
      { error: errorMessage, retryAfter },
      { status },
    );
  }
}

export const POST = withRateLimit(handler, 30, 60);
