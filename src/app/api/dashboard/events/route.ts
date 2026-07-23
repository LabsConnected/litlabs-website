import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Send initial snapshot of recent events
      try {
        const { data: recent } = await supabaseAdmin
          .from("integration_events")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(20);

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "snapshot", events: recent || [] })}\n\n`),
        );
      } catch {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Failed to load events" })}\n\n`),
        );
      }

      // Poll for new events every 5 seconds (SSE fallback without Supabase Realtime client)
      let lastCheck = new Date().toISOString();
      const interval = setInterval(async () => {
        try {
          const { data: newEvents } = await supabaseAdmin
            .from("integration_events")
            .select("*")
            .eq("user_id", userId)
            .gt("created_at", lastCheck)
            .order("created_at", { ascending: false })
            .limit(20);

          if (newEvents && newEvents.length > 0) {
            lastCheck = new Date().toISOString();
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "events", events: newEvents })}\n\n`),
            );
          } else {
            // Heartbeat
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`),
            );
          }
        } catch {
          // Non-fatal
        }
      }, 5000);

      // Clean up on abort
      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
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
