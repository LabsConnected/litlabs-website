// API Route: Agent-to-agent messaging
import { NextRequest, NextResponse } from "next/server";
import { orchestrator } from "@/lib/agents";
import { withRateLimit } from "@/lib/rate-limiter";
import { AGENTS } from "@/lib/agents";
import { generateText } from "@/lib/llm";

async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { from, to, message, type = "chat", metadata } = body;

    // Backward-compatible gallery/chat payload: { message, agent }
    const agentSlug = body.agent || body.agentSlug;
    if ((!from || !to) && message && agentSlug) {
      const agent = AGENTS[agentSlug as keyof typeof AGENTS];
      if (!agent) {
        return NextResponse.json(
          { error: "Invalid agent ID" },
          { status: 400 },
        );
      }

      const response = await generateText(
        `${agent.systemPrompt}\n\nPersonality: ${agent.personality}\nRole: ${agent.role}\n\nUser: ${message}\n\nRespond as ${agent.name} in character. Be helpful, concise, and natural.`,
        { task: "chat", maxTokens: 1024 },
      );

      return NextResponse.json({
        reply: response.text,
        message: response.text,
        agent: {
          id: agent.id,
          name: agent.name,
        },
      });
    }

    if (!from || !to || !message) {
      return NextResponse.json(
        { error: "Missing required fields: from, to, message" },
        { status: 400 },
      );
    }

    // Validate agents exist
    const fromAgent = orchestrator.getAgent(from);
    const toAgent = orchestrator.getAgent(to);

    if (!fromAgent || !toAgent) {
      return NextResponse.json(
        { error: "Invalid agent ID(s)" },
        { status: 400 },
      );
    }

    // Send message
    const agentMessage = orchestrator.sendMessage(
      from,
      to,
      message,
      type,
      metadata,
    );

    // If simulating, generate a response
    let response = null;
    if (body.simulateResponse) {
      response = await orchestrator.simulateAgentResponse(to, message);
      const reply = orchestrator.sendMessage(to, from, response, "chat");

      return NextResponse.json({
        sent: agentMessage,
        received: reply,
        conversation: [agentMessage, reply],
      });
    }

    return NextResponse.json({
      sent: agentMessage,
      from: {
        id: fromAgent.id,
        name: fromAgent.name,
      },
      to: {
        id: toAgent.id,
        name: toAgent.name,
      },
    });
  } catch {
    // Error in agent chat:
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
