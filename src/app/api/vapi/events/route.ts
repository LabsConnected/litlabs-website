import { NextRequest, NextResponse } from "next/server";
import { authorizeVapiRequest } from "@/lib/vapi-tools";
import { rateLimit } from "@/lib/rate-limiter";
import {
  startVoiceSession,
  endVoiceSession,
  getVoiceSession,
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
 * Vapi event format (current — wrapped in `message` envelope):
 *   {
 *     message: {
 *       type: "status-update" | "assistant-request" | "tool-call" | "end-of-call-report",
 *       call: { id, assistantId, status, customer, ... },
 *       artifact?: { ... },
 *       status?: string,         // for status-update, lives in message not call
 *       endedReason?: string,    // for end-of-call-report
 *       timestamp: string,
 *     }
 *   }
 *
 * Backward compat: unwrapped { type, call, artifact } is also accepted
 * so existing tests and older Vapi payloads keep working.
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

  // Vapi wraps server events in a `message` envelope. Accept both
  // wrapped (current Vapi) and unwrapped (legacy/tests) payloads.
  const message = (body.message as Record<string, unknown> | undefined) ?? body;
  const type = message.type as string | undefined;
  const call = message.call as Record<string, unknown> | undefined;
  const callId = call?.id as string | undefined;
  const artifact = message.artifact as Record<string, unknown> | undefined;

  switch (type) {
    case "status-update": {
      const status = (message.status as string) ?? (call?.status as string) ?? "unknown";
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
      if (status === "ended") {
        // Vapi's documented statuses are: scheduled, queued, ringing,
        // in-progress, forwarding, ended. Failed/no-answer/busy are
        // endedReason values (on end-of-call-report), not status values.
        // The end-of-call-report case below handles those with richer
        // artifact data.
        if (callId) {
          await endVoiceSession("vapi", callId, { callStatus: status });
        }
      }
      return NextResponse.json({ ok: true });
    }

    case "end-of-call-report": {
      if (callId) {
        await endVoiceSession("vapi", callId, {
          artifact: artifact
            ? {
                durationMs: artifact.durationMs,
                transcript: artifact.transcript ? "[redacted]" : undefined,
                messages: artifact.messages ? `[${Array.isArray(artifact.messages) ? artifact.messages.length : 0} messages]` : undefined,
              }
            : undefined,
        });

        // Send normalized call payload to n8n for orchestration (async, non-blocking)
        const customer = call?.customer as Record<string, unknown> | undefined;
        const callerPhone = (customer?.number as string) ?? "";
        const transcript = typeof artifact?.transcript === "string"
          ? artifact.transcript
          : Array.isArray(artifact?.messages)
            ? (artifact.messages as Array<{ role?: string; message?: string; content?: string }>)
                .map((m) => `${m.role ?? "unknown"}: ${m.message ?? m.content ?? ""}`)
                .join("\n")
            : "";
        const startedAt = (call?.startedAt as string) ?? new Date(Date.now() - (artifact?.durationMs as number ?? 0)).toISOString();
        const endedAt = (call?.endedAt as string) ?? new Date().toISOString();
        const durationMs = (artifact?.durationMs as number) ?? 0;
        const callStatus = (call?.status as string) ?? "ended";

        void (async () => {
          try {
            const { buildCallPayload } = await import("@/lib/voice/ghl-payload-builder");
            const { sendCallToN8n } = await import("@/lib/voice/n8n-sender");

            // Try to get session data for user/project context
            const session = await getVoiceSession("vapi", callId);
            const payload = await buildCallPayload({
              callId,
              to: process.env.LITTLABS_BUSINESS_PHONE ?? "+13239165462",
              from: callerPhone,
              callerName: session?.callerName ?? null,
              startedAt,
              endedAt,
              durationMs,
              status: callStatus,
              transcript,
              isKnownUser: Boolean(session?.userId),
              userId: session?.userId ?? null,
              projectId: session?.projectId ?? null,
              projectName: null,
              conversationId: session?.conversationId ?? null,
            });

            await sendCallToN8n(payload);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[n8n] end-of-call orchestration failed: ${msg}`);
          }
        })();
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
          `Conversation ID: ${session.conversationId ?? "none"}.`
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
