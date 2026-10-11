"use client";

import { useCallback, useState } from "react";
import type { StudioTask } from "@/lib/studio/task-types";
import type { StudioSelectionPayload } from "../context/StudioContext";

/* ── F1: server-backed Worktab view ───────────────────────────────────
   The Worktab BAR is shell UI (audit §3), but the tabs themselves are
   the DURABLE server model (GET/POST/PATCH /api/studio/tasks — the
   runtime lane owns that API; the shell only consumes it as-is).

   This module is the view-model seam between the two:
   - `Worktab`: what the bar renders (server id/title/conversation +
     the shell's encoded surface + the session-scoped ask-litt selection).
   - `mapStudioTaskToWorktab`: server task → Worktab view.
   - `displayWorktabTitle`: removes implementation-generated placeholder names.
   - `useWorktabSelections`: session-scoped ask-litt selection pinned
     per server task id. NEVER persisted — the task API has no field for
     it and selection context is ephemeral UI state by design.
*/

export interface Worktab {
  id: string;
  title: string;
  /** Server-persisted conversation id, or null until the canonical
      controller lazily provisions one on first send. */
  conversationId: string | null;
  /** Encoded workspace surface, e.g. "studio/preview", "create/image".
      Sourced from the task's lastOpenedSurface (server truth). */
  surface: string;
  /** Session-scoped ask-litt selection (never persisted). */
  selection: StudioSelectionPayload | null;
  createdAt: number;
}

export function mapStudioTaskToWorktab(
  task: StudioTask,
  opts: { surface: string; selection: StudioSelectionPayload | null; fallbackTitle?: string },
): Worktab {
  return {
    id: task.id,
    title: displayWorktabTitle(task.title, opts.fallbackTitle),
    conversationId: task.conversationId,
    surface: opts.surface,
    selection: opts.selection,
    createdAt: Date.parse(task.createdAt) || 0,
  };
}

/** Placeholder task names are implementation history, not user-facing identity. */
export function isPlaceholderTaskTitle(title: string | null | undefined): boolean {
  const normalized = (title ?? "").trim();
  return !normalized || /^(?:untitled(?: \d+)?|current work|new task)$/i.test(normalized);
}

export function displayWorktabTitle(
  title: string | null | undefined,
  fallbackTitle = "New conversation",
): string {
  const normalized = (title ?? "").trim();
  return isPlaceholderTaskTitle(normalized) ? fallbackTitle : normalized;
}

/** Collision-free "Untitled N" numbering across renames/closes. */
export function nextUntitledTitle(titles: Array<string | null | undefined>): string {
  let max = 0;
  for (const t of titles) {
    const m = /^Untitled (\d+)$/.exec((t ?? "").trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Untitled ${max + 1}`;
}

/**
 * Resolve the title for an adopted pre-Worktab conversation. A real
 * conversation title is kept verbatim; an untitled conversation gets a
 * truthful first-run label until the first prompt supplies real identity.
 */
export function resolveAdoptedTaskTitle(
  conversationTitle: string | null | undefined,
  _existingTaskTitles: Array<string | null | undefined>,
): string {
  const raw = (conversationTitle ?? "").trim();
  return raw ? raw : "New conversation";
}

/**
 * Session-scoped ask-litt selection pinned per server task id.
 * Survives tab switches; cleared on reload (ephemeral by design).
 */
export function useWorktabSelections() {
  const [selections, setSelections] = useState<
    Record<string, StudioSelectionPayload | null>
  >({});

  const getSelection = useCallback(
    (taskId: string): StudioSelectionPayload | null =>
      selections[taskId] ?? null,
    [selections],
  );

  const setSelection = useCallback(
    (taskId: string, selection: StudioSelectionPayload | null) => {
      setSelections((prev) => {
        if ((prev[taskId] ?? null) === selection) return prev;
        return { ...prev, [taskId]: selection };
      });
    },
    [],
  );

  return { selections, getSelection, setSelection };
}
