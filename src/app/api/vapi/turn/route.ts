import { NextRequest, NextResponse } from "next/server";
import { authorizeVapiRequest } from "@/lib/vapi-tools";
import { getVoiceSession } from "@/lib/voice/voice-session-service";
import { runLiTTForVoice } from "@/lib/voice/voice-runtime";
import { insertMessage } from "@/lib/studio/conversation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/vapi/turn
 *
 * The canonical Vapi → LiTT bridge. When Vapi's Custom LLM needs a
 * response, it sends the user's transcript here. We:
 *
 *   1. Authenticate via Bearer token (LITTLABS_VAPI_TOOL_TOKEN)
 *   2. Look up the voice session by Vapi call ID
 *   3. Route the transcript through runLiTTForVoice() — same brain,
 *      same tools, same memory as Studio text
 *   4. Persist the user + assistant messages to the conversation
 *   5. Return the response text for Vapi to speak via TTS
 *
 * Vapi sends:
 *   {
 *     "call": { "id": "vapi_call_123", ... },
 *     "messages": [
 *       { "role": "user", "content": "How's my project looking?" }
 *     ]
 *   }
 *
 * We return:
 *   {
 *     "text": "Your project LabsConnected/litlabs-website is on the main branch..."
 *   }
 *
 * Or in OpenAI-compatible format (if Vapi uses Custom LLM mode):
 *   {
 *     "choices": [{ "message": { "role": "assistant", "content": "..." } }]
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

  // Look up the voice session
  const session = await getVoiceSession("vapi", callId);
  if (!session) {
    return NextResponse.json({
      text: "I'm sorry, I couldn't find your session. Please try calling again.",
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

  // Persist messages to the conversation (if we have one)
  if (session.userId && session.conversationId && session.projectId) {
    try {
      await insertMessage({
        conversationId: session.conversationId,
        ownerId: session.userId,
        projectId: session.projectId,
        role: "user",
        content: userMessage.content,
        status: "completed",
      });
      await insertMessage({
        conversationId: session.conversationId,
        ownerId: session.userId,
        projectId: session.projectId,
        role: "assistant",
        agentSlug: "litt",
        content: responseText,
        status: "completed",
      });
    } catch {
      // Message persistence is best-effort; do not fail the voice turn.
    }
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
