import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { orchestrator } from "@/lib/agents";
import { generateText } from "@/lib/llm";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserByClerkId } from "@/lib/user-db";
import { Supermemory } from "supermemory";
import { getStudioContext, buildCapabilityContextForChat } from "@/lib/capabilities/studio-context";
import { detectAndExecuteTool } from "@/lib/litt-intelligence/tool-executor";
import {
  detectIntent,
  buildRuntimeContextBlock,
  buildToolManifest,
  generateProjectStatusAnswer,
  type RuntimeContextSnapshot,
} from "@/lib/litt-intelligence/runtime-context-injector";

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
      } catch (_err) {
      }
    }
    const { data } = await supabaseAdmin
      .from("memories")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return data || [];
  } catch (_err) {
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
      } catch (_err) {
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
  } catch (_err) {
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
- The platform is designed to connect to GitHub repositories, but you must check the STUDIO CONNECTION STATE below before claiming any repository is connected.`;

function buildDirectorPrompt(userName: string, capabilityContext: string): string {
  const name = userName || "the user";
  return `You are LiTT Director — ${name}'s personal AI crew chief inside LiTTree-LabStudios.

${PROJECT_CONTEXT}

${capabilityContext}

IMPORTANT: Before answering questions about project state, coding readiness, or what's connected, review the STUDIO CONNECTION STATE above. Never claim something is ready, connected, or running if the state says otherwise. Always give the user one clear next action. Do not use internal field names like "repository capability", "repositoryIndexed", or "terminalExecution" in conversation — translate them into plain English.

ANTI-BOILERPLATE RULES:
- Do NOT generate template code, placeholder text, "Your App Name", "Lorem Ipsum", or generic pricing.
- Do NOT create new components when existing ones can be reused. Inspect the codebase first.
- If information is unknown, ask the user or leave a TODO — never fabricate content.
- Think like you are editing a production SaaS, not scaffolding a tutorial.

Personality: sharp, confident, concise, occasionally sardonic. You address ${name} by their name (${name}). You do not over-explain.

Job: understand ${name}'s intent, plan the work, delegate to specialist agents when useful, and present results clearly. Always explain what you did in plain terms before showing artifacts or code.

When asked to generate images, describe what you are going to create and then confirm it is ready. Never dump base64 or internal system details in conversation.

If a request requires approval or is ambiguous, ask one clear question. Prefer action over endless planning.`;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { agentId, message } = await req.json();
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    // ── Deterministic intent routing ────────────────────────────
    // Detect intent BEFORE calling any tool or LLM. This ensures
    // project-status questions get exact runtime values, weather
    // questions call the weather tool, etc.
    const intent = detectIntent(message);

    // ── Real-time tool routing ──────────────────────────────────
    // Before calling the LLM, check whether the message matches a
    // real-time tool intent (weather, etc.). If a tool fires, return
    // the live result directly — the LLM never guesses real-time data.
    const toolResult = await detectAndExecuteTool(userId, message);
    if (toolResult.executed) {
      // Persist the exchange for memory continuity
      void persistMemory(userId, `User said: ${message}`, {
        agentId: "director",
        scope: "conversation",
        source: "agent-chat",
        reason: "user chat (tool-routed)",
      });
      void persistMemory(userId, `I replied: ${toolResult.text}`, {
        agentId: "director",
        scope: "conversation",
        source: "agent-chat",
        reason: "tool-executed reply",
      });

      return NextResponse.json({
        agent: { id: "director", name: "LiTT Director", role: "Director" },
        response: toolResult.text,
        userName: "",
        tool: toolResult.metadata,
        intent: intent.category,
      });
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
    let studioCtx: Awaited<ReturnType<typeof getStudioContext>> | null = null;
    try {
      studioCtx = await getStudioContext(userId);
      capabilityContext = buildCapabilityContextForChat(studioCtx);
    } catch {
      // non-fatal — continue without capability context
    }

    // Build runtime context snapshot for intent routing and context injection
    const runtimeSnapshot: RuntimeContextSnapshot = {
      projectId: null,
      projectName: null,
      repositoryConnected: studioCtx?.repositoryConnected ?? false,
      repositoryName: studioCtx?.repositoryName ?? null,
      activeBranch: null,
      workspaceStatus: null,
      workspaceReady: false,
      terminalConnected: studioCtx?.terminalConnected ?? false,
      terminalStatus: studioCtx?.terminalConnected ? "connected" : "disconnected",
      terminalSessionId: studioCtx?.terminalSessionId ?? null,
      deploymentStatus: null,
      deploymentUrl: null,
      writeAccess: false,
      approvalRequired: true,
      selectedModelLabel: null,
      selectedModelId: null,
      activeAgentMode: "standard",
      activeAgentSlug: "litt",
      recentHealthResults: [],
    };

    // Deterministic project-status answer — bypass LLM for accuracy
    if (intent.category === "project_status" && intent.confidence > 0) {
      const statusAnswer = generateProjectStatusAnswer(runtimeSnapshot);
      void persistMemory(userId, `User said: ${message}`, {
        agentId: "director",
        scope: "conversation",
        source: "agent-chat",
        reason: "user chat (intent-routed: project_status)",
      });
      void persistMemory(userId, `I replied: ${statusAnswer}`, {
        agentId: "director",
        scope: "conversation",
        source: "agent-chat",
        reason: "intent-routed reply",
      });
      return NextResponse.json({
        agent: { id: "director", name: "LiTT Director", role: "Director" },
        response: statusAnswer,
        userName,
        intentRouted: true,
        intent: intent.category,
      });
    }

    // Build runtime context block and tool manifest for the system prompt
    const runtimeContextBlock = buildRuntimeContextBlock(runtimeSnapshot);
    const toolManifest = buildToolManifest(runtimeSnapshot);

    const directorPrompt = buildDirectorPrompt(userName, `${capabilityContext}\n\n${runtimeContextBlock}\n\n${toolManifest.manifestBlock}`);

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
