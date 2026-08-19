import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { executeBusinessTool, type ToolContext } from "@/lib/business-operations";

export const runtime = "nodejs";

/**
 * POST /api/litt/voice/tools
 *
 * ElevenLabs (and any OpenAI-compatible voice provider) tool-calling
 * webhook. When the voice agent decides a tool is needed, the provider
 * POSTs the tool call here. This endpoint routes it through the LiTT
 * Tool Registry — voice providers must NOT maintain their own separate
 * tool execution brain.
 *
 * Request (ElevenLabs Custom Tool format):
 *   {
 *     tool: string,           // tool ID, e.g. "business.bookings.create"
 *     parameters: object,     // tool input
 *     conversation_id: string,
 *     metadata?: {
 *       approvalId?: string,  // required for mutation tools
 *       ownerId?: string,     // the Clerk user ID (from session)
 *       projectId?: string,
 *     }
 *   }
 *
 * Response:
 *   {
 *     output: string,         // tool result as text (for TTS)
 *     ok: boolean,
 *     data?: unknown,         // raw tool result
 *   }
 */
async function handler(req: NextRequest) {
  const { userId, clerkId } = await auth(req);
  if (!userId) {
    return NextResponse.json(
      { ok: false, output: "Authentication required.", error: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, output: "Invalid request.", error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const toolId = body.tool;
  if (typeof toolId !== "string") {
    return NextResponse.json(
      { ok: false, output: "Tool name is required.", error: "tool is required" },
      { status: 400 },
    );
  }

  const input = body.parameters ?? {};
  const approvalId = (body.metadata as Record<string, unknown>)?.approvalId as string | undefined;
  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : null;
  const projectId = (body.metadata as Record<string, unknown>)?.projectId as string | null;

  const ctx: ToolContext = {
    ownerId: userId,
    clerkId,
    conversationId,
    projectId,
  };

  const result = await executeBusinessTool(toolId, input, ctx, approvalId);

  // Convert the result to a voice-friendly output string
  let outputText: string;
  if (!result.ok) {
    outputText = result.status === 403
      ? "This action requires approval. Please confirm before I proceed."
      : `I couldn't complete that: ${result.error}`;
  } else if (result.data && typeof result.data === "object") {
    // Summarize the result for voice — the full data is in the `data` field
    outputText = summarizeForVoice(result.data);
  } else {
    outputText = "Done.";
  }

  return NextResponse.json({
    ok: result.ok,
    output: outputText,
    data: result.data ?? null,
    error: result.ok ? undefined : result.error,
    status: result.status,
  });
}

/**
 * Convert a tool result into a short, speakable summary.
 * Voice responses should be concise — the full data is available in
 * the `data` field for the UI to render.
 */
function summarizeForVoice(data: unknown): string {
  if (Array.isArray(data)) {
    return `Found ${data.length} item${data.length === 1 ? "" : "s"}.`;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // Booking created
    if (obj.id && obj.status === "pending") {
      return "Booking created. It's pending confirmation.";
    }
    if (obj.id && obj.status === "confirmed") {
      return "Booking confirmed.";
    }
    if (obj.id && obj.status === "cancelled") {
      return "Booking cancelled.";
    }
    if (obj.id && obj.status === "rescheduled") {
      return "Booking rescheduled.";
    }
    // Service created
    if (obj.id && obj.duration_minutes) {
      return `Service created: ${obj.name}.`;
    }
    // Generic
    if (obj.id) {
      return "Done. The record has been updated.";
    }
    // Dashboard
    if (typeof obj.services === "number") {
      return `You have ${obj.services} services, ${obj.activeBookings} active bookings, and ${obj.pendingLeads} pending leads.`;
    }
  }
  return "Done.";
}

export const POST = withRateLimit(handler, 30, 60);
