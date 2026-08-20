/**
 * Internal API: Web Intelligence (for Voice Bridge tool calls)
 *
 * Called by the LiTT Voice Bridge when LiTT invokes the web_intelligence
 * tool during a phone call. This is a thin wrapper around the existing
 * executeWebIntelligence() function, authenticated with INTERNAL_API_KEY
 * instead of Clerk (since the voice bridge doesn't have a browser session).
 *
 * Auth: X-Internal-Api-Key header (matches INTERNAL_API_KEY env var).
 *
 * The voice bridge passes the userId (resolved from the phone lookup) so
 * sources are owned by the correct user.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import {
  executeWebIntelligence,
  type WebIntelligenceOperation,
  type WebIntelligenceRequest,
} from "@/lib/litt-intelligence/web-intelligence";

export const runtime = "nodejs";

function safeSecretEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(req: NextRequest): boolean {
  const key = req.headers.get("x-internal-api-key");
  const expected = process.env.INTERNAL_API_KEY;
  if (!key || !expected) return false;
  return safeSecretEqual(key, expected);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const operation = body.operation as WebIntelligenceOperation | undefined;
  if (!operation) {
    return NextResponse.json(
      { error: "Missing 'operation' field" },
      { status: 400 },
    );
  }

  const wiRequest: WebIntelligenceRequest = {
    operation,
    ownerId: typeof body.ownerId === "string" ? body.ownerId : "",
    projectId: typeof body.projectId === "string" ? body.projectId : undefined,
    query: typeof body.query === "string" ? body.query : undefined,
    url: typeof body.url === "string" ? body.url : undefined,
    action: typeof body.action === "string" ? body.action : undefined,
    instruction: typeof body.instruction === "string" ? body.instruction : undefined,
    schema: body.schema as Record<string, unknown> | undefined,
    claim: typeof body.claim === "string" ? body.claim : undefined,
    forceBrowser: body.forceBrowser === true,
    maxResults: typeof body.maxResults === "number" ? body.maxResults : 3,
  };

  if (!wiRequest.ownerId) {
    return NextResponse.json({ error: "Missing 'ownerId' field" }, { status: 400 });
  }

  const result = await executeWebIntelligence(wiRequest);
  return NextResponse.json(result);
}
