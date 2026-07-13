import { Supermemory } from "supermemory";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

function getSupermemory() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) {
    throw new Error("SUPERMEMORY_API_KEY is not configured");
  }
  return new Supermemory({ apiKey: key });
}

function hasSupermemory() {
  return Boolean(process.env.SUPERMEMORY_API_KEY?.trim());
}

function getContainerTag(userId: string | null, scope?: string) {
  if (!userId) return "anonymous";
  return scope ? `${userId}:${scope}` : userId;
}

type MemoryScope = "profile" | "preference" | "agent" | "project" | "conversation" | "temporary";

const VALID_SCOPES: MemoryScope[] = [
  "profile",
  "preference",
  "agent",
  "project",
  "conversation",
  "temporary",
];

function normalizeScope(scope?: string): MemoryScope {
  return VALID_SCOPES.includes(scope as MemoryScope) ? (scope as MemoryScope) : "profile";
}

function extractSupermemoryId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const candidate = r.id || r.memoryId || r.memory_id || r.supermemoryId || r.externalId;
  return typeof candidate === "string" ? candidate : null;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { content, scope, metadata, agentId, reason } = await req.json();

    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const normalizedScope = normalizeScope(scope);
    const containerTag = getContainerTag(userId, normalizedScope);

    // 1. Write the memory record to Supabase (source of truth).
    const { data: record, error: insertError } = await supabaseAdmin
      .from("memories")
      .insert({
        owner_id: userId,
        agent_id: agentId || null,
        content,
        scope: normalizedScope,
        source: metadata?.source || "studio",
        source_id: metadata?.sourceId || null,
        reason: reason || metadata?.reason || null,
        confidence: metadata?.confidence ?? 1.0,
        sync_status: "pending",
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // 2. Index the memory in Supermemory for semantic search.
    let supermemoryResult: unknown = null;
    let supermemoryId: string | null = null;
    if (hasSupermemory()) {
      try {
        supermemoryResult = await getSupermemory().add({
          content,
          containerTag,
          metadata: {
            ...metadata,
            ownerId: userId,
            scope: normalizedScope,
            supabaseMemoryId: record.id,
          },
        });
        supermemoryId = extractSupermemoryId(supermemoryResult);
      } catch (indexError) {
        // Do not fail the request if indexing fails; record stays in Supabase.
        console.error("Supermemory index failed:", indexError);
      }
    }

    // 3. Update the Supabase record with the external index id / status.
    const { error: updateError } = await supabaseAdmin
      .from("memories")
      .update({
        supermemory_id: supermemoryId,
        sync_status: supermemoryId ? "synced" : "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      memory: { ...record, supermemory_id: supermemoryId, sync_status: supermemoryId ? "synced" : "failed" },
      supermemory: supermemoryResult,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to add memory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") || "";
    const scope = searchParams.get("scope") || undefined;
    const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
    const normalizedScope = scope ? normalizeScope(scope) : undefined;

    // Health check / recent list: return Supabase memories when no semantic query is provided.
    if (!query.trim()) {
      let db = supabaseAdmin
        .from("memories")
        .select("*")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (normalizedScope) db = db.eq("scope", normalizedScope);
      const { data, error } = await db;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json({
        memories: data || [],
        count: (data || []).length,
        source: "supabase",
      });
    }

    // Semantic search via Supermemory, then enrich with Supabase records.
    const containerTag = getContainerTag(userId, normalizedScope);
    let supermemoryResults: { memories?: unknown[]; results?: unknown[] } = {};
    let supermemoryError: string | null = null;
    let source = hasSupermemory() ? "supermemory+supabase" : "supabase";
    if (hasSupermemory()) {
      try {
        supermemoryResults = (await getSupermemory().search.memories({
          q: query,
          containerTag,
          limit,
        })) as { memories?: unknown[]; results?: unknown[] };
      } catch (err) {
        supermemoryError = err instanceof Error ? err.message : "Supermemory search failed";
        console.error("Supermemory search failed:", err);
        source = "supabase";
      }
    }

    const rawHits = supermemoryResults.memories || supermemoryResults.results || [];
    const supabaseIds = rawHits
      .map((hit: unknown) => {
        if (!hit || typeof hit !== "object") return null;
        const h = hit as Record<string, unknown>;
        const metadata = h.metadata as Record<string, unknown> | undefined;
        return (metadata?.supabaseMemoryId as string) || null;
      })
      .filter(Boolean) as string[];

    let memories: unknown[] = [];
    if (supabaseIds.length) {
      const { data, error } = await supabaseAdmin
        .from("memories")
        .select("*")
        .in("id", supabaseIds)
        .eq("owner_id", userId);
      if (!error) memories = data || [];
    }

    // Fallback: if Supermemory is unconfigured, failed, or returned no matches,
    // search Supabase content directly and then fall back to recent memories.
    if (!memories.length) {
      source = "supabase";
      const { data: textMatches, error: textError } = await supabaseAdmin
        .from("memories")
        .select("*")
        .eq("owner_id", userId)
        .ilike("content", `%${query}%`)
        .order("created_at", { ascending: false })
        .limit(limit);
      const textResults = textError
        ? []
        : (textMatches || []).filter((m) => (normalizedScope ? m.scope === normalizedScope : true));

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
          : (recent || []).filter((m) => (normalizedScope ? m.scope === normalizedScope : true));
      }
    }

    return NextResponse.json({
      query,
      memories,
      hits: rawHits,
      count: memories.length,
      supermemoryError,
      source,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to search memories";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, scope } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Resolve the Supabase memory first.
    const { data: record, error: fetchError } = await supabaseAdmin
      .from("memories")
      .select("*")
      .eq("id", id)
      .eq("owner_id", userId)
      .single();

    if (fetchError || !record) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    const normalizedScope = normalizeScope(scope || record.scope);
    const containerTag = getContainerTag(userId, normalizedScope);

    // Best-effort delete from Supermemory.
    if (hasSupermemory() && record.supermemory_id) {
      try {
        await getSupermemory().memories.forget({
          containerTag,
          id: record.supermemory_id,
          content: record.content,
        });
      } catch (err) {
        console.error("Supermemory forget failed:", err);
      }
    }

    // Delete from Supabase (source of truth).
    const { error } = await supabaseAdmin.from("memories").delete().eq("id", id).eq("owner_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ deleted: id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to forget memory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, newContent, scope } = await req.json();

    if (!id || !newContent || typeof newContent !== "string") {
      return NextResponse.json({ error: "id and newContent are required" }, { status: 400 });
    }

    const { data: record, error: fetchError } = await supabaseAdmin
      .from("memories")
      .select("*")
      .eq("id", id)
      .eq("owner_id", userId)
      .single();

    if (fetchError || !record) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    const normalizedScope = normalizeScope(scope || record.scope);
    const containerTag = getContainerTag(userId, normalizedScope);

    // Best-effort update in Supermemory.
    if (hasSupermemory() && record.supermemory_id) {
      try {
        await getSupermemory().memories.updateMemory({
          containerTag,
          id: record.supermemory_id,
          content: record.content,
          newContent,
        });
      } catch (err) {
        console.error("Supermemory update failed:", err);
      }
    }

    const { data, error } = await supabaseAdmin
      .from("memories")
      .update({ content: newContent, sync_status: "synced", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("owner_id", userId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ memory: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update memory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
