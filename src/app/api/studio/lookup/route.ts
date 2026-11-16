/**
 * Studio Live Lookup API Route
 *
 * Powers the Studio board's Browser panel lookup surface: a places/hours
 * question routes to the Google Places tool; anything else falls back to
 * the existing Brave/DuckDuckGo web-search chain. Same tool functions
 * Studio chat's pre-LLM router uses (tool-executor.ts) — no second
 * implementation.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getUserContext } from "@/lib/litt-intelligence/user-context";
import { detectPlacesIntent, extractPlaceQuery } from "@/lib/litt-intelligence/tool-executor";
import { executePlacesLookup } from "@/lib/litt-intelligence/places-tool";
import { executeWebSearch } from "@/lib/litt-intelligence/web-search-tool";

export const runtime = "nodejs";

const MAX_QUERY_LENGTH = 500;

async function postHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { query?: unknown } | null;
  const rawQuery = body?.query;
  const query = typeof rawQuery === "string" ? rawQuery.trim() : undefined;
  if (!query) {
    return NextResponse.json({ success: false, error: "query is required" }, { status: 400 });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { success: false, error: `query is too long (max ${MAX_QUERY_LENGTH} characters)` },
      { status: 400 },
    );
  }

  try {
    const ctx = await getUserContext(userId, {
      capabilities: ["places.search", "web.search"],
      headers: req.headers,
    });

    if (detectPlacesIntent(query)) {
      const result = await executePlacesLookup(ctx, extractPlaceQuery(query));
      if (result.success) {
        return NextResponse.json({ success: true, formatted: result.formatted, source: "Google Places" });
      }
      return NextResponse.json({ success: false, error: result.error });
    }

    const result = await executeWebSearch(ctx, query);
    if (result.success) {
      return NextResponse.json({
        success: true,
        formatted: result.formatted,
        source: result.provider === "brave_search" ? "Brave Search" : "Web search",
      });
    }
    return NextResponse.json({ success: false, error: result.error });
  } catch {
    return NextResponse.json({ success: false, error: "That lookup failed." });
  }
}

export const POST = withRateLimit(postHandler, 30, 60); // 30 requests per 60s
