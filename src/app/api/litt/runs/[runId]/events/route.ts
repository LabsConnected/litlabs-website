/**
 * GET /api/litt/runs/[runId]/events — SSE stream for run events.
 *
 * Streams events from the litt_run_events table. Supports reconnection:
 * the `after` query parameter replays events after a given sequence.
 *
 * The stream stays open until the run reaches a terminal state
 * (completed, failed, cancelled) and all events have been sent.
 */

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getRun, getEventsAfter } from "@/lib/litt/run-repository";
import { formatSSEEvent, type LiTTRunEvent } from "@/lib/litt/run-contract";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUserId(): Promise<string | null> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return "demo-user-00000000-0000-0000-0000-000000000000";
  }
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { data: user } = await sb
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();
  return (user?.id as string) ?? null;
}

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { runId } = await params;

  // Verify the run exists and belongs to the user
  const run = await getRun(runId);
  if (!run || run.user_id !== userId) {
    return new Response(JSON.stringify({ error: "Run not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse afterSequence from query params (for reconnection)
  const url = new URL(req.url);
  const afterParam = url.searchParams.get("after");
  const afterSequence = afterParam ? parseInt(afterParam, 10) || 0 : 0;

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let lastSequence = afterSequence;

      // Send a comment to keep the connection alive
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Helper to send an event
      const sendEvent = (event: {
        sequence: number;
        type: string;
        payload: Record<string, unknown>;
        created_at: string;
      }) => {
        const runEvent = {
          runId,
          sequence: event.sequence,
          timestamp: event.created_at,
          ...event.payload,
        } as LiTTRunEvent;
        controller.enqueue(encoder.encode(formatSSEEvent(runEvent)));
        lastSequence = event.sequence;
      };

      try {
        // Replay events after the last sequence
        const events = await getEventsAfter(runId, lastSequence);
        for (const event of events) {
          sendEvent(event);
        }

        // Poll for new events until terminal state
        while (true) {
          // Check if run is in terminal state
          const currentRun = await getRun(runId);
          if (!currentRun) break;

          // Get any new events
          const newEvents = await getEventsAfter(runId, lastSequence);
          for (const event of newEvents) {
            sendEvent(event);
          }

          // If terminal and all events sent, close the stream
          if (TERMINAL_STATES.has(currentRun.status)) {
            // One final check for any events that arrived after our last fetch
            const finalEvents = await getEventsAfter(runId, lastSequence);
            for (const event of finalEvents) {
              sendEvent(event);
            }
            break;
          }

          // Wait before polling again
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch {
        // Send an error event
        controller.enqueue(
          encoder.encode(
            `event: stream.error\ndata: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
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
