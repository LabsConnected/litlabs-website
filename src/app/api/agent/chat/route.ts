/**
 * Public Agent Chat API — for external AI tools (ChatGPT, Claude, etc.)
 *
 * Allows ChatGPT's browser to interact with your site's AI without
 * requiring Clerk authentication. Uses a simple API key passed via
 * query parameter or header.
 *
 * Usage (GET — for ChatGPT browsing):
 *   GET /api/agent/chat?key=YOUR_KEY&message=Hello
 *
 * Usage (POST — for programmatic access):
 *   POST /api/agent/chat
 *   Headers: x-agent-api-key: YOUR_KEY
 *   Body: { "message": "Hello", "history": [...], "agentSlug": "litt" }
 *
 * Auth: AGENT_API_KEY env var must be set. The key in the request
 * must match it. This is a separate key from INTERNAL_API_KEY to
 * limit blast radius.
 *
 * Responses are JSON with CORS enabled so ChatGPT can read them.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { generateText, type LLMProvider, type ModelCategory } from "@/lib/llm";
import { AGENTS } from "@/lib/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_AGENT_SLUG = "litt";
const HISTORY_LIMIT = 12;

type HistoryEntry = { role: "user" | "assistant"; content: string };

function safeSecretEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.AGENT_API_KEY;
  if (!expected || expected.length < 16) return false;

  // Check query parameter first (for ChatGPT browser access)
  const url = new URL(req.url);
  const queryKey = url.searchParams.get("key");
  if (queryKey && safeSecretEqual(queryKey, expected)) return true;

  // Check header (for programmatic access)
  const headerKey = req.headers.get("x-agent-api-key");
  if (headerKey && safeSecretEqual(headerKey, expected)) return true;

  return false;
}

function buildPrompt(
  agent: (typeof AGENTS)[keyof typeof AGENTS],
  message: string,
  history: HistoryEntry[],
): string {
  const recentHistory = history.slice(-HISTORY_LIMIT);
  const transcript = recentHistory
    .map((entry) =>
      entry.role === "user"
        ? `User: ${entry.content}`
        : `${agent.name}: ${entry.content}`,
    )
    .join("\n");

  return [
    agent.systemPrompt,
    "",
    transcript ? `--- Conversation so far ---\n${transcript}\n--- End of history ---\n` : "",
    `User: ${message}`,
    "",
    `${agent.name}:`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-agent-api-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

async function handleChat(message: string, history: HistoryEntry[], agentSlug: string) {
  const agent =
    AGENTS[agentSlug as keyof typeof AGENTS] ??
    AGENTS[DEFAULT_AGENT_SLUG as keyof typeof AGENTS];

  const prompt = buildPrompt(agent, message, history);

  const result = await generateText(
    prompt,
    { task: "chat", maxTokens: 2048 },
    undefined,
  );

  return {
    agent: { id: agent.id, name: agent.name, slug: agentSlug },
    message: result.content,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: "Unauthorized. Pass ?key=YOUR_AGENT_API_KEY" },
      { status: 401, headers: corsHeaders },
    );
  }

  const url = new URL(req.url);
  const message = url.searchParams.get("message");
  if (!message) {
    return NextResponse.json(
      {
        error: "Missing 'message' query parameter",
        usage: "GET /api/agent/chat?key=YOUR_KEY&message=Hello",
        agents: Object.keys(AGENTS),
      },
      { status: 400, headers: corsHeaders },
    );
  }

  const agentSlug = url.searchParams.get("agent") ?? DEFAULT_AGENT_SLUG;

  try {
    const result = await handleChat(message, [], agentSlug);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { ...corsHeaders, "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Chat failed" },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: "Unauthorized. Pass key in x-agent-api-key header or ?key= query param" },
      { status: 401, headers: corsHeaders },
    );
  }

  const body = await req.json().catch(() => null) as {
    message?: string;
    history?: HistoryEntry[];
    agentSlug?: string;
  } | null;

  if (!body?.message) {
    return NextResponse.json(
      { error: "Missing 'message' in request body" },
      { status: 400, headers: corsHeaders },
    );
  }

  const agentSlug = body.agentSlug ?? DEFAULT_AGENT_SLUG;
  const history = body.history ?? [];

  try {
    const result = await handleChat(body.message, history, agentSlug);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { ...corsHeaders, "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Chat failed" },
      { status: 500, headers: corsHeaders },
    );
  }
}
