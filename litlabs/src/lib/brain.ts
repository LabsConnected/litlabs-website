/**
 * brain.ts
 *
 * LiTTree's central brain module.
 * Fetches user identity, project context, and structured facts
 * from Supabase. Falls back gracefully when unconfigured.
 */

import { getSupabaseAdmin } from "./supabase";
import { getUserByClerkId, type UserProfile } from "./user-db";
import type { ProjectContext } from "./agents";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BrainFacts {
  preferences: string[];
  goals: string[];
  facts: string[];
}

export interface BrainWarmup {
  identity: string;
  projectContext: string;
  knownFacts: string;
  memorySummary: string;
  greeting: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const SUPERMEMORY_KEY = process.env.SUPERMEMORY_API_KEY;

function isConfigured(): boolean {
  return !!SUPERMEMORY_KEY && SUPERMEMORY_KEY.length > 10;
}

type SupermemoryClient = {
  search: {
    memories: (args: { q: string; containerTag: string; limit: number }) => Promise<{ results: Array<{ memory?: string; chunk?: string }> }>;
  };
  add: (args: { content: string; containerTag: string; metadata?: Record<string, unknown> }) => Promise<unknown>;
};

async function getSupermemoryClient(): Promise<SupermemoryClient | null> {
  if (!isConfigured()) return null;
  try {
    const { Supermemory } = await import("supermemory");
    return new Supermemory({ apiKey: SUPERMEMORY_KEY }) as unknown as SupermemoryClient;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  1. User Profile                                                    */
/* ------------------------------------------------------------------ */

export async function getUserProfile(clerkId: string): Promise<UserProfile | null> {
  return getUserByClerkId(clerkId);
}

/* ------------------------------------------------------------------ */
/*  2. Project Context                                                 */
/* ------------------------------------------------------------------ */

export async function getSupabaseProjectContext(
  userId: string,
): Promise<ProjectContext | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin
    .from("project_contexts")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    name: data.name || "",
    description: data.description || "",
    stack: data.stack || "",
    goals: data.goals || "",
    repoUrl: data.repo_url || "",
    customInstructions: data.custom_instructions || "",
  };
}

export async function saveSupabaseProjectContext(
  userId: string,
  ctx: ProjectContext,
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  const { data: existing } = await admin
    .from("project_contexts")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  const payload = {
    user_id: userId,
    name: ctx.name || null,
    description: ctx.description || null,
    stack: ctx.stack || null,
    goals: ctx.goals || null,
    repo_url: ctx.repoUrl || null,
    custom_instructions: ctx.customInstructions || null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    await admin
      .from("project_contexts")
      .update(payload)
      .eq("id", existing.id);
  } else {
    await admin.from("project_contexts").insert(payload);
  }
}

export async function getProjectContextForUser(
  clerkId: string,
): Promise<ProjectContext | null> {
  const profile = await getUserProfile(clerkId);
  if (profile) {
    const ctx = await getSupabaseProjectContext(profile.id);
    if (ctx) return ctx;
  }

  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("litlabs-project-context");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (profile?.id) {
          saveSupabaseProjectContext(profile.id, parsed).catch(() => {});
        }
        return parsed;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export async function saveProjectContextForUser(
  clerkId: string,
  ctx: ProjectContext,
): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("litlabs-project-context", JSON.stringify(ctx));
    } catch {
      // ignore
    }
  }

  const profile = await getUserProfile(clerkId);
  if (profile?.id) {
    await saveSupabaseProjectContext(profile.id, ctx);
  }
}

/* ------------------------------------------------------------------ */
/*  3. Brain Facts (structured memory in Supabase)                    */
/* ------------------------------------------------------------------ */

export async function getBrainFacts(
  clerkId: string,
): Promise<BrainFacts | null> {
  const profile = await getUserProfile(clerkId);
  if (!profile) return null;

  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin
    .from("user_brain")
    .select("key, value, category")
    .eq("user_id", profile.id)
    .order("updated_at", { ascending: false });

  if (error || !data?.length) return null;

  const facts: BrainFacts = { preferences: [], goals: [], facts: [] };
  for (const row of data) {
    const v = row.value?.trim();
    if (!v) continue;
    const cat = row.category || "facts";
    if (cat === "preference") facts.preferences.push(v);
    else if (cat === "goal") facts.goals.push(v);
    else facts.facts.push(v);
  }

  return facts;
}

