import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { meteredLlmCall } from "@/lib/metered-llm-call";
import { randomUUID } from "crypto";

async function handler(req: NextRequest) {
  const { userId, clerkId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const spendId = clerkId ?? userId;
  try {
    const body = await req.json().catch(() => ({}));

    const message = body.message;

    if (!message) {
      return NextResponse.json(
        { error: "Missing message" },
        { status: 400 }
      );
    }

    const systemPrompt =
      "You are LiTT, the AI operating layer for LiTTree-LabStudios. Be direct, useful, and practical. " +
      "Never claim voice, microphone, terminal, repository, or any system capability is working unless the request includes verified evidence. " +
      "If asked about system status without verified context, say that status is still being checked.";

    const call = await meteredLlmCall({
      clerkId: spendId,
      prompt: String(message),
      systemPrompt,
      llmOptions: { task: "chat" },
      feature: "ai-chat-legacy",
      callId: randomUUID(),
    });
    if (!call.ok) {
      return NextResponse.json({ ok: false, error: call.error, code: call.code }, { status: call.status });
    }

    return NextResponse.json({
      ok: true,
      provider: call.result.provider,
      model: call.result.model,
      reply: call.result.text,
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

export const POST = withRateLimit(handler, 10, 60);
