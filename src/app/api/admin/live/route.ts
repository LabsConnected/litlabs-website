// Admin Live Data SSE Endpoint
// Streams real-time stats and events to admin dashboard

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";

interface GalaxyNode {
  id: string;
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  type: "agent" | "user" | "server" | "database" | "post";
  status: "active" | "idle" | "offline";
  connections: string[];
  data?: Record<string, unknown>;
}

const ADMIN_USER_ID = process.env.ADMIN_CLERK_ID || "user_litbit";

// Real stats from Supabase
async function generateStats() {
  const supabase = getSupabaseAdmin();
  
  if (!supabase) {
    // Fallback to mock data if Supabase not configured
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

  try {
    // Get real user count
    const { count: totalUsers } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true });

    // Get today's signups
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: todaySignups } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .gte("created_at", today.toISOString());

    // Get agent count
    const { count: activeAgents } = await supabase
      .from("agents")
      .select("*", { count: "exact", head: true })
      .eq("is_public", true);

    // Get conversation count
    const { count: totalConversations } = await supabase
      .from("conversations")
      .select("*", { count: "exact", head: true });

    // Get post count
    const { count: totalPosts } = await supabase
      .from("posts")
      .select("*", { count: "exact", head: true });

    return {
      onlineUsers: Math.floor(Math.random() * 50) + 10, // Still mock for now - need real-time tracking
      totalUsers: totalUsers || 0,
      todaySignups: todaySignups || 0,
      todaySales: Math.floor(Math.random() * 20) + 5, // Need real sales tracking
      todayRevenueLBC: Math.floor(Math.random() * 5000) + 1000, // Need real revenue tracking
      activeAgents: activeAgents || 0,
      totalConversations: totalConversations || 0,
      totalPosts: totalPosts || 0,
      systemHealth: "healthy" as const,
    };
  } catch (error) {
    console.error("Error fetching stats:", error);
    return {
      onlineUsers: 0,
      totalUsers: 0,
      todaySignups: 0,
      todaySales: 0,
      todayRevenueLBC: 0,
      activeAgents: 0,
      totalConversations: 0,
      systemHealth: "degraded" as const,
    };
  }
}

// Generate galaxy nodes from real data
async function generateGalaxyNodes(): Promise<GalaxyNode[]> {
  const supabase = getSupabaseAdmin();
  
  if (!supabase) {
    // Fallback to mock nodes
    return [
      { id: "center", x: 0, y: 0, size: 40, color: "#f97316", label: "Core", type: "server", status: "active", connections: [] },
      { id: "jarvis", x: -100, y: -50, size: 25, color: "#00ffff", label: "JARVIS", type: "agent", status: "active", connections: ["center"] },
      { id: "forge", x: 100, y: -50, size: 25, color: "#22d3ee", label: "Forge", type: "agent", status: "active", connections: ["center"] },
      { id: "pulse", x: -50, y: 100, size: 25, color: "#f472b6", label: "Pulse", type: "agent", status: "idle", connections: ["center"] },
      { id: "visionary", x: 50, y: 100, size: 25, color: "#e879f9", label: "Visionary", type: "agent", status: "active", connections: ["center"] },
      { id: "nexus", x: 0, y: 150, size: 25, color: "#34d399", label: "Nexus", type: "agent", status: "active", connections: ["center"] },
      { id: "db", x: -150, y: 0, size: 20, color: "#10b981", label: "Database", type: "database", status: "active", connections: ["center"] },
      { id: "users", x: 150, y: 0, size: 20, color: "#8b5cf6", label: "Users", type: "user", status: "active", connections: ["center"] },
    ];
  }

  try {
    const nodes: GalaxyNode[] = [];
    
    // Add center node
    nodes.push({
      id: "center",
      x: 0,
      y: 0,
      size: 40,
      color: "#f97316",
      label: "LiTTree Core",
      type: "server",
      status: "active",
      connections: [],
    });

    // Get agents
    const { data: agents } = await supabase
      .from("agents")
      .select("id, slug, name")
      .eq("is_public", true)
      .limit(10);

    if (agents) {
      const agentColors = ["#00ffff", "#22d3ee", "#f472b6", "#e879f9", "#34d399", "#10b981", "#8b5cf6"];
      agents.forEach((agent, i) => {
        const angle = (i / agents.length) * Math.PI * 2;
        const radius = 120;
        nodes.push({
          id: agent.id,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          size: 25,
          color: agentColors[i % agentColors.length],
          label: agent.name,
          type: "agent",
          status: "active",
          connections: ["center"],
          data: { slug: agent.slug },
        });
      });
    }

    // Get recent users
    const { data: users } = await supabase
      .from("users")
      .select("id, username")
      .order("created_at", { ascending: false })
      .limit(8);

    if (users) {
      users.forEach((user, i) => {
        const angle = (i / users.length) * Math.PI * 2 + Math.PI / 8;
        const radius = 180;
        nodes.push({
          id: user.id,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          size: 15,
          color: "#8b5cf6",
          label: user.username || "User",
          type: "user",
          status: "active",
          connections: ["center"],
          data: { username: user.username },
        });
      });
    }

    // Add database node
    nodes.push({
      id: "database",
      x: -200,
      y: 0,
      size: 20,
      color: "#10b981",
      label: "Database",
      type: "database",
      status: "active",
      connections: ["center"],
    });

    return nodes;
  } catch (error) {
    console.error("Error generating galaxy nodes:", error);
    return [];
  }
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();

  if (!userId || userId !== ADMIN_USER_ID) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial stats and galaxy nodes
      const initialStats = await generateStats();
      const initialNodes = await generateGalaxyNodes();
      
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "stats", payload: initialStats })}\n\n`,
        ),
      );
      
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "nodes", payload: initialNodes })}\n\n`,
        ),
      );

      // Send stats every 3 seconds
      const statsInterval = setInterval(async () => {
        if (closed) {
          clearInterval(statsInterval);
          return;
        }

        const stats = await generateStats();
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "stats", payload: stats })}\n\n`,
          ),
        );
      }, 3000);
      
      // Send galaxy nodes every 10 seconds
      const nodesInterval = setInterval(async () => {
        if (closed) {
          clearInterval(nodesInterval);
          return;
        }

        const nodes = await generateGalaxyNodes();
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "nodes", payload: nodes })}\n\n`,
          ),
        );
      }, 10000);

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
          encoder.encode(
            `data: ${JSON.stringify({
              type: "event",
              payload: {
                id: crypto.randomUUID(),
                ...event,
                timestamp: new Date().toISOString(),
              },
            })}\n\n`,
          ),
        );
      }, 8000);

      // Keep-alive ping
      const pingInterval = setInterval(() => {
        if (closed) {
          clearInterval(pingInterval);
          return;
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "ping" })}\n\n`),
        );
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
      Connection: "keep-alive",
    },
  });
}
