import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { Supermemory } from "supermemory";
import { supabaseAdmin } from "@/lib/supabase";

function getSupermemory() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) throw new Error("SUPERMEMORY_API_KEY is not configured");
  return new Supermemory({ apiKey: key });
}

function hasSupermemory() {
  return Boolean(process.env.SUPERMEMORY_API_KEY?.trim());
}

function getContainerTag(userId: string, scope?: string) {
  return scope ? `${userId}:${scope}` : userId;
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const scope = searchParams.get("scope") || undefined;
    const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);

    if (!q.trim()) {
      const { data, error } = await supabaseAdmin
        .from("memories")
        .select("*")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ memories: data || [], count: (data || []).length, source: "supabase" });
    }

    let rawHits: unknown[] = [];
    let supermemoryError: string | null = null;
    let memories: unknown[] = [];
    let source = hasSupermemory() ? "supermemory+supabase" : "supabase";

    if (hasSupermemory()) {
      try {
        const results = (await getSupermemory().search.memories({
          q,
          containerTag: getContainerTag(userId, scope),
          limit,
        })) as { memories?: unknown[]; results?: unknown[] };
        rawHits = results.memories || results.results || [];
      } catch (err) {
        supermemoryError = err instanceof Error ? err.message : "Supermemory search failed";
        source = "supabase";
      }
    }

    const supabaseIds = rawHits
      .map((hit: unknown) => {
        if (!hit || typeof hit !== "object") return null;
        const h = hit as Record<string, unknown>;
        const metadata = h.metadata as Record<string, unknown> | undefined;
        return (metadata?.supabaseMemoryId as string) || null;
      })
      .filter(Boolean) as string[];

    if (supabaseIds.length) {
      const { data, error } = await supabaseAdmin
        .from("memories")
        .select("*")
        .in("id", supabaseIds)
        .eq("owner_id", userId);
      if (!error) memories = data || [];
    }

    // Fallback: if Supermemory is missing, failed, or returned no matches,
    // search Supabase content directly and then fall back to recent memories.
    if (!memories.length) {
      source = "supabase";
      const { data: textMatches, error: textError } = await supabaseAdmin
        .from("memories")
        .select("*")
        .eq("owner_id", userId)
        .ilike("content", `%${q}%`)
        .order("created_at", { ascending: false })
        .limit(limit);
      const textResults = textError
        ? []
        : (textMatches || []).filter((m) => (scope ? m.scope === scope : true));

      if (textResults.length) {
        memories = textResults;
      } else {
        const { data: recent, error: recentError } = await supabaseAdmin
          .from("memories")
          .select("*")
          .eq("owner_id", userId)
          .order("created_at", { ascending: false })
          .limit(limit);
        memories = recentError
          ? []
          : (recent || []).filter((m) => (scope ? m.scope === scope : true));
      }
    }

    return NextResponse.json({
      query: q,
      memories,
      hits: rawHits,
      count: memories.length,
      supermemoryError,
      source,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
