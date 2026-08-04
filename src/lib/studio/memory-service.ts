import { supabaseAdmin } from "@/lib/supabase";
import type { AgentSlug, MemoryType } from "./types";

// Schema drift cache: agent_mode column may not exist yet if migration
// 20260805000000_litt_agent_identity.sql hasn't been applied. Once we detect
// the column is missing, we skip mode-scoped filtering for the rest of the
// process lifetime. Reset to false after applying the migration + redeploy.
let agentModeColumnExists = true;

interface MemoryRecord {
  id: string;
  owner_id: string;
  project_id: string | null;
  conversation_id: string | null;
  agent_slug: AgentSlug | null;
  memory_type: MemoryType | null;
  dedupe_key: string | null;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const SECRET_PATTERNS = [
  /(?:sk|pk)_(?:live|test)_[a-zA-Z0-9]{20,}/i,
  /gh[pousr]_[A-Za-z0-9]{36,}/i,
  /github_pat_[A-Za-z0-9_]{82,}/i,
  /AIza[a-zA-Z0-9_\-]{35}/i,
  /eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+/i,
  /xox[baprs]-[a-zA-Z0-9-]+/i,
  /\b(?:password|passwd|pwd|secret|token|api_key|apikey|private_key)\s*[:=]\s*\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /supabase.*service.*role.*key/i,
  /NEXT_PUBLIC_SUPABASE_ANON_KEY/i,
  /CLERK_SECRET_KEY/i,
  /STRIPE_SECRET_KEY/i,
];

function containsSecrets(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

function normalizeDedupeKey(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

function hasSupermemory(): boolean {
  return Boolean(process.env.SUPERMEMORY_API_KEY?.trim());
}

async function getSupermemory() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) throw new Error("SUPERMEMORY_API_KEY is not configured");
  const { Supermemory } = await import("supermemory");
  return new Supermemory({ apiKey: key });
}

/**
 * Recall memories scoped by owner_id, project_id, and optionally agent_slug.
 *
 * MEMORY ISOLATION RULES:
 * - user_preference and project_fact memories are shared across conversations
 *   within the same project (scoped by owner_id + project_id).
 * - conversation_summary and agent_note memories are scoped by conversation_id
 *   — they never leak from one conversation to another.
 * - agent_mode further scopes the retrieval — Spark mode memories don't
 *   leak into Standard mode and vice versa.
 *
 * Never returns memories from a different project.
 * Falls back to Supabase text search when Supermemory is unavailable.
 */
export async function recallMemories(
  query: string,
  ownerId: string,
  projectId: string,
  options: {
    agentSlug?: AgentSlug;
    agentInstanceId?: string;
    memoryNamespace?: string;
    conversationId?: string;
    agentMode?: string;
    limit?: number;
  } = {},
): Promise<MemoryRecord[]> {
  const limit = options.limit ?? 5;

  // SHARED memories: user_preference and project_fact — scoped by owner + project only
  // These are the only memories that cross conversation boundaries.
  const sharedTypes = ["user_preference", "project_fact", "project_decision", "architecture", "workflow", "constraint"];

  let sharedFilter = supabaseAdmin
    .from("memories")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("project_id", projectId)
    .in("memory_type", sharedTypes);

  // CONVERSATION-SCOPED memories: conversation_summary and agent_note
  // These are scoped by conversation_id — they never leak across conversations.
  let conversationFilter = supabaseAdmin
    .from("memories")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("project_id", projectId);

  if (options.conversationId) {
    conversationFilter = conversationFilter.eq("conversation_id", options.conversationId);
  } else {
    // If no conversation ID, only return shared memories
    conversationFilter = conversationFilter.eq("conversation_id", "00000000-0000-0000-0000-000000000000");
  }

  if (options.agentSlug) {
    sharedFilter = sharedFilter.eq("agent_slug", options.agentSlug);
    conversationFilter = conversationFilter.eq("agent_slug", options.agentSlug);
  }
  if (options.agentMode && agentModeColumnExists) {
    // Further scope by agent_mode to prevent Spark creative context from
    // leaking into Standard mode and vice versa.
    // If the column doesn't exist (schema drift), the query will fail with
    // 42703 and the error handler below will set agentModeColumnExists = false.
    sharedFilter = sharedFilter.eq("agent_mode", options.agentMode);
    conversationFilter = conversationFilter.eq("agent_mode", options.agentMode);
  }
  if (options.memoryNamespace) {
    sharedFilter = sharedFilter.eq("memory_namespace", options.memoryNamespace);
    conversationFilter = conversationFilter.eq("memory_namespace", options.memoryNamespace);
  }

  // Try Supermemory first for semantic search
  if (hasSupermemory()) {
    try {
      const sm = await getSupermemory();
      const containerTag = `user:${ownerId}:project:${projectId}`;
      const results = await sm.search.memories({
        q: query,
        containerTag,
        limit,
      });
      const hits = (results.results || []) as Array<{ metadata?: { supabaseMemoryId?: string }; memory?: string; chunk?: string }>;
      const ids = hits
        .map((h) => h.metadata?.supabaseMemoryId)
        .filter(Boolean) as string[];

      if (ids.length > 0) {
        let idQuery = supabaseAdmin
          .from("memories")
          .select("*")
          .in("id", ids)
          .eq("owner_id", ownerId)
          .eq("project_id", projectId);
        if (options.agentSlug) {
          idQuery = idQuery.eq("agent_slug", options.agentSlug);
        }
        const { data } = await idQuery.limit(limit);
        if (data && data.length > 0) {
          return data as unknown[] as MemoryRecord[];
        }
      }
    } catch (err) {
      console.error("[memory:recall] Supermemory search failed:", err instanceof Error ? err.message : String(err));
    }
  }

  // Fallback: Supabase text search
  // Search shared memories first, then conversation-scoped memories
  try {
    // Search shared memories (user_preference, project_fact, etc.)
    const sharedTextQuery = sharedFilter
      .ilike("content", `%${query}%`)
      .order("created_at", { ascending: false })
      .limit(Math.ceil(limit / 2));

    const { data: sharedData, error: sharedError } = await sharedTextQuery;
    if (sharedError) {
      if (sharedError.code === "42703") agentModeColumnExists = false;
      console.error("[memory:recall] Supabase shared text search error:", sharedError.message);
    }

    // Search conversation-scoped memories (conversation_summary, agent_note)
    const convTextQuery = conversationFilter
      .ilike("content", `%${query}%`)
      .order("created_at", { ascending: false })
      .limit(Math.ceil(limit / 2));

    const { data: convData, error: convError } = await convTextQuery;
    if (convError) {
      if (convError.code === "42703") agentModeColumnExists = false;
      console.error("[memory:recall] Supabase conversation text search error:", convError.message);
    }

    // Merge and deduplicate by id
    const allResults = [...(sharedData ?? []), ...(convData ?? [])];
    const seenIds = new Set<string>();
    const deduped = allResults.filter((r) => {
      const id = (r as { id: string }).id;
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });

    if (deduped.length > 0) {
      return deduped.slice(0, limit) as unknown[] as MemoryRecord[];
    }

    // Final fallback: recent shared memories for this project
    const { data: recentShared } = await sharedFilter
      .order("created_at", { ascending: false })
      .limit(limit);

    if (recentShared && recentShared.length > 0) {
      return recentShared as unknown[] as MemoryRecord[];
    }

    // Final fallback: recent conversation-scoped memories
    const { data: recent } = await conversationFilter
      .order("created_at", { ascending: false })
      .limit(limit);
    return (recent || []) as unknown[] as MemoryRecord[];
  } catch (err) {
    console.error("[memory:recall] Fallback search failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Persist a memory with project scoping, agent slug, and dedupe.
 * Blocks content containing secrets.
 * Uses upsert on (owner_id, project_id, agent_slug, memory_type, dedupe_key).
 */
export async function persistMemory(
  content: string,
  ownerId: string,
  projectId: string,
  options: {
    agentSlug?: AgentSlug;
    agentInstanceId?: string;
    memoryNamespace?: string;
    conversationId?: string;
    memoryType?: MemoryType;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<{ id: string | null; blocked: boolean; error: string | null }> {
  // Block secrets
  if (containsSecrets(content)) {
    console.warn(`[memory:persist] Blocked attempt to store content with secrets for user ${ownerId}`);
    return { id: null, blocked: true, error: "Content contains secrets and was not stored" };
  }

  // Selective extraction: skip trivially short exchanges
  if (content.trim().length < 50) {
    return { id: null, blocked: false, error: null };
  }

  const agentSlug = options.agentSlug ?? null;
  const agentInstanceId = options.agentInstanceId ?? null;
  const memoryNamespace = options.memoryNamespace ?? null;
  const memoryType = options.memoryType ?? "agent_note";
  const dedupeKey = normalizeDedupeKey(content);
  const metadata = options.metadata ?? {};

  try {
    // Build payload conditionally — agent_instance_id and memory_namespace
    // columns may not exist yet if the migration hasn't been applied.
    const basePayload: Record<string, unknown> = {
      owner_id: ownerId,
      project_id: projectId,
      conversation_id: options.conversationId ?? null,
      agent_slug: agentSlug,
      memory_type: memoryType,
      dedupe_key: dedupeKey,
      content,
      metadata,
      sync_status: "pending",
    };
    if (agentInstanceId != null) basePayload.agent_instance_id = agentInstanceId;
    if (memoryNamespace != null) basePayload.memory_namespace = memoryNamespace;

    // Try upsert by dedupe key
    const { data, error } = await supabaseAdmin
      .from("memories")
      .upsert(
        basePayload,
        {
          onConflict: "owner_id,project_id,agent_slug,memory_type,dedupe_key",
        },
      )
      .select()
      .single();

    if (error || !data) {
      // If upsert failed (e.g., dedupe index doesn't exist yet), try plain insert
      const { data: insertData, error: insertError } = await supabaseAdmin
        .from("memories")
        .insert(basePayload)
        .select()
        .single();

      if (insertError || !insertData) {
        console.error("[memory:persist] Insert failed:", insertError?.message || "unknown");
        return { id: null, blocked: false, error: insertError?.message || "Insert failed" };
      }

      // Sync to Supermemory (non-blocking)
      if (hasSupermemory()) {
        void syncToSupermemory(insertData.id, content, ownerId, projectId, metadata);
      }

      return { id: insertData.id, blocked: false, error: null };
    }

    // Sync to Supermemory (non-blocking)
    if (hasSupermemory()) {
      void syncToSupermemory(data.id, content, ownerId, projectId, metadata);
    }

    return { id: data.id, blocked: false, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[memory:persist] Unexpected error:", msg);
    return { id: null, blocked: false, error: msg };
  }
}

async function syncToSupermemory(
  memoryId: string,
  content: string,
  ownerId: string,
  projectId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const sm = await getSupermemory();
    const containerTag = `user:${ownerId}:project:${projectId}`;
    await sm.add({
      content,
      containerTag,
      metadata: {
        ...metadata,
        supabaseMemoryId: memoryId,
        ownerId,
        projectId,
      },
    });

    // Update sync status
    await supabaseAdmin
      .from("memories")
      .update({ sync_status: "synced", updated_at: new Date().toISOString() })
      .eq("id", memoryId);
  } catch (err) {
    console.error("[memory:sync] Supermemory sync failed:", err instanceof Error ? err.message : String(err));
    // Mark as failed but don't throw — the Supabase record is still valid
    void (async () => {
      try {
        await supabaseAdmin
          .from("memories")
          .update({ sync_status: "failed", updated_at: new Date().toISOString() })
          .eq("id", memoryId);
      } catch {
        // ignore
      }
    })();
  }
}

/**
 * Format memories into a context block for the LLM prompt.
 */
export function formatMemoryContext(memories: MemoryRecord[]): string {
  if (!memories.length) return "";
  const lines = memories.map((m) => `- ${m.content}`);
  return `\n\nRELEVANT MEMORIES (project-scoped):\n${lines.join("\n")}\n---`;
}
