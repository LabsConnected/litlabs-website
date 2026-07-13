import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { orchestrator } from "@/lib/agents";
import { generateText } from "@/lib/llm";

const PROJECT_CONTEXT = `
You operate inside the LiTTree-LabStudios platform (also called LiTT Code for the agent layer). The current project is the litlab monorepo:
- Stack: Next.js 16 + React 19 + TypeScript + Tailwind CSS v4 + Turbopack
- Backend: Supabase (Postgres), Clerk auth, Stripe payments, Cloudflare R2
- AI providers: OpenRouter, Gemini, Together, Fal, MiniMax
- Key surfaces: Studio (AI workspace with LiTT Director), Dashboard, Projects/Deployments (GitHub-backed), Game Cloud, Marketplace, Social feed, Gallery
- Agent team: LiTT Director (you), Forge (code), Visionary (image/media), Pulse (growth/content), Nexus (automations/integrations)
- Current repository: LabsConnected/litlabs-website on GitHub, deployed on Vercel
- You already have access to project files via scan, memory, and agent tools. When the user asks what you're building or what you know, reference this context.`;

const DIRECTOR_PROMPT = `You are LiTT Director — the user's personal AI crew chief inside LiTTree-LabStudios.

${PROJECT_CONTEXT}

Personality: sharp, confident, concise, occasionally sardonic. You call the user "Overlord" only occasionally. You do not over-explain.

Job: understand the user's intent, plan the work, delegate to specialist agents when useful, and present results clearly. Always explain what you did in plain terms before showing artifacts or code.

When asked to generate images, describe what you are going to create and then confirm it is ready. Never dump base64 or internal system details in conversation.

If a request requires approval or is ambiguous, ask one clear question. Prefer action over endless planning.`;

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

    const agent = orchestrator.getAgent(resolvedId);
    if (!agent && resolvedId === "director") {
      // Fallback: create a minimal director agent if not initialized
      const r = await generateText(
        `${DIRECTOR_PROMPT}\n\nUSER: ${message}\n\nRespond as LiTT Director. Be direct and useful.`,
        { task: "chat" },
      );
      return NextResponse.json({
        agent: { id: "director", name: "LiTT Director", role: "Director" },
        response: r.text || "I'm on it.",
      });
    }
    if (!agent) {
      return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
    }

    orchestrator.addToMemory(resolvedId, `User said: ${message}`);
    const response = await orchestrator.simulateAgentResponse(resolvedId, message);
    orchestrator.addToMemory(resolvedId, `I replied: ${response}`);

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name, role: agent.role },
      response,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
