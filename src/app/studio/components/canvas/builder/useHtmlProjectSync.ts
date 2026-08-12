"use client";

/**
 * useHtmlProjectSync — bridges the HTML project store to the server
 * workspace so files are canonical on the server, not just localStorage.
 *
 * Flow:
 *   1. On project change, immediately reset client state to a fresh
 *      empty template (prevents cross-project file bleed).
 *   2. Load files from the server workspace using loadServerFiles.
 *      Any hard read error (500/401/403/network) aborts the load.
 *      404 means file is missing (not a hard error).
 *   3. Reconcile: server wins if it has files. If server is empty and
 *      local cache exists, this is an EXPLICIT RECOVERY decision —
 *      the user must choose to restore local cache or start fresh.
 *      Local cache is NEVER silently treated as canonical.
 *   4. On file edits, debounce-save to the server workspace.
 *      Every write must return HTTP 2xx or the save is marked as failed.
 *
 * The server workspace is canonical. If server and local disagree,
 * server wins on load, local wins on save.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useCanvasBuilderStore } from "./store";
import { createEmptyHtmlProject, type HtmlProject } from "./projectTypes";
import {
  loadServerFiles,
  saveServerFiles,
  readLocalCache,
  writeLocalCache,
  reconcileLoad,
  SAVE_DEBOUNCE_MS,
  type ReconcileResult,
} from "./htmlProjectSyncPolicy";

interface UseHtmlProjectSyncOptions {
  projectId: string | null;
  enabled: boolean;
}

interface UseHtmlProjectSyncResult {
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  lastSavedAt: number | null;
  /** When server is empty and local cache exists, this is set so the UI can prompt the user. */
  recoveryPrompt: { cachedFiles: HtmlProject["files"]; } | null;
  /** Resolve the recovery prompt by restoring local cache to server. */
  resolveRecoveryRestore: () => Promise<void>;
  /** Resolve the recovery prompt by starting fresh (seed template to server). */
  resolveRecoveryFresh: () => Promise<void>;
}

