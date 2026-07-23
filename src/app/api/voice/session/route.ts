import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { voiceSessionManager } from "@/server/voice/sessionManager";
import { isDeepgramConfigured } from "@/server/voice/deepgram";
import { getVoiceConfigStatus } from "@/server/voice/elevenlabs";
import type { VoiceAgentId } from "@/features/voice/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const agentId: VoiceAgentId = body.agentId === "spark" ? "spark" : "litt";

  const sessionId = voiceSessionManager.createSession(userId, agentId);

  const deepgramReady = isDeepgramConfigured();
  const elevenLabsStatus = getVoiceConfigStatus();

  return NextResponse.json({
    sessionId,
    agentId,
    deepgramReady,
    elevenLabsReady: elevenLabsStatus.apiKey,
    voiceConfigured: agentId === "spark" ? elevenLabsStatus.sparkVoiceId : elevenLabsStatus.littVoiceId,
    sampleRate: parseInt(process.env.NEXT_PUBLIC_VOICE_SAMPLE_RATE || "48000", 10),
  });
}

export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (sessionId) {
    voiceSessionManager.endSession(sessionId);
  }

  return NextResponse.json({ success: true });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessions = voiceSessionManager.getUserSessions(userId);
  return NextResponse.json({
    activeSessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      agentId: s.agentId,
      state: s.state,
      startedAt: s.startedAt,
    })),
  });
}
