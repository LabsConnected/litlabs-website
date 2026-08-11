import { NextRequest, NextResponse } from "next/server";
import { authorizeVapiRequest } from "@/lib/vapi-tools";
import { rateLimit } from "@/lib/rate-limiter";
import { getVoiceSession, startVoiceSession } from "@/lib/voice/voice-session-service";
import { runLiTTForVoice } from "@/lib/voice/voice-runtime";
import { insertMessage } from "@/lib/studio/conversation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;
export const fetchCache = "force-no-store";

/**
 * POST /api/vapi/turn
 *
 * The canonical Vapi → LiTT bridge. When Vapi's Custom LLM needs a
 * response, it sends the user's transcript here. We:
 *
 *   1. Authenticate via Bearer token (LITTLABS_VAPI_TOOL_TOKEN)
 *   2. Look up the voice session by Vapi call ID (or resolve from call data)
 *   3. Route the transcript through runLiTTForVoice() — same brain,
 *      same tools, same memory as Studio text
 *   4. Persist the user + assistant messages to the conversation (async)
 *   5. Return the response text for Vapi to speak via TTS
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authorizeVapiRequest(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limiting (fail-open, same as /api/vapi/tools)
  const rateLimitResult = await rateLimit(req, 60, 60);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter: rateLimitResult.resetTime },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.resetTime),
          "X-RateLimit-Remaining": String(rateLimitResult.remaining),
        },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Extract the Vapi call ID
  const call = body.call as Record<string, unknown> | undefined;
  const callId = call?.id as string | undefined;
  if (!callId) {
    return NextResponse.json({ error: "Missing call ID" }, { status: 400 });
  }

  // Extract the latest user message
  const messages = body.messages as Array<{ role: string; content: string }> | undefined;
  const userMessage = messages?.findLast?.((m) => m.role === "user") ??
    messages?.filter((m) => m.role === "user").pop();

  if (!userMessage?.content) {
    return NextResponse.json({ error: "No user message found" }, { status: 400 });
  }

  // Try to look up the voice session first
  let session = await getVoiceSession("vapi", callId);

  // Fallback: if no session found (e.g. voice_sessions table missing or not yet created),
  // resolve the caller directly from the call data
  if (!session) {
    const customer = call?.customer as Record<string, unknown> | undefined;
    const callerPhone = (customer?.number as string) ?? "";
    if (callerPhone) {
      session = await startVoiceSession({
        provider: "vapi",
        providerCallId: callId,
        callerPhone,
        metadata: { assistantId: call?.assistantId, fallback: true },
      });
    }
  }

  if (!session) {
    return NextResponse.json({
      text: "I'm sorry, I couldn't identify your call. Please try calling again.",
    });
  }

  // Route through the LiTT Runtime
  const result = await runLiTTForVoice({
    userId: session.userId,
    projectId: session.projectId,
    conversationId: session.conversationId,
    message: userMessage.content,
  });

  if (result.status !== 200) {
    return NextResponse.json({ text: "I encountered an error. Please try again." }, { status: result.status });
  }

  const responseText = result.body.text;

  // Persist messages to the conversation asynchronously (do not block voice response)
  const uid = session.userId;
  const cid = session.conversationId;
  const pid = session.projectId;
  if (uid && cid && pid) {
    void (async () => {
      try {
        await insertMessage({
          conversationId: cid,
          ownerId: uid,
          projectId: pid,
          role: "user",
          content: userMessage.content,
          status: "completed",
        });
        await insertMessage({
          conversationId: cid,
          ownerId: uid,
          projectId: pid,
          role: "assistant",
          agentSlug: "litt",
          content: responseText,
          status: "completed",
        });
      } catch {
        // Message persistence is best-effort; do not fail the voice turn.
      }
    })();
  }

  // Return in OpenAI-compatible format (Vapi Custom LLM expects this)
  return NextResponse.json({
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: responseText,
        },
        finish_reason: "stop",
      },
    ],
    // Also include plain text for non-OpenAI-mode callers
    text: responseText,
  });
}
