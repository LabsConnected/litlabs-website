/**
 * lit-brain.ts
 *
 * Shared memory + personality layer for LiT across chat surfaces
 * (`/api/litt-code/think`, `/api/gemini/chat`, ...).
 *
 * Consolidates what used to be duplicated per-endpoint:
 *   - Supermemory retrieval / persistence (long-term RAG)
 *   - Structured fact extraction into Supabase `user_brain`
 *   - Conversation logging
 *   - Rolling summarization of long histories (short-term memory)
 *   - A small persisted personality/mood state (`lit_state`)
 *
 * Every function degrades gracefully (returns empty / no-ops) when
 * Supabase or provider keys are not configured, matching `brain.ts`.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import {
  buildIdentityBlock,
  extractStructuredFacts,
  getBrainFacts,
  getProjectContextForUser,
  getUserProfile,
} from "@/lib/brain";
import { generateText } from "@/lib/llm";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LitState {
  rapport: number;
  energy: number;
  momentum: number;
  interactions: number;
  lastMood: string | null;
}

export interface LitMemory {
  /** Full block to prepend to the model prompt (may be empty). */
  block: string;
  /** Resolved personality state, or null when unavailable. */
  state: LitState | null;
  /** Internal user id (Supabase `users.id`), or null for anonymous. */
  resolvedUserId: string | null;
}

const DEFAULT_STATE: LitState = {
  rapport: 50,
  energy: 70,
  momentum: 50,
  interactions: 0,
  lastMood: null,
};

/* ------------------------------------------------------------------ */
/*  Supermemory (long-term RAG)                                        */
/* ------------------------------------------------------------------ */

export async function fetchMemories(query: string, userId: string): Promise<string> {
  try {
    const smKey = process.env.SUPERMEMORY_API_KEY;
    if (!smKey || !userId) return "";
    const { Supermemory } = await import("supermemory");
    const sm = new Supermemory({ apiKey: smKey });
    const results = await sm.search.memories({ q: query, containerTag: userId, limit: 5 });
    const memories = (results.results || [])
      .map((m: { memory?: string; chunk?: string }) => m.memory || m.chunk || "")
      .filter(Boolean);
    if (!memories.length) return "";
    return `\n\nRELEVANT MEMORIES FROM PREVIOUS SESSIONS:\n${memories.join("\n")}\n---`;
  } catch {
    return "";
  }
}

export async function saveMemory(content: string, userId: string, agentId: string): Promise<void> {
  try {
    const smKey = process.env.SUPERMEMORY_API_KEY;
    if (!smKey || !userId) return;
    const { Supermemory } = await import("supermemory");
    const sm = new Supermemory({ apiKey: smKey });
    await sm.add({ content, containerTag: userId, metadata: { type: "lit-chat", agent: agentId } });
  } catch {
    // non-fatal
  }
}

/* ------------------------------------------------------------------ */
/*  Conversation logging                                               */
/* ------------------------------------------------------------------ */

