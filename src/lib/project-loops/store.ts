/**
 * Project Loops — store
 *
 * Persistence layer for Project Loops. Tries Supabase first, falls back
 * to in-memory + localStorage on the client. This keeps the feature
 * usable even when the new `project_loops` migration hasn't been run
 * yet — the user can still spin loops and the events will replay from
 * their browser.
 *
 * In production every read/write goes through Supabase.
 */

import { supabase } from "@/lib/supabase";
import type {
  ProjectLoop,
  LoopEvent,
  LoopApproval,
} from "@/types/project-loops";

const TABLE = "project_loops";
const EVENTS_TABLE = "project_loop_events";

const memStore = new Map<string, ProjectLoop>();
const memEvents = new Map<string, LoopEvent[]>();

/* ── Helpers ───────────────────────────────────────────────────── */

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "loop";
}

export function newLoopId(repo: string): string {
  const slug = slugify(repo);
  return `loop_${slug}_${Date.now().toString(36)}`;
}

export function newWorkingBranch(repo: string, goal: string): string {
  const repoSlug = slugify(repo);
  const goalSlug = slugify(goal).slice(0, 32);
  return `lit/${repoSlug}/${goalSlug}-${Date.now().toString(36).slice(-4)}`;
}

function readClientCache(): ProjectLoop[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("litlabs-project-loops");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectLoop[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeClientCache(loops: ProjectLoop[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      "litlabs-project-loops",
      JSON.stringify(loops.slice(0, 50)),
    );
  } catch {
    /* ignore quota errors */
  }
}

/* ── CRUD ──────────────────────────────────────────────────────── */

export type CreateLoopInput = Omit<
  ProjectLoop,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "iteration"
  | "tokensUsed"
  | "costCents"
  | "fileChanges"
> & {
  id?: string;
};

export async function createLoop(input: CreateLoopInput): Promise<ProjectLoop> {
  const now = new Date().toISOString();
  const loop: ProjectLoop = {
    ...input,
    id: input.id ?? newLoopId(input.repo),
    iteration: 0,
    tokensUsed: 0,
    costCents: 0,
    fileChanges: 0,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const { error } = await supabase.from(TABLE).insert(loop);
    if (error) throw error;
  } catch {
    memStore.set(loop.id, loop);
    if (typeof window !== "undefined") {
      const cached = readClientCache();
      writeClientCache([loop, ...cached]);
    }
  }
  return loop;
}

export async function getLoop(id: string): Promise<ProjectLoop | null> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!error && data) return data as ProjectLoop;
  } catch {
    /* fall through */
  }
  return memStore.get(id) ?? null;
}

export async function listLoops(opts: { limit?: number } = {}): Promise<ProjectLoop[]> {
  const limit = opts.limit ?? 50;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (!error && Array.isArray(data)) return data as ProjectLoop[];
  } catch {
    /* fall through */
  }
  const fromMem = Array.from(memStore.values());
  if (typeof window !== "undefined") {
    return [...fromMem, ...readClientCache()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }
  return fromMem.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function updateLoop(
  id: string,
  patch: Partial<ProjectLoop>,
): Promise<ProjectLoop | null> {
  const next: ProjectLoop | null = await (async () => {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (!error && data) return data as ProjectLoop;
    } catch {
      /* fall through */
    }
    const existing = memStore.get(id);
    if (existing) {
      const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      memStore.set(id, updated);
      return updated;
    }
    return null;
  })();

  if (next && typeof window !== "undefined") {
    const cached = readClientCache();
    const idx = cached.findIndex((c) => c.id === id);
    if (idx >= 0) cached[idx] = next;
    else cached.unshift(next);
    writeClientCache(cached);
  }
  return next;
}

export async function deleteLoop(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (error) throw error;
  } catch {
    /* fall through */
  }
  memStore.delete(id);
  memEvents.delete(id);
  if (typeof window !== "undefined") {
    writeClientCache(readClientCache().filter((c) => c.id !== id));
  }
  return true;
}

/* ── Events ────────────────────────────────────────────────────── */

export async function appendEvent(event: LoopEvent): Promise<void> {
  try {
    await supabase.from(EVENTS_TABLE).insert(event);
    return;
  } catch {
    /* fall through */
  }
  const list = memEvents.get(event.loopId) ?? [];
  list.push(event);
  memEvents.set(event.loopId, list);
}

export async function listEvents(
  loopId: string,
  opts: { since?: string; limit?: number } = {},
): Promise<LoopEvent[]> {
  const limit = opts.limit ?? 200;
  try {
    let query = supabase
      .from(EVENTS_TABLE)
      .select("*")
      .eq("loop_id", loopId)
      .order("at", { ascending: true })
      .limit(limit);
    if (opts.since) query = query.gt("at", opts.since);
    const { data, error } = await query;
    if (!error && Array.isArray(data)) return data as LoopEvent[];
  } catch {
    /* fall through */
  }
  return (memEvents.get(loopId) ?? []).slice(-limit);
}

/* ── Approvals ─────────────────────────────────────────────────── */

export async function recordApproval(
  loopId: string,
  approval: LoopApproval,
): Promise<ProjectLoop | null> {
  return updateLoop(loopId, {
    lastApproval: approval,
    status: approval.decision === "ship" ? "completed" : "executing",
  });
}
