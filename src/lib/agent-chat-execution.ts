import "server-only";
import { NextResponse } from "next/server";
import { orchestrator } from "@/lib/agents";
import { resolveAgentEntitlement, chargeAgentRun } from "@/lib/agent-entitlements";
import { assertSpendAuthorized, meteredLlmCall } from "@/lib/metered-llm-call";

interface AgentChatExecution {
  clerkId: string;
  agentSlug: string;
  message: string;
  simulateResponse: boolean;
  requestId?: string;
}

// Public agent-to-agent payloads require the same permissions and billing
// boundaries as ordinary chat. Client-selected mode is not a service identity.
export async function executeAgentChat(input: AgentChatExecution): Promise<string | NextResponse> {
  const entitlement = await resolveAgentEntitlement(input);
  if (!entitlement.allowed) {
    const status = entitlement.reason === "agent_not_found" ? 400 : 403;
    return NextResponse.json({ error: "Agent access denied", reason: entitlement.reason }, { status });
  }
  if (!input.simulateResponse) return "";

  const spend = await assertSpendAuthorized(input.clerkId);
  if (!spend.ok) return NextResponse.json({ error: spend.error, code: spend.code }, { status: spend.status });
  const requestId = input.requestId ?? crypto.randomUUID();
  const charge = await chargeAgentRun({
    clerkId: input.clerkId, agentSlug: input.agentSlug,
    idempotencyKey: `agentrun:${input.clerkId}:${input.agentSlug}:${requestId}`,
  });
  if (charge.error) return NextResponse.json({ error: charge.error, code: "insufficient_credits" }, { status: 402 });

  const agent = orchestrator.getAgent(input.agentSlug);
  if (!agent) return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 });
  const reply = await meteredLlmCall({
    clerkId: input.clerkId,
    prompt: `${agent.systemPrompt}\n\nPersonality: ${agent.personality}\nRole: ${agent.role}\n\nUSER: ${input.message}\n\nRespond as ${agent.name}.`,
    // Every provider execution needs its own debit identity. A replayed
    // client request ID must not turn another model call into a free retry.
    llmOptions: { task: "chat" }, feature: "agent-chat", callId: crypto.randomUUID(),
  });
  if (!reply.ok) return NextResponse.json({ error: reply.error, code: reply.code }, { status: reply.status });
  return reply.result.text;
}
