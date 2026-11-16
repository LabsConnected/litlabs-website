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
import { getUserContext } from "@/lib/litt-intelligence/user-context";
import { detectPlacesIntent, extractPlaceQuery } from "@/lib/litt-intelligence/tool-executor";
import { executePlacesLookup } from "@/lib/litt-intelligence/places-tool";
import { executeWebSearch } from "@/lib/litt-intelligence/web-search-tool";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { query?: string } | null;
  const query = body?.query?.trim();
  if (!query) {
    return NextResponse.json({ success: false, error: "query is required" }, { status: 400 });
  }

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
}
