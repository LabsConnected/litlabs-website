/**
 * Web Intelligence API Route
 *
 * Exposes the unified Web Intelligence capability to the Studio UI.
 * Both LiTT and Spark call this endpoint — it's the single entry point
 * for all web operations (search, fetch, research, browse, extract, etc.).
 *
 * Auth: Clerk (auth(req) → userId). BROWSERBASE_API_KEY is server-side only
 * and never exposed to the client.
 *
 * Rate limited to prevent abuse. Browser operations are inherently slower,
 * so the timeout is generous.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  executeWebIntelligence,
  type WebIntelligenceOperation,
  type WebIntelligenceRequest,
} from "@/lib/litt-intelligence/web-intelligence";
import { getSourceRegistry } from "@/lib/litt-intelligence/source-registry";

export const runtime = "nodejs";

// ─── POST: Execute a web intelligence operation ─────────────────

async function postHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const operation = body.operation as WebIntelligenceOperation | undefined;
  if (!operation) {
    return NextResponse.json(
      { error: "Missing 'operation' field. Must be one of: search, fetch, research, browse, observe, act, extract, verify, compare, monitor, screenshot, pdf" },
      { status: 400 },
    );
  }

  // Build the request, defaulting ownerId from auth
  const wiRequest: WebIntelligenceRequest = {
    operation,
    ownerId: userId,
    projectId: typeof body.projectId === "string" ? body.projectId : undefined,
    conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
    query: typeof body.query === "string" ? body.query : undefined,
    maxResults: typeof body.maxResults === "number" ? body.maxResults : undefined,
    url: typeof body.url === "string" ? body.url : undefined,
    action: typeof body.action === "string" ? body.action : undefined,
    instruction: typeof body.instruction === "string" ? body.instruction : undefined,
    schema: body.schema as Record<string, unknown> | undefined,
    urls: Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === "string") : undefined,
    claim: typeof body.claim === "string" ? body.claim : undefined,
    sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds.filter((u): u is string => typeof u === "string") : undefined,
    monitorLabel: typeof body.monitorLabel === "string" ? body.monitorLabel : undefined,
    extractionTarget: typeof body.extractionTarget === "string" ? body.extractionTarget : undefined,
    checkIntervalSeconds: typeof body.checkIntervalSeconds === "number" ? body.checkIntervalSeconds : undefined,
    forceBrowser: body.forceBrowser === true,
    useProxies: body.useProxies === true,
    model: typeof body.model === "string" ? body.model : undefined,
  };

  const result = await executeWebIntelligence(wiRequest);

  return NextResponse.json(result);
}

// ─── GET: List sources for a project ────────────────────────────

async function getHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const domain = url.searchParams.get("domain") ?? undefined;
  const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const registry = getSourceRegistry();
  const sources = await registry.listForProject(userId, projectId, { limit, domain });

  return NextResponse.json({ sources });
}

// ─── Exported handlers with rate limiting ────────────────────────

export const POST = withRateLimit(postHandler, 30, 60); // 30 requests per 60s
export const GET = withRateLimit(getHandler, 60, 60);
