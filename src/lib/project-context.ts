/**
 * project-context.ts
 * Persistent per-user project context that agents read from.
 * Stored in localStorage (client) and optionally in Supabase (server).
 */

import type { ProjectContext } from "@/lib/agents";

const STORAGE_KEY = "litlabs-project-context";

export const EMPTY_CONTEXT: ProjectContext = {
  name: "",
  description: "",
  stack: "",
  goals: "",
  repoUrl: "",
  customInstructions: "",
};

/* ------------------------------------------------------------------ */
/*  localStorage helpers                                               */
/* ------------------------------------------------------------------ */

export function loadProjectContext(): ProjectContext {
  if (typeof window === "undefined") return { ...EMPTY_CONTEXT };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_CONTEXT };
    return { ...EMPTY_CONTEXT, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_CONTEXT };
  }
}

export function saveProjectContext(ctx: ProjectContext): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch {}
}

export function clearProjectContext(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** Returns true if at least one field is populated */
export function hasProjectContext(ctx: ProjectContext): boolean {
  return Object.values(ctx).some((v) => typeof v === "string" && v.trim().length > 0);
}

/** Build a one-line summary for display in the terminal header */
export function projectContextSummary(ctx: ProjectContext): string {
  if (!hasProjectContext(ctx)) return "No project context set";
  const parts: string[] = [];
  if (ctx.name) parts.push(ctx.name);
  if (ctx.stack) parts.push(ctx.stack);
  if (ctx.goals) parts.push(ctx.goals.slice(0, 60) + (ctx.goals.length > 60 ? "…" : ""));
  return parts.join(" · ");
}
