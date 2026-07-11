import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runAI } from "@/lib/ai/providers";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const messages = [
      {
        role: "system" as const,
        content:
          "You are LiTT, the AI operating layer for LiTTree LabStudios. You help users build software. " +
          "When asked for commands, prefer safe, explainable commands. " +
          "Warn about destructive operations. Keep responses concise and actionable.",
      },
      { role: "user" as const, content: prompt },
    ];

    let reply: string;
    try {
      reply = await runAI({ provider: "ollama", model: "llama3.2:3b", messages });
    } catch {
      reply = await runAI({
        provider: "openrouter",
        model: "google/gemini-2.5-flash",
        messages,
      });
    }

    return NextResponse.json({ answer: reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
