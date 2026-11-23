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

// The outcome of an authorized agent chat, kept as a discriminated
// result so the two success shapes can never be confused: the simulated
// path generates a reply; the non-simulated path is a plain dispatch
// with no reply requested. A bare string could not say which one it
// was — "" used to carry the dispatch signal and read as empty content.
export type AgentChatOutcome = { kind: "reply"; text: string } | { kind: "dispatch" };

// Public agent-to-agent payloads require the same permissions and billing
// boundaries as ordinary chat. Client-selected mode is not a service identity.
export async function executeAgentChat(input: AgentChatExecution): Promise<AgentChatOutcome | NextResponse> {
  const entitlement = await resolveAgentEntitlement(input);
  if (!entitlement.allowed) {
    const status = entitlement.reason === "agent_not_found" ? 400 : 403;
    return NextResponse.json({ error: "Agent access denied", reason: entitlement.reason }, { status });
  }
  // Non-simulated dispatch is authorization only — deliberately free:
  // no spend authorization, no charge, no model call. The caller
  // records the dispatch and answers with a receipt.
  if (!input.simulateResponse) {
    return { kind: "dispatch" };
  }

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
  // An empty model completion is a failed reply, not a successful one:
  // returning it as reply text would have the caller record a blank
  // message as the agent's answer.
  const text = reply.result.text;
  if (typeof text !== "string" || text.trim() === "") {
    return NextResponse.json(
      { error: "Model returned an empty reply", code: "empty_model_reply" },
      { status: 502 },
    );
  }
  return { kind: "reply", text };
}
