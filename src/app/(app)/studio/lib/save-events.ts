"use client";

/**
 * Studio save-state events — the single source of truth for the project
 * toolbar's save label.
 *
 * Writers (CodeWorkspace, file panels, agent file writes) dispatch:
 *   studio:files-saving        — a write request is in flight
 *   studio:files-saved         — a write was confirmed by the server
 *   studio:files-save-failed   — a write failed (retryable by the editor)
 *   studio:files-dirty         — an editor now holds unsaved changes
 *   studio:files-clean         — no editor holds unsaved changes
 *   studio:files-changed       — workspace content changed server-side
 *                                (already dispatched by save paths and
 *                                external/AI writes; treated as persisted)
 *
 * Every event carries { projectId } so labels never mix project state.
 * The label derives ONLY from these events — it is never hardcoded.
 */
import { useEffect, useState } from "react";

export type StudioSaveTone = "saved" | "saving" | "dirty" | "error";

export function notifyStudioSaving(projectId: string) {
  window.dispatchEvent(new CustomEvent("studio:files-saving", { detail: { projectId } }));
}
export function notifyStudioSaved(projectId: string) {
  window.dispatchEvent(new CustomEvent("studio:files-saved", { detail: { projectId } }));
}
export function notifyStudioSaveFailed(projectId: string) {
  window.dispatchEvent(new CustomEvent("studio:files-save-failed", { detail: { projectId } }));
}
export function notifyStudioDirty(projectId: string) {
  window.dispatchEvent(new CustomEvent("studio:files-dirty", { detail: { projectId } }));
}
export function notifyStudioClean(projectId: string) {
  window.dispatchEvent(new CustomEvent("studio:files-clean", { detail: { projectId } }));
}

export function formatSavedLabel(savedAt: number, now: number): string {
  const elapsed = Math.max(0, now - savedAt);
  if (elapsed < 45_000) return "Saved just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `Saved · ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Saved · ${hours}h ago`;
  return "Saved";
}

/**
 * Truthful project save label for the toolbar.
 * Returns null when nothing is known yet (no writes observed this session)
 * rather than guessing a state.
 */
export function useStudioSaveLabel(projectId: string | null | undefined): {
  label: string | null;
  tone: StudioSaveTone | null;
} {
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [failed, setFailed] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);

  // Reset all state when the project changes — never carry one project's
  // save state onto another.
  useEffect(() => {
    setSaving(false);
    setDirty(false);
    setFailed(false);
    setSavedAt(null);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const sameProject = (e: Event) =>
      (e as CustomEvent<{ projectId?: string }>).detail?.projectId === projectId;
    const onSaving = (e: Event) => {
      if (!sameProject(e)) return;
      setSaving(true);
      setFailed(false);
    };
    const onSaved = (e: Event) => {
      if (!sameProject(e)) return;
      setSaving(false);
      setFailed(false);
      setSavedAt(Date.now());
    };
    const onFailed = (e: Event) => {
      if (!sameProject(e)) return;
      setSaving(false);
      setFailed(true);
    };
    const onDirty = (e: Event) => {
      if (!sameProject(e)) return;
      setDirty(true);
    };
    const onClean = (e: Event) => {
      if (!sameProject(e)) return;
      setDirty(false);
    };
    const onChanged = (e: Event) => {
      if (!sameProject(e)) return;
      // A server-side write (editor save, agent write, sync) means the
      // workspace content is persisted — record the confirmation time.
      setSaving(false);
      setFailed(false);
      setSavedAt(Date.now());
    };
    const pairs: [string, (e: Event) => void][] = [
      ["studio:files-saving", onSaving],
      ["studio:files-saved", onSaved],
      ["studio:files-save-failed", onFailed],
      ["studio:files-dirty", onDirty],
      ["studio:files-clean", onClean],
      ["studio:files-changed", onChanged],
    ];
    for (const [name, fn] of pairs) window.addEventListener(name, fn);
    return () => {
      for (const [name, fn] of pairs) window.removeEventListener(name, fn);
    };
  }, [projectId]);

  // Re-render once a minute so "Saved · Nm ago" stays accurate.
  useEffect(() => {
    if (savedAt === null) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, [savedAt]);

  if (!projectId) return { label: null, tone: null };
  if (saving) return { label: "Saving…", tone: "saving" };
  if (failed) return { label: "Save failed", tone: "error" };
  if (dirty) return { label: "Unsaved changes", tone: "dirty" };
  if (savedAt !== null) return { label: formatSavedLabel(savedAt, Date.now()), tone: "saved" };
  return { label: null, tone: null };
}
