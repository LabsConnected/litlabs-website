/**
 * Public Agent Chat API — for external AI tools (ChatGPT, Claude, etc.)
 *
 * Allows external AI tools to interact with your site's AI without
 * requiring Clerk authentication. Uses a Bearer token in the
 * Authorization header — never in the URL query string (query params
 * leak into logs, browser history, analytics, and referrers).
 *
 * Usage (POST — recommended):
 *   POST /api/agent/chat
 *   Authorization: Bearer YOUR_KEY
 *   Content-Type: application/json
 *   { "message": "Hello", "history": [...], "agentSlug": "litt" }
 *
 * Usage (GET — simple one-shot):
 *   GET /api/agent/chat?message=Hello
 *   Authorization: Bearer YOUR_KEY
 *
 * Auth: AGENT_API_KEY env var must be set (min 16 chars). The Bearer
 * token must match it. This is a separate key from INTERNAL_API_KEY
 * to limit blast radius.
 *
 * Responses are JSON with CORS enabled so external clients can read them.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { generateText } from "@/lib/llm";
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

function extractBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token || token.length < 10) return null;
  return token;
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.AGENT_API_KEY;
  if (!expected || expected.length < 16) return false;
  const token = extractBearerToken(req);
  if (!token) return false;
  return safeSecretEqual(token, expected);
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
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    message: result.text,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: "Unauthorized. Use Authorization: Bearer YOUR_KEY header." },
      { status: 401, headers: corsHeaders },
    );
  }

  const url = new URL(req.url);
  const message = url.searchParams.get("message");
  if (!message) {
    return NextResponse.json(
      {
        error: "Missing 'message' query parameter",
        usage: "GET /api/agent/chat?message=Hello  (with Authorization: Bearer header)",
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
      { error: "Unauthorized. Use Authorization: Bearer YOUR_KEY header." },
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