export function useHtmlProjectSync({
  projectId,
  enabled,
}: UseHtmlProjectSyncOptions): UseHtmlProjectSyncResult {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [recoveryPrompt, setRecoveryPrompt] = useState<
    { cachedFiles: HtmlProject["files"]; } | null
  >(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedProjectIdRef = useRef<string | null>(null);
  const isInternalUpdateRef = useRef(false);
  const recoveryProjectIdRef = useRef<string | null>(null);

  // ─── Reset + load on project change ─────────────────────────────────
  useEffect(() => {
    if (!enabled || !projectId) return;
    if (loadedProjectIdRef.current === projectId) return;

    // Clear any pending recovery prompt from a previous project
    setRecoveryPrompt(null);
    recoveryProjectIdRef.current = null;

    // FIX 1: Immediately reset client state to a fresh empty template.
    // This prevents cross-project file bleed.
    isInternalUpdateRef.current = true;
    const freshProject = createEmptyHtmlProject();

    // Try to restore from per-project localStorage cache first (instant display)
    const localCache = readLocalCache(projectId);
    if (localCache) {
      useCanvasBuilderStore.getState().setHtmlProject(localCache);
      isInternalUpdateRef.current = false;
      // Still load from server — don't set loadedProjectIdRef until server confirms
    } else {
      // No local cache — start with fresh template
      useCanvasBuilderStore.getState().setHtmlProject(freshProject);
      isInternalUpdateRef.current = false;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        // FIX 2: loadServerFiles uses Promise.all — any hard read error
        // (500/401/403/network) aborts the load. 404 = missing file.
        const loadResult = await loadServerFiles(fetch, projectId);

        if (cancelled) return;

        if (loadResult.status === "error") {
          // Hard load failure — do NOT seed or overwrite. Show error.
          setError(loadResult.error ?? "Failed to load files");
          return;
        }

        // Reconcile server result with local cache
        const freshTemplate = createEmptyHtmlProject();
        const decision: ReconcileResult = reconcileLoad(
          loadResult,
          localCache,
          freshTemplate,
        );

        if (decision.action === "server") {
          // Server has files — canonical wins
          const currentProject = useCanvasBuilderStore.getState().htmlProject;
          const newFiles = currentProject.files.map((f) => {
            const loaded = decision.files.find((lf) => lf.name === f.name);
            return loaded ? { ...f, content: loaded.content } : f;
          });
          isInternalUpdateRef.current = true;
          useCanvasBuilderStore.getState().setHtmlProject({
            ...currentProject,
            files: newFiles,
          });
          isInternalUpdateRef.current = false;
          loadedProjectIdRef.current = projectId;
        } else if (decision.action === "seed") {
          // No local cache, server empty — seed from fresh template
          const currentProject = useCanvasBuilderStore.getState().htmlProject;
          const seedResults = await Promise.allSettled(
            currentProject.files.map((f) =>
              saveServerFiles(fetch, projectId, [f]),
            ),
          );
          const allSeedOk = seedResults.every((r) => r.status === "fulfilled");
          if (allSeedOk && !cancelled) {
            setLastSavedAt(Date.now());
            loadedProjectIdRef.current = projectId;
          }
        } else if (decision.action === "recovery") {
          // FIX 4: Server empty + local cache exists — EXPLICIT recovery
          // decision. Do NOT silently treat local cache as canonical.
          // Prompt the user to choose: restore local cache to server, or start fresh.
          recoveryProjectIdRef.current = projectId;
          setRecoveryPrompt({ cachedFiles: decision.files });
          // Don't set loadedProjectIdRef yet — resolved after user decision
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Failed to load files";
          setError(msg);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);

  // ─── Recovery resolution ────────────────────────────────────────────
  const resolveRecoveryRestore = useCallback(async () => {
    const pid = recoveryProjectIdRef.current;
    const prompt = recoveryPrompt;
    if (!pid || !prompt) return;

    setIsSaving(true);
    setError(null);
    try {
      // Push cached files to server
      const currentProject = useCanvasBuilderStore.getState().htmlProject;
      await saveServerFiles(fetch, pid, currentProject.files);
      writeLocalCache(pid, currentProject);
      setLastSavedAt(Date.now());
      loadedProjectIdRef.current = pid;
      setRecoveryPrompt(null);
      recoveryProjectIdRef.current = null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to restore";
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  }, [recoveryPrompt]);

  const resolveRecoveryFresh = useCallback(async () => {
    const pid = recoveryProjectIdRef.current;
    if (!pid) return;

    setIsSaving(true);
    setError(null);
    try {
      // Seed from fresh template
      const freshProject = createEmptyHtmlProject();
      isInternalUpdateRef.current = true;
      useCanvasBuilderStore.getState().setHtmlProject(freshProject);
      isInternalUpdateRef.current = false;
      await saveServerFiles(fetch, pid, freshProject.files);
      writeLocalCache(pid, freshProject);
      setLastSavedAt(Date.now());
      loadedProjectIdRef.current = pid;
      setRecoveryPrompt(null);
      recoveryProjectIdRef.current = null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to seed";
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  }, []);

  // ─── Debounced save to server on file changes ───────────────────────
  const htmlProject = useCanvasBuilderStore((s) => s.htmlProject);

  const saveToServer = useCallback(
    async (project: HtmlProject, pid: string) => {
      setIsSaving(true);
      setError(null);
      try {
        // FIX 2: saveServerFiles uses Promise.all — any non-2xx throws
        await saveServerFiles(fetch, pid, project.files);

        // All writes succeeded — cache to per-project localStorage
        writeLocalCache(pid, project);
        setLastSavedAt(Date.now());
      } catch (err) {
        // Only set lastSavedAt after every file returns 2xx
        const msg = err instanceof Error ? err.message : "Failed to save";
        setError(msg);
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !projectId) return;
    if (loadedProjectIdRef.current !== projectId) return; // Don't save before initial load
    if (isInternalUpdateRef.current) return; // Don't save if we just loaded from server
    if (recoveryPrompt) return; // Don't save while recovery prompt is open

    // Debounce the save
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveToServer(htmlProject, projectId);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [htmlProject, projectId, enabled, saveToServer, recoveryPrompt]);

  return {
    isLoading,
    isSaving,
    error,
    lastSavedAt,
    recoveryPrompt,
    resolveRecoveryRestore,
    resolveRecoveryFresh,
  };
}
