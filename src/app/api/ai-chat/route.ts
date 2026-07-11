import { Supermemory } from "supermemory";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

function getSupermemory() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) throw new Error("SUPERMEMORY_API_KEY is not configured");
  return new Supermemory({ apiKey: key });
}

function getOpenRouter() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");
  return createOpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: key });
}

const MODELS: Record<string, string> = {
  "gemini-flash": "google/gemini-2.5-flash",
  "llama-nemotron": "nvidia/llama-3.1-nemotron-70b-instruct",
  "gpt-4o": "openai/gpt-4o",
  "claude-sonnet": "anthropic/claude-sonnet-4",
  "qwen-coder": "qwen/qwen3-coder",
};

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    const uid = userId || "anonymous";

    const { messages, model = "gemini-flash" } = await req.json();
    const lastMessage = messages[messages.length - 1]?.content || "";

    const memoryResults = await getSupermemory().search.memories({
      q: lastMessage,
      containerTag: uid,
      limit: 8,
    });

    const memoryContext = memoryResults.results
      .map((m: { memory?: string; chunk?: string }) => m.memory || m.chunk)
      .filter(Boolean)
      .join("\n");

    const systemPrompt = `You are a helpful assistant with long-term memory about this user.
Use the following memories to personalize your responses when relevant.

${memoryContext ? `Relevant memories:\n${memoryContext}` : "No relevant memories yet."}

Be concise, helpful, and natural.`;

    const selectedModel = MODELS[model] || MODELS["gemini-flash"];

    const result = streamText({
      model: getOpenRouter()(selectedModel),
      system: systemPrompt,
      messages,
      temperature: 0.7,
      maxOutputTokens: 2048,
      onFinish: async ({ text }) => {
        try {
          await getSupermemory().add({
            content: `User: ${lastMessage}\nAssistant: ${text}`,
            containerTag: uid,
            metadata: { type: "chat", model },
          });
        } catch {
          // non-fatal
        }
      },
    });

    return result.toTextStreamResponse();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Chat failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
