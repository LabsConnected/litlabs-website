import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { orchestrator } from "@/lib/agents";
import { generateText } from "@/lib/llm";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserByClerkId } from "@/lib/user-db";
import { Supermemory } from "supermemory";
import { getStudioContext, buildCapabilityContextForChat } from "@/lib/capabilities/studio-context";

function getSupermemory() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) throw new Error("SUPERMEMORY_API_KEY is not configured");
  return new Supermemory({ apiKey: key });
}

function hasSupermemory() {
  return Boolean(process.env.SUPERMEMORY_API_KEY?.trim());
}

async function recallMemories(
  userId: string,
  query: string,
  limit: number = 5,
) {
  try {
    if (hasSupermemory()) {
      try {
        const results = (await getSupermemory().search.memories({
          q: query,
          containerTag: `${userId}:conversation`,
          limit,
        })) as {
          memories?: { metadata?: { supabaseMemoryId?: string }; content?: string }[];
          results?: { metadata?: { supabaseMemoryId?: string }; content?: string }[];
        };
        const hits = results.memories || results.results || [];
        const ids = hits
          .map((h) => h.metadata?.supabaseMemoryId)
          .filter(Boolean) as string[];
        if (ids.length) {
          const { data } = await supabaseAdmin
            .from("memories")
            .select("*")
            .in("id", ids)
            .eq("owner_id", userId)
            .limit(limit);
          if (data?.length) return data;
        }
      } catch (err) {
        console.error("Supermemory recall failed:", err);
      }
    }
    const { data } = await supabaseAdmin
      .from("memories")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return data || [];
  } catch (err) {
    console.error("recallMemories failed:", err);
    return [];
  }
}