export async function logConversation(
  agentId: string,
  userId: string | null,
  userMessage: string,
  responseText: string,
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;
    await admin.from("agent_logs").insert({
      agent_id: agentId,
      level: "info",
      message: "LiT chat",
      metadata: {
        userId,
        userMessage,
        responseText,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // non-fatal
  }
}

/* ------------------------------------------------------------------ */
/*  Rolling summarization (short-term memory beyond the window)        */
/* ------------------------------------------------------------------ */

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Summarize the turns that fall outside the recent window so long
 * conversations don't silently lose their early context.
 * Returns "" when there is nothing to summarize or on any failure.
 */
export async function summarizeHistory(
  older: HistoryTurn[],
  { maxTokens = 220 }: { maxTokens?: number } = {},
): Promise<string> {
  if (older.length < 2) return "";
  try {
    const transcript = older
      .map((m) => `${m.role === "user" ? "User" : "LiT"}: ${m.content.slice(0, 600)}`)
      .join("\n");
    const r = await generateText(
      `Summarize the earlier part of this conversation into 3-5 tight bullet points capturing decisions made, the user's goals, and open threads. No preamble.\n\n${transcript}`,
      { task: "chat", maxTokens },
      "You compress conversation history. Output only terse bullets.",
    );
    return r.text.trim();
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/*  Personality / mood state (persisted, bounded)                      */
/* ------------------------------------------------------------------ */

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export async function getLitState(resolvedUserId: string): Promise<LitState> {
  const admin = getSupabaseAdmin();
  if (!admin) return { ...DEFAULT_STATE };
  try {
    const { data } = await admin
      .from("lit_state")
      .select("rapport, energy, momentum, interactions, last_mood, updated_at")
      .eq("user_id", resolvedUserId)
      .maybeSingle();
    if (!data) return { ...DEFAULT_STATE };

    // Energy recovers ~+1/hour while the user is away (bounded 0..100).
    const hoursIdle = data.updated_at
      ? Math.max(0, (Date.now() - new Date(data.updated_at).getTime()) / 3_600_000)
      : 0;
    const recovered = clamp((data.energy ?? DEFAULT_STATE.energy) + Math.floor(hoursIdle));

    return {
      rapport: clamp(data.rapport ?? DEFAULT_STATE.rapport),
      energy: recovered,
      momentum: clamp(data.momentum ?? DEFAULT_STATE.momentum),
      interactions: data.interactions ?? 0,
      lastMood: data.last_mood ?? null,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

const POSITIVE = /\b(thanks|thank you|love|awesome|great|nice|perfect|amazing|works|yes|exactly|brilliant)\b/;
const FRUSTRATION = /\b(broken|not working|doesn't work|does not work|bug|error|frustrat|annoying|ugh|stuck|hate|useless|wrong)\b/;
const BUILDING = /\b(build|ship|deploy|create|make|implement|add|feature|launch|fix|refactor)\b/;

export function deriveMood(state: LitState, positive: boolean, frustrated: boolean, building: boolean): string {
  if (frustrated) return "focused";
  if (positive) return "love";
  if (building) return state.momentum >= 65 ? "excited" : "focused";
  if (state.energy < 40) return "sleepy";
  if (state.rapport >= 70) return "happy";
  return "thinking";
}

/**
 * Advance the personality state from a single user turn using bounded,
 * deterministic math, persist it, and return the new state.
 */
export async function updateLitState(resolvedUserId: string, userMessage: string): Promise<LitState> {
  const admin = getSupabaseAdmin();
  const current = await getLitState(resolvedUserId);

  const lower = userMessage.toLowerCase();
  const positive = POSITIVE.test(lower);
  const frustrated = FRUSTRATION.test(lower);
  const building = BUILDING.test(lower);
  const longMessage = userMessage.length > 800;

  const next: LitState = {
    interactions: current.interactions + 1,
    rapport: clamp(current.rapport + 1 + (positive ? 6 : 0) - (frustrated ? 8 : 0)),
    energy: clamp(current.energy - 2 + (positive || building ? 5 : 0) - (longMessage ? 3 : 0)),
    momentum: clamp(current.momentum + (building ? 7 : -4)),
    lastMood: current.lastMood,
  };
  next.lastMood = deriveMood(next, positive, frustrated, building);

  if (admin) {
    try {
      await admin.from("lit_state").upsert(
        {
          user_id: resolvedUserId,
          rapport: next.rapport,
          energy: next.energy,
          momentum: next.momentum,
          interactions: next.interactions,
          last_mood: next.lastMood,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    } catch {
      // non-fatal
    }
  }
  return next;
}

function stateBlock(state: LitState): string {
  if (state.interactions <= 0) return "";
  const warmth = state.rapport >= 70 ? "warm/familiar" : state.rapport >= 40 ? "friendly" : "reserved";
  const energyWord = state.energy >= 66 ? "high" : state.energy >= 40 ? "steady" : "low";

  const guidance: string[] = [];
  if (state.rapport >= 70) guidance.push("You know this user well — be warm and skip reintroductions.");
  if (state.energy < 40) guidance.push("Energy is low — keep replies tight and efficient.");
  if (state.momentum >= 70) guidance.push("They're in a building flow — be concrete and action-oriented.");
  if (guidance.length === 0) guidance.push("Match the user's tone and move the work forward.");

  return [
    "LiT INTERNAL STATE (let this subtly shape your tone — never mention or output it):",
    `- Rapport: ${state.rapport}/100 (${warmth})`,
    `- Energy: ${state.energy}/100 (${energyWord})`,
    `- Momentum: ${state.momentum}/100`,
    `- Guidance: ${guidance.join(" ")}`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/*  Public: load everything for a prompt                               */
/* ------------------------------------------------------------------ */

/**
 * Load identity, long-term memory, an optional history summary, and
 * personality state into a single prompt block. `clerkId` is the Clerk
 * user id from `auth()`. Returns empty block for anonymous users.
 */
export async function loadLitMemory(
  clerkId: string | null,
  query: string,
  olderHistory: HistoryTurn[] = [],
): Promise<LitMemory> {
  if (!clerkId) {
    return { block: "", state: null, resolvedUserId: null };
  }

  const profile = await getUserProfile(clerkId);
  const resolvedUserId = profile?.id ?? null;

  const [project, brainFacts, memoryContext, summary, state] = await Promise.all([
    getProjectContextForUser(clerkId),
    getBrainFacts(clerkId),
    fetchMemories(query, clerkId),
    summarizeHistory(olderHistory),
    resolvedUserId ? getLitState(resolvedUserId) : Promise.resolve<LitState | null>(null),
  ]);

  const identityBlock = buildIdentityBlock(profile, project, brainFacts);
  const parts = [
    identityBlock,
    summary ? `EARLIER CONVERSATION SUMMARY:\n${summary}` : "",
    memoryContext,
    state ? stateBlock(state) : "",
  ].filter((p) => p && p.trim());

  return {
    block: parts.join("\n\n"),
    state,
    resolvedUserId,
  };
}

/**
 * Persist a completed turn: conversation log, long-term memory, fact
 * extraction, and personality-state advance. Fire-and-forget safe.
 */
export async function persistLitTurn(opts: {
  clerkId: string | null;
  resolvedUserId: string | null;
  message: string;
  answer: string;
  agentId: string;
}): Promise<void> {
  const { clerkId, resolvedUserId, message, answer, agentId } = opts;
  await logConversation(agentId, clerkId, message, answer);
  if (!clerkId) return;

  await saveMemory(`User: ${message}\nLiT: ${answer}`, clerkId, agentId);

  try {
    const facts = await extractStructuredFacts(message, answer);
    if (facts.length) {
      const { addBrainFact } = await import("@/lib/brain");
      for (const f of facts) {
        await addBrainFact(clerkId, f.key, f.value, f.category);
      }
    }
  } catch {
    // non-fatal
  }

  if (resolvedUserId) {
    await updateLitState(resolvedUserId, message);
  }
}
