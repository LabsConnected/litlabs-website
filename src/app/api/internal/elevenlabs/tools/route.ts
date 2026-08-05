/**
 * ElevenLabs Webhook Tool Endpoint
 *
 * When LiTT invokes a tool during a phone call, ElevenLabs POSTs to this
 * endpoint with the tool name + parameters. We execute the tool and
 * return the result as a string that LiTT speaks.
 *
 * The user_id and project_id are injected via dynamic variables set in
 * the conversation initiation webhook. ElevenLabs substitutes {{user_id}}
 * and {{project_id}} in the tool's request_body_schema, so they arrive
 * in the parameters.
 *
 * Auth: Bearer token in Authorization header (ElevenLabs style) OR
 * x-internal-api-key header (our standard). Must match INTERNAL_API_KEY.
 *
 * Request (ElevenLabs sends):
 *   {
 *     "tool_call_id": "call_abc123",
 *     "tool_name": "web_intelligence",
 *     "parameters": {
 *       "operation": "search",
 *       "query": "best AI music players",
 *       "user_id": "clerk_xxx",       // from {{user_id}} dynamic variable
 *       "project_id": "proj_xxx"      // from {{project_id}} dynamic variable
 *     },
 *     "conversation_id": "conv_xyz789"
 *   }
 *
 * Response (we return):
 *   { "result": "Found 5 results. Top: ..." }
 *   Or for errors: { "result": "Unable to complete that: ..." }
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import {
  executeWebIntelligence,
  type WebIntelligenceOperation,
  type WebIntelligenceRequest,
} from "@/lib/litt-intelligence/web-intelligence";
import { recallMemories } from "@/lib/studio/memory-service";

export const runtime = "nodejs";
export const maxDuration = 120;

function safeSecretEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return false;

  const internalKey = req.headers.get("x-internal-api-key");
  if (internalKey && safeSecretEqual(internalKey, expected)) return true;

  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (safeSecretEqual(token, expected)) return true;
  }

  return false;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const toolName = (body.tool_name as string) || "";
  const parameters = (body.parameters as Record<string, unknown>) || {};
  const conversationId = (body.conversation_id as string) || "";

  // Extract user_id and project_id from the parameters (injected via
  // dynamic variables from the conversation initiation webhook)
  const userId = (parameters.user_id as string) || "";
  const projectId = (parameters.project_id as string) || undefined;

  console.log(`[elevenlabs-tools] Tool: ${toolName}, conversation: ${conversationId}, user: ${userId || "none"}`);

  if (!userId) {
    return NextResponse.json({
      result: "I can't identify who you are. Please link your phone number to your account in the studio settings.",
    });
  }

  try {
    if (toolName === "web_intelligence") {
      const result = await executeWebIntelligenceTool(parameters, userId, projectId);
      return NextResponse.json({ result });
    }

    if (toolName === "memory_recall") {
      const result = await executeMemoryRecallTool(parameters, userId, projectId);
      return NextResponse.json({ result });
    }

    // ─── Reception tools ──────────────────────────────────
    // All reception operations route through the Reception Brain
    if (toolName === "reception") {
      const operation = (parameters.operation as string) || "";
      const result = await executeReceptionTool(operation, parameters, userId, conversationId);
      return NextResponse.json({ result });
    }

    return NextResponse.json({
      result: `Unknown tool: ${toolName}. Available tools: web_intelligence, memory_recall, reception.`,
    });
  } catch (err) {
    console.error(`[elevenlabs-tools] Error executing ${toolName}:`, err);
    return NextResponse.json({
      result: `I ran into an issue with that. ${err instanceof Error ? err.message : "Please try again."}`,
    });
  }
}

// ─── Tool: web_intelligence ─────────────────────────────────────

async function executeWebIntelligenceTool(
  parameters: Record<string, unknown>,
  userId: string,
  projectId: string | undefined,
): Promise<string> {
  const operation = (parameters.operation as WebIntelligenceOperation) || "search";

  const wiRequest: WebIntelligenceRequest = {
    operation,
    ownerId: userId,
    projectId,
    query: (parameters.query as string) || undefined,
    url: (parameters.url as string) || undefined,
    instruction: (parameters.instruction as string) || undefined,
    forceBrowser: false,
    maxResults: 3, // Keep it fast for voice
  };

  const result = await executeWebIntelligence(wiRequest);

  if (!result.success) {
    return `I wasn't able to complete that: ${result.error || "unknown error"}`;
  }

  // Format the result for natural speech — keep it concise
  if (operation === "search" || operation === "research") {
    const items = Array.isArray(result.data)
      ? result.data
      : (result.data as { sources?: unknown[] })?.sources || [];
    if (items.length === 0) return "I couldn't find any results for that.";

    const top = items.slice(0, 3);
    const summary = top
      .map((item: unknown, i: number) => {
        const it = item as { title?: string; url?: string; snippet?: string; excerpt?: string };
        const title = it.title || it.url || "Untitled";
        const snippet = it.snippet || it.excerpt || "";
        return `${i + 1}. ${title}${snippet ? ` — ${snippet.slice(0, 120)}` : ""}`;
      })
      .join(". ");

    return `I found ${items.length} results. Here are the top ${top.length}: ${summary}`;
  }

  if (operation === "fetch") {
    const data = result.data as { content?: string; title?: string };
    const content = data?.content || "";
    if (!content) return "The page content was empty or inaccessible.";
    // Trim for speech — don't read the whole page
    return content.slice(0, 1500);
  }

  if (operation === "extract") {
    const data = result.data;
    return JSON.stringify(data).slice(0, 1500);
  }

  if (operation === "screenshot") {
    const data = result.data as { screenshotUrl?: string };
    return data?.screenshotUrl
      ? `I've captured a screenshot and saved it. You can view it at ${data.screenshotUrl}`
      : "I've captured a screenshot.";
  }

  // Default: stringify the result
  return JSON.stringify(result.data).slice(0, 1500);
}

// ─── Tool: memory_recall ────────────────────────────────────────

async function executeMemoryRecallTool(
  parameters: Record<string, unknown>,
  userId: string,
  projectId: string | undefined,
): Promise<string> {
  const query = (parameters.query as string) || "";

  if (!projectId) {
    return "I don't have a project context for this call, so I can't recall memories.";
  }

  const memories = await recallMemories(query, userId, projectId, {
    agentSlug: "litt",
    agentMode: "voice",
    limit: 5,
  });

  if (memories.length === 0) {
    return "I don't have any saved memories about that topic.";
  }

  // Format memories for speech — keep it concise
  const summaries = memories
    .slice(0, 3)
    .map((m: unknown) => {
      const mem = m as { content?: string; memory_type?: string };
      const content = mem.content || "";
      const type = mem.memory_type || "memory";
      return `${type}: ${content.slice(0, 200)}`;
    })
    .join(". ");

  return `I found ${memories.length} relevant memories. ${summaries}`;
}

// ─── Tool: reception ────────────────────────────────────────────

async function executeReceptionTool(
  operation: string,
  parameters: Record<string, unknown>,
  userId: string,
  conversationId: string,
): Promise<string> {
  // Forward to the unified Reception Brain endpoint
  const baseUrl = process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3000";

  const response = await fetch(`${baseUrl}/api/internal/elevenlabs/reception`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-key": process.env.INTERNAL_API_KEY || "",
    },
    body: JSON.stringify({
      operation,
      owner_id: userId,
      parameters: {
        ...parameters,
        conversation_id: conversationId,
        source: "voice",
      },
    }),
  });

  if (!response.ok) {
    return `I wasn't able to complete that reception operation. Error: ${response.status}`;
  }

  const data = await response.json();
  return data.result || "Operation completed but returned no result.";
}

