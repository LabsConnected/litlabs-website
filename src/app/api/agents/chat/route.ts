import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { orchestrator } from "@/lib/agents";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { agentId, message } = await req.json();
    if (!agentId || typeof agentId !== "string") {
      return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
    }
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const agent = orchestrator.getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
    }

    orchestrator.addToMemory(agentId, `User said: ${message}`);
    const response = await orchestrator.simulateAgentResponse(agentId, message);
    orchestrator.addToMemory(agentId, `I replied: ${response}`);

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name, role: agent.role },
      response,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
