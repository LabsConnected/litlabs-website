// Admin Live Data SSE Endpoint
// Streams real-time stats and events to admin dashboard

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabase } from "@/lib/supabase";

const ADMIN_USER_ID = process.env.ADMIN_CLERK_ID || "user_litbit";

// Mock stats generator for now
function generateStats() {
  return {
    onlineUsers: Math.floor(Math.random() * 50) + 10,
    totalUsers: 1337,
    todaySignups: Math.floor(Math.random() * 10) + 1,
    todaySales: Math.floor(Math.random() * 20) + 5,
    todayRevenueLBC: Math.floor(Math.random() * 5000) + 1000,
    activeAgents: 6,
    totalConversations: 4521,
    systemHealth: "healthy" as const,
  };
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  
  if (!userId || userId !== ADMIN_USER_ID) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial stats
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "stats", payload: generateStats() })}\n\n`)
      );

      // Send stats every 3 seconds
      const statsInterval = setInterval(() => {
        if (closed) {
          clearInterval(statsInterval);
          return;
        }
        
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "stats", payload: generateStats() })}\n\n`)
        );
      }, 3000);

      // Occasionally send events
      const eventsInterval = setInterval(() => {
        if (closed) {
          clearInterval(eventsInterval);
          return;
        }

        const events = [
          { type: "sale", message: "User bought Code Champion for 250 LBC" },
          { type: "signup", message: "New user signed up" },
          { type: "chat", message: "New agent conversation started" },
        ];
        
        const event = events[Math.floor(Math.random() * events.length)];
        
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ 
            type: "event", 
            payload: {
              id: crypto.randomUUID(),
              ...event,
              timestamp: new Date().toISOString(),
            }
          })}\n\n`)
        );
      }, 8000);

      // Keep-alive ping
      const pingInterval = setInterval(() => {
        if (closed) {
          clearInterval(pingInterval);
          return;
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`));
      }, 15000);

      // Cleanup
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(statsInterval);
        clearInterval(eventsInterval);
        clearInterval(pingInterval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