async function persistMemory(
  userId: string,
  content: string,
  options: { agentId?: string; scope?: string; source?: string; reason?: string } = {},
) {
  try {
    const scope = options.scope || "conversation";
    const source = options.source || "agent-chat";
    const containerTag = scope ? `${userId}:${scope}` : userId;

    const { data: record, error: insertError } = await supabaseAdmin
      .from("memories")
      .insert({
        owner_id: userId,
        agent_id: options.agentId || null,
        content,
        scope,
        source,
        reason: options.reason || null,
        sync_status: "pending",
      })
      .select()
      .single();

    if (insertError || !record) {
      console.error("Supabase memory insert failed:", insertError);
      return null;
    }

    let supermemoryId: string | null = null;
    if (hasSupermemory()) {
      try {
        const metadata: Record<string, string | number | boolean | string[]> = {
          ownerId: userId,
          scope,
          source,
          supabaseMemoryId: record.id,
        };
        if (options.agentId) metadata.agentId = options.agentId;
        const result = (await getSupermemory().add({
          content,
          containerTag,
          metadata,
        })) as { id?: string; memoryId?: string; memory_id?: string; externalId?: string };
        supermemoryId = result.id || result.memoryId || result.memory_id || result.externalId || null;
      } catch (err) {
        console.error("Supermemory index failed:", err);
      }
    }

    await supabaseAdmin
      .from("memories")
      .update({
        supermemory_id: supermemoryId,
        sync_status: supermemoryId ? "synced" : "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id);

    return record.id;
  } catch (err) {
    console.error("persistMemory failed:", err);
    return null;
  }
}

const PROJECT_CONTEXT = `
You operate inside the LiTTree-LabStudios platform (also called LiTT for the agent layer). The current project is the litlab monorepo:
- Stack: Next.js 16 + React 19 + TypeScript + Tailwind CSS v4 + Turbopack
- Backend: Supabase (Postgres), Clerk auth, Stripe payments, Cloudflare R2
- AI providers: OpenRouter, Gemini, Together, Fal, MiniMax
- Key surfaces: Studio (AI workspace with LiTT Director), Dashboard, Projects/Deployments (GitHub-backed), Game Cloud, Marketplace, Social feed, Gallery
- Agent team: LiTT Director (you), Forge (code), Visionary (image/media), Pulse (growth/content), Nexus (automations/integrations)
- Current repository: LabsConnected/litlabs-website on GitHub, deployed on Vercel
- You already have access to project files via scan, memory, and agent tools. When the user asks what you're building or what you know, reference this context.`;

function buildDirectorPrompt(userName: string, capabilityContext: string): string {
  const name = userName || "the user";
  return `You are LiTT Director — ${name}'s personal AI crew chief inside LiTTree-LabStudios.

${PROJECT_CONTEXT}

${capabilityContext}

IMPORTANT: Before answering questions about project state, coding readiness, or what's connected, review the STUDIO CAPABILITY STATE above. Never claim something is ready, connected, or running if the capability state says otherwise. If there is a NEXT BLOCKER, mention it and suggest the repair action.

Personality: sharp, confident, concise, occasionally sardonic. You address ${name} by their name (${name}). You do not over-explain.

Job: understand ${name}'s intent, plan the work, delegate to specialist agents when useful, and present results clearly. Always explain what you did in plain terms before showing artifacts or code.

When asked to generate images, describe what you are going to create and then confirm it is ready. Never dump base64 or internal system details in conversation.

If a request requires approval or is ambiguous, ask one clear question. Prefer action over endless planning.`;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { agentId, message } = await req.json();
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    // Resolve legacy or drawer IDs to the canonical director agent
    const resolvedId =
      agentId === "litt-director" || agentId === "director" || !agentId
        ? "director"
        : agentId;

    // Fetch the user's profile name so the agent can address them personally
    const userProfile = await getUserByClerkId(userId);
    const userName = userProfile?.name || "";

    // Fetch real capability state for the studio context
    let capabilityContext = "";
    try {
      const ctx = await getStudioContext();
      capabilityContext = buildCapabilityContextForChat(ctx);
    } catch {
      // non-fatal — continue without capability context
    }

    const directorPrompt = buildDirectorPrompt(userName, capabilityContext);

    const agent = orchestrator.getAgent(resolvedId);
    const recalled = await recallMemories(userId, message, 5);
    const memoryContext = recalled.length
      ? `RELEVANT MEMORY:\n${recalled.map((m) => `- ${m.content}`).join("\n")}\n`
      : "";

    if (!agent && resolvedId === "director") {
      // Fallback: create a minimal director agent if not initialized
      const r = await generateText(
        `${directorPrompt}\n\n${memoryContext}USER: ${message}\n\nRespond as LiTT Director. Be direct and useful.`,
        { task: "chat" },
      );
      const response = r.text || "I'm on it.";
      // Persist the fallback chat turn as well.
      void persistMemory(userId, `User said: ${message}`, {
        agentId: resolvedId,
        scope: "conversation",
        source: "agent-chat-fallback",
        reason: "user chat",
      });
      void persistMemory(userId, `I replied: ${response}`, {
        agentId: resolvedId,
        scope: "conversation",
        source: "agent-chat-fallback",
        reason: "director reply",
      });
      return NextResponse.json({
        agent: { id: "director", name: "LiTT Director", role: "Director" },
        response,
        userName,
      });
    }
    if (!agent) {
      return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
    }

    orchestrator.addToMemory(resolvedId, `User said: ${message}`);
    const response = await orchestrator.simulateAgentResponse(
      resolvedId,
      message,
      memoryContext,
    );
    orchestrator.addToMemory(resolvedId, `I replied: ${response}`);

    // Persist to durable Supabase + Supermemory memory (non-blocking).
    void persistMemory(userId, `User said: ${message}`, {
      agentId: resolvedId,
      scope: "conversation",
      source: "agent-chat",
      reason: "user chat",
    });
    void persistMemory(userId, `I replied: ${response}`, {
      agentId: resolvedId,
      scope: "conversation",
      source: "agent-chat",
      reason: "director reply",
    });

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name, role: agent.role },
      response,
      userName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
