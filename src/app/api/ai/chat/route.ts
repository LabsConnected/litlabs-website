import { NextRequest, NextResponse } from "next/server";
import { runAI } from "@/lib/ai/providers";

export async function POST(req: NextRequest) {
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

    const reply = await runAI({
      provider: "ollama",
      model,
      messages: [
        {
          role: "system",
          content:
            "You are Jarvis, the AI operating layer for LiTTree LabStudios. Be direct, useful, and practical.",
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    return NextResponse.json({
      ok: true,
      provider: "ollama",
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
