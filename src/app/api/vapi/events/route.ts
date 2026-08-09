import { NextRequest, NextResponse } from "next/server";
import { authorizeVapiRequest } from "@/lib/vapi-tools";
import {
  startVoiceSession,
  endVoiceSession,
  normalizePhone,
} from "@/lib/voice/voice-session-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/vapi/events
 *
 * Vapi call lifecycle webhook. Vapi sends server-level events here:
 *   - status-update (call started, ringing, ended)
 *   - tool-call (if using tool-based routing)
 *   - assistant-request (dynamic assistant config)
 *
 * We use this to:
 *   1. Create a voice_session when a call starts (caller → user → project)
 *   2. End the voice_session when the call ends
 *   3. Return a dynamically configured assistant for assistant-request
 *
 * Auth: Authorization: Bearer <LITTLABS_VAPI_TOOL_TOKEN>
 *
 * Vapi event format:
 *   {
 *     type: "status-update" | "assistant-request" | "tool-call" | "end-of-call-report",
 *     call: { id, assistantId, ... },
 *     message: { ... },
 *     artifact?: { ... },
 *     timestamp: string
 *   }
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authorizeVapiRequest(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = body.type as string | undefined;
  const call = body.call as Record<string, unknown> | undefined;
  const callId = call?.id as string | undefined;

  switch (type) {
    case "status-update": {
      const status = (call?.status as string) ?? "unknown";
      if (status === "ringing" || status === "in-progress" || status === "queued") {
        const customer = call?.customer as Record<string, unknown> | undefined;
        const callerPhone = (customer?.number as string) ?? "";
        if (callerPhone && callId) {
          await startVoiceSession({
            provider: "vapi",
            providerCallId: callId,
            callerPhone,
            metadata: { callStatus: status, assistantId: call?.assistantId },
          });
        }
      }
      if (status === "ended" || status === "failed" || status === "no-answer" || status === "busy") {
        if (callId) {
          await endVoiceSession("vapi", callId, { callStatus: status });
        }
      }
      return NextResponse.json({ ok: true });
    }

    case "end-of-call-report": {
      if (callId) {
        const artifact = body.artifact as Record<string, unknown> | undefined;
        await endVoiceSession("vapi", callId, {
          artifact: artifact
            ? {
                durationMs: artifact.durationMs,
                transcript: artifact.transcript ? "[redacted]" : undefined,
                messages: artifact.messages ? `[${Array.isArray(artifact.messages) ? artifact.messages.length : 0} messages]` : undefined,
              }
            : undefined,
        });
      }
      return NextResponse.json({ ok: true });
    }

    case "assistant-request": {
      const customer = call?.customer as Record<string, unknown> | undefined;
      const callerPhone = (customer?.number as string) ?? "";
      if (!callId) {
        return NextResponse.json({ error: "Missing call ID" }, { status: 400 });
      }

      const session = await startVoiceSession({
        provider: "vapi",
        providerCallId: callId,
        callerPhone,
        metadata: { assistantId: call?.assistantId },
      });

      const contextBlock = session.userId
        ? `You are on a phone call with ${session.callerName ?? "the user"}. ` +
          `Their active project is ${session.projectId ?? "not set"}. ` +
          `Conversation ID: ${session.conversationId ?? "none"}. ` +
          `Use the litt_turn tool to respond to the user.`
        : `You are on a phone call from ${normalizePhone(callerPhone)}. ` +
          `This number is not linked to a LiTT account. ` +
          `Ask if they'd like to learn about LiTTree Lab Studios.`;

      return NextResponse.json({
        assistantId: call?.assistantId,
        contextBlock,
        session: {
          userId: session.userId,
          projectId: session.projectId,
          conversationId: session.conversationId,
        },
      });
    }

    default:
      return NextResponse.json({ ok: true });
  }
}
