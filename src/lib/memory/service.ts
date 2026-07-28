/**
 * Shared memory service for LiTT chat routes.
 *
 * Provides recallMemories() and persistMemory() with:
 * - Supermemory semantic search (primary)
 * - Supabase `memories` table fallback (when Supermemory is unavailable)
 * - Project-scoped memory (containerTag: userId:project:{projectId})
 * - Conversation-scoped memory (containerTag: userId:conversation)
 * - Secret/sensitive content filtering before persistence
 * - Observable logging on failures (not silent)
 *
 * Used by /api/gemini/chat and /api/agents/chat.
 */

import { getSupabaseAdmin } from "@/lib/supabase";

// ─── Secret / sensitive content filter ──────────────────────────

const SECRET_PATTERNS = [
  /(?:sk-|pk_|rk_)[a-zA-Z0-9]{20,}/gi, // Stripe-style keys
  /gh[pousr]_[A-Za-z0-9]{36,}/gi, // GitHub tokens
  /AIza[a-zA-Z0-9_-]{35}/gi, // Google API keys
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/gi, // Private keys
  /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi, // Password assignments
  /(?:secret|api_key|apikey|token)\s*[:=]\s*['"][^'"]{8,}['"]/gi, // Secret assignments
  /(?:Bearer)\s+[A-Za-z0-9._~+-]{20,}/gi, // Bearer tokens
  /xox[baprs]-[A-Za-z0-9-]+/gi, // Slack tokens
  /supabase.*service.*role.*key/i, // Supabase service role key references
  /process\.env\.[A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD)/gi, // env var references
];

function containsSecrets(content: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(content));
}

function sanitizeMemoryContent(content: string): string {
  let sanitized = content;
  for (const p of SECRET_PATTERNS) {
    sanitized = sanitized.replace(p, "[REDACTED]");
  }
  return sanitized;
}

// ─── Logging ────────────────────────────────────────────────────

function logMemoryError(operation: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.warn(`[memory:${operation}] ${msg}`);
}

// ─── Supermemory helpers ────────────────────────────────────────

function hasSupermemory(): boolean {
  return Boolean(process.env.SUPERMEMORY_API_KEY?.trim());
}

function getSupermemoryClient() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) throw new Error("SUPERMEMORY_API_KEY is not configured");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Supermemory } = require("supermemory");
  return new Supermemory({ apiKey: key });
}

/**
 * Recall relevant memories for a user query.
 * Tries Supermemory first, falls back to Supabase text search.
 *
 * @param query   The user's message (used for semantic search)
 * @param userId  The user's Clerk ID
 * @param limit   Max memories to return (default 5)
 * @param projectScope  If provided, searches project-scoped memories.
 *                      Otherwise searches conversation-scoped memories.
 * @returns A formatted string of memories, or "" if none found.
 */
export async function recallMemories(
  query: string,
  userId: string,
  limit: number = 5,
  projectScope?: string,
): Promise<string> {
  const containerTag = projectScope
    ? `${userId}:project:${projectScope}`
    : `${userId}:conversation`;

  try {
    // Try Supermemory first
    if (hasSupermemory()) {
      try {
        const sm = getSupermemoryClient();
        const results = await sm.search.memories({ q: query, containerTag, limit });
        const hits = (results.results || results.memories || []) as {
          memory?: string;
          chunk?: string;
          content?: string;
        }[];
        const memories = hits
          .map((m) => m.memory || m.chunk || m.content || "")
          .filter(Boolean);
        if (memories.length) {
          return `\n\nRELEVANT MEMORIES FROM PREVIOUS SESSIONS:\n${memories.join("\n")}\n---`;
        }
      } catch (err) {
        logMemoryError("recall:supermemory", err);
      }
    }

    // Fallback: search Supabase memories table
    const admin = getSupabaseAdmin();
    if (!admin) {
      if (!hasSupermemory()) {
        console.warn("[memory:recall] No Supermemory key and no Supabase admin — memory unavailable");
      }
      return "";
    }

    // Try text search first
    const { data: textMatches } = await admin
      .from("memories")
      .select("content")
      .eq("owner_id", userId)
      .ilike("content", `%${query.slice(0, 100)}%`)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (textMatches && textMatches.length > 0) {
      const memories = textMatches
        .map((m: { content: string }) => m.content)
        .filter(Boolean);
      if (memories.length) {
        return `\n\nRELEVANT MEMORIES FROM PREVIOUS SESSIONS:\n${memories.join("\n")}\n---`;
      }
    }

    // Final fallback: recent memories
    const scope = projectScope ? "project" : "conversation";
    const { data: recent } = await admin
      .from("memories")
      .select("content")
      .eq("owner_id", userId)
      .eq("scope", scope)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (recent && recent.length > 0) {
      const memories = recent
        .map((m: { content: string }) => m.content)
        .filter(Boolean);
      if (memories.length) {
        return `\n\nRECENT MEMORIES:\n${memories.join("\n")}\n---`;
      }
    }

    return "";
  } catch (err) {
    logMemoryError("recall", err);
    return "";
  }
}

/**
 * Persist a memory to Supabase (source of truth) and index in Supermemory.
 *
 * @param content       The memory content to store
 * @param userId        The user's Clerk ID
 * @param agentId       The agent that produced this memory
 * @param projectScope  If provided, stores as project-scoped memory.
 *                      Otherwise stores as conversation-scoped.
 */
export async function persistMemory(
  content: string,
  userId: string,
  agentId: string,
  projectScope?: string,
): Promise<void> {
  // Filter out secrets before storing
  if (containsSecrets(content)) {
    console.warn(`[memory:persist] Blocked attempt to store content with secrets for user ${userId}`);
    return;
  }

  const sanitized = sanitizeMemoryContent(content);
  const scope = projectScope ? "project" : "conversation";
  const containerTag = projectScope
    ? `${userId}:project:${projectScope}`
    : `${userId}:conversation`;

  try {
    const admin = getSupabaseAdmin();
    if (!admin) {
      console.warn("[memory:persist] No Supabase admin — memory not persisted");
      return;
    }

    // 1. Write to Supabase (source of truth)
    const { data: record, error: insertError } = await admin
      .from("memories")
      .insert({
        owner_id: userId,
        agent_id: agentId,
        content: sanitized,
        scope,
        source: "chat",
        sync_status: "pending",
      })
      .select()
      .single();

    if (insertError) {
      logMemoryError("persist:supabase-insert", insertError);
      return;
    }

    // 2. Index in Supermemory (best-effort)
    if (hasSupermemory() && record) {
      try {
        const sm = getSupermemoryClient();
        await sm.add({
          content: sanitized,
          containerTag,
          metadata: {
            ownerId: userId,
            scope,
            agent: agentId,
            supabaseMemoryId: record.id,
          },
        });
        await admin
          .from("memories")
          .update({
            sync_status: "synced",
            updated_at: new Date().toISOString(),
          })
          .eq("id", record.id);
      } catch (err) {
        logMemoryError("persist:supermemory-index", err);
        // Record stays in Supabase with sync_status: "pending"
      }
    } else if (!hasSupermemory()) {
      console.warn("[memory:persist] Supermemory not configured — memory stored in Supabase only");
    }
  } catch (err) {
    logMemoryError("persist", err);
  }
}