export async function addBrainFact(
  clerkId: string,
  key: string,
  value: string,
  category: "preference" | "goal" | "facts" = "facts",
): Promise<void> {
  const profile = await getUserProfile(clerkId);
  if (!profile) return;

  const admin = getSupabaseAdmin();
  if (!admin) return;

  await admin.from("user_brain").upsert(
    {
      user_id: profile.id,
      key,
      value: value.trim(),
      category,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,key,category" },
  );
}

/* ------------------------------------------------------------------ */
/*  4. Identity Block for System Prompt                               */
/* ------------------------------------------------------------------ */

export function buildIdentityBlock(
  profile: UserProfile | null,
  project: ProjectContext | null,
  brainFacts: BrainFacts | null,
): string {
  const lines: string[] = [];

  if (profile) {
    const displayName = profile.name || profile.username || profile.email?.split("@")[0] || "there";
    lines.push(`ABOUT THE USER:`);
    lines.push(`- Name: ${displayName}`);
    if (profile.bio) lines.push(`- Bio: ${profile.bio}`);
    if (profile.location) lines.push(`- Location: ${profile.location}`);
    if (profile.website) lines.push(`- Website: ${profile.website}`);
    if (profile.interests?.length) lines.push(`- Interests: ${profile.interests.join(", ")}`);
  }

  if (project && Object.values(project).some((v) => typeof v === "string" && v.trim())) {
    lines.push(``);
    lines.push(`CURRENT PROJECT:`);
    if (project.name) lines.push(`- Name: ${project.name}`);
    if (project.description) lines.push(`- Description: ${project.description}`);
    if (project.stack) lines.push(`- Stack: ${project.stack}`);
    if (project.goals) lines.push(`- Goals: ${project.goals}`);
    if (project.repoUrl) lines.push(`- Repo: ${project.repoUrl}`);
    if (project.customInstructions) lines.push(`- Custom instructions: ${project.customInstructions}`);
  }

  if (brainFacts) {
    if (brainFacts.preferences.length) {
      lines.push(``);
      lines.push(`USER PREFERENCES:`);
      brainFacts.preferences.forEach((p) => lines.push(`- ${p}`));
    }
    if (brainFacts.goals.length) {
      lines.push(``);
      lines.push(`USER GOALS:`);
      brainFacts.goals.forEach((g) => lines.push(`- ${g}`));
    }
    if (brainFacts.facts.length) {
      lines.push(``);
      lines.push(`KNOWN FACTS:`);
      brainFacts.facts.forEach((f) => lines.push(`- ${f}`));
    }
  }

  if (lines.length === 0) return "";

  return `
--- USER AWARENESS (always factor this in naturally — do not parrot it back) ---
${lines.join("\n")}
--- End user awareness ---
`;
}

/* ------------------------------------------------------------------ */
/*  5. Structured memory extraction via LLM                           */
/* ------------------------------------------------------------------ */

export async function extractStructuredFacts(
  userMessage: string,
  assistantReply: string,
): Promise<Array<{ key: string; value: string; category: "preference" | "goal" | "facts" }>> {
  try {
    const { generateJSON } = await import("./llm");
    type Extraction = { key?: string; value?: string; category?: string; extractions?: unknown };
    const result = await generateJSON<Extraction>(
      `Extract 0-3 structured facts from this conversation exchange that would help personalize future responses.

RULES:
- Only extract NEW facts that are NOT obvious small talk
- Category must be one of: preference, goal, facts
- preference = user likes/dislikes, communication style, tool choices, aesthetic choices
- goal = what the user wants to achieve, build, or ship
- facts = permanent information about the user, their projects, their stack

USER SAID: ${userMessage}
ASSISTANT REPLIED: ${assistantReply}

Return a JSON object: { "extractions": [{"key": "...", "value": "...", "category": "preference|goal|facts"}] }`,
      { maxTokens: 512 },
      `You are a fact extraction engine. Return ONLY valid JSON. Do not extract obvious pleasantries.`,
    );

    const parsed = (result && typeof result === "object" ? result : {}) as Extraction;
    const raw = (parsed.extractions || []) as Array<{ key?: string; value?: string; category?: string }>;
    return raw.filter(
      (e) => e.key && e.value && ["preference", "goal", "facts"].includes(e.category || ""),
    ) as Array<{ key: string; value: string; category: "preference" | "goal" | "facts" }>;
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  6. Warmup (called on session / terminal open)                     */
/* ------------------------------------------------------------------ */

export async function warmupBrain(clerkId: string): Promise<BrainWarmup> {
  const [profile, project, brainFacts] = await Promise.all([
    getUserProfile(clerkId),
    getProjectContextForUser(clerkId),
    getBrainFacts(clerkId),
  ]);

  const identityBlock = buildIdentityBlock(profile, project, brainFacts);

  let memorySummary = "";
  const sm = await getSupermemoryClient();
  if (sm) {
    try {
      const results = await sm.search.memories({ q: "recent important memories", containerTag: clerkId, limit: 5 });
      const memories = (results.results || [])
        .map((m) => m.memory || m.chunk || "")
        .filter(Boolean);
      if (memories.length) {
        memorySummary = memories.slice(0, 5).join("\n");
      }
    } catch {
      // non-fatal
    }
  }

  const displayName = profile?.name || profile?.username || profile?.email?.split("@")[0] || "there";
  const greeting = `Heads up: ${displayName} is back. ${brainFacts?.goals.length ? `Active goals: ${brainFacts.goals.slice(0, 3).join(", ")}.` : ""} ${project?.name ? `Working on: ${project.name}.` : ""}`;

  return {
    identity: identityBlock,
    projectContext: project ? JSON.stringify(project) : "",
    knownFacts: brainFacts ? JSON.stringify(brainFacts) : "",
    memorySummary,
    greeting,
  };
}
