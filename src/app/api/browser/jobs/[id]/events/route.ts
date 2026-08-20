import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { authorizeVapiRequest, ownerClerkId } from "@/lib/vapi-tools";
import { getJob, getJobEvents, serializeJobEvent } from "@/lib/browser-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/browser/jobs/[id]/events
 *
 * Server-Sent Events stream for a browser job's event log.
 *
 * The Studio panel subscribes to this endpoint using EventSource and
 * receives events in real time as the job executes:
 *
 *   job.started, step.started, observation, action, verification,
 *   step.completed, retry, approval.required, job.completed, job.failed
 *
 * Protocol:
 *   - On connect: sends all existing events as individual SSE messages
 *   - Then polls every 1s for new events and streams them
 *   - Sends a heartbeat comment every 15s to keep the connection alive
 *   - Closes when the job reaches a terminal state and all events are sent
 *
 * Query params:
 *   ?since=<eventId> — only send events after this event ID (reconnect cursor)
 *
 * Auth (dual mode):
 *   1. Bearer token: Authorization: Bearer <LITTLABS_VAPI_TOOL_TOKEN>
 *   2. Clerk session cookie
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await ctx.params;
  if (!jobId) {
    return new Response("Missing job ID", { status: 400 });
  }

  // ─── Auth ──────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  let userId: string | null = null;

  if (authorizeVapiRequest(authHeader)) {
    userId = ownerClerkId();
  } else {
    const authResult = await auth(req);
    userId = authResult.userId;
  }

  if (!userId || userId === "anonymous-dev") {
    return new Response("Unauthorized", { status: 401 });
  }

  // ─── Verify job exists and belongs to user ─────────────────
  const job = await getJob(jobId, userId);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  // ─── SSE stream ────────────────────────────────────────────
  const url = new URL(req.url);
  const sinceId = url.searchParams.get("since") ?? undefined;

  const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let lastEventId = sinceId ?? null;
      let closed = false;

      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          closed = true;
        }
      };

      const sendEvent = (event: Record<string, unknown>) => {
        const id = event.id as string;
        const type = event.type as string;
        const payload = JSON.stringify(event);
        send(`id: ${id}\nevent: ${type}\ndata: ${payload}\n\n`);
      };

      const sendHeartbeat = () => {
        send(`: heartbeat\n\n`);
      };

      // Send initial events (existing history)
      try {
        const events = await getJobEvents(jobId, { sinceId: lastEventId ?? undefined });
        for (const event of events) {
          sendEvent(serializeJobEvent(event));
          lastEventId = event.id;
        }
      } catch {
        // If we can't load initial events, continue — the poll loop will retry
      }

      // Poll for new events
      const POLL_INTERVAL_MS = 1000;
      const HEARTBEAT_INTERVAL_MS = 15000;
      let lastHeartbeat = Date.now();
      let terminalEventsFlushed = false;

      const poll = async () => {
        if (closed) return;

        try {
          // Check if job is terminal
          const currentJob = await getJob(jobId, userId);
          if (!currentJob) {
            // Job was deleted — close stream
            send(`event: stream.end\ndata: {"reason":"job_deleted"}\n\n`);
            controller.close();
            closed = true;
            return;
          }

          // Fetch new events since last cursor
          const newEvents = await getJobEvents(jobId, {
            sinceId: lastEventId ?? undefined,
            limit: 100,
          });

          for (const event of newEvents) {
            sendEvent(serializeJobEvent(event));
            lastEventId = event.id;

            // If we see a terminal event, mark for flush
            if (event.type === "job.completed" || event.type === "job.failed") {
              terminalEventsFlushed = true;
            }
          }

          // Heartbeat
          if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
            sendHeartbeat();
            lastHeartbeat = Date.now();
          }

          // If job is terminal and we've flushed the terminal event, close
          if (TERMINAL_STATUSES.has(currentJob.status) && terminalEventsFlushed) {
            // One final poll to catch any events written after the terminal event
            const finalEvents = await getJobEvents(jobId, {
              sinceId: lastEventId ?? undefined,
              limit: 50,
            });
            for (const event of finalEvents) {
              sendEvent(serializeJobEvent(event));
              lastEventId = event.id;
            }

            send(`event: stream.end\ndata: {"reason":"job_terminal"}\n\n`);
            controller.close();
            closed = true;
            return;
          }
        } catch {
          // Network/transient error — keep polling
        }

        if (!closed) {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      };

      // Start polling after a short delay
      setTimeout(poll, POLL_INTERVAL_MS);

      // Clean up on cancel (client disconnects)
      req.signal.addEventListener("abort", () => {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
