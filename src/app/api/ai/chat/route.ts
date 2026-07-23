import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runAI } from "@/lib/ai/providers";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();

    const message = body.message;
    const model = body.model ?? "llama3.2:3b";

    if (!message) {
      return NextResponse.json(
        { error: "Missing message" },
        { status: 400 }
      );
    }

    const messages = [
      {
        role: "system" as const,
        content:
          "You are LiTT, the AI operating layer for LiTTree-LabStudios. Be direct, useful, and practical.",
      },
      { role: "user" as const, content: message },
    ];

    let reply: string;
    let provider: "ollama" | "openrouter" = "ollama";
    try {
      reply = await runAI({ provider: "ollama", model, messages });
    } catch (ollamaErr) {
      try {
        reply = await runAI({
          provider: "openrouter",
          model: "google/gemini-2.5-flash",
          messages,
        });
        provider = "openrouter";
      } catch {
        const errMsg = ollamaErr instanceof Error ? ollamaErr.message : "AI backend unavailable";
        throw new Error(errMsg);
      }
    }

    return NextResponse.json({
      ok: true,
      provider,
      model,
      reply,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
