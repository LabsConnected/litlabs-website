"use client";

/**
 * useHtmlProjectSync — bridges the HTML project store to the server
 * workspace so files are canonical on the server, not just localStorage.
 *
 * Flow:
 *   1. On project change, immediately reset client state to a fresh
 *      empty template (prevents cross-project file bleed).
 *   2. Load files from the server workspace (index.html, style.css,
 *      script.js). Empty files are valid canonical files.
 *   3. On file edits, debounce-save to the server workspace.
 *      Every write must return HTTP 2xx or the save is marked as failed.
 *   4. localStorage is cached per-projectId so switching back restores
 *      the correct cached state instantly.
 *
 * The server workspace is canonical. If server and local disagree,
 * server wins on load, local wins on save.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useCanvasBuilderStore } from "./store";
import { createEmptyHtmlProject, type HtmlProject } from "./projectTypes";

interface UseHtmlProjectSyncOptions {
  projectId: string | null;
  enabled: boolean;
}

interface UseHtmlProjectSyncResult {
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  lastSavedAt: number | null;
}

const HTML_FILES = ["index.html", "style.css", "script.js"];
const SAVE_DEBOUNCE_MS = 1500;
const CACHE_KEY_PREFIX = "litt:canvasBuilder:htmlProject:";

/**
 * Fetch a file from the server workspace.
 * Returns { content: string | null, exists: boolean }.
 * - exists=true, content=string (possibly "") → file exists on server
 * - exists=false → file not found (404 or similar)
 * Throws on network errors or non-401/404 error responses.
 */
async function fetchServerFile(
  projectId: string,
  fileName: string,
): Promise<{ content: string | null; exists: boolean }> {
  const res = await fetch(`/api/studio-projects/${projectId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "read", path: fileName }),
  });

  if (res.status === 404) {
    return { content: null, exists: false };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const data = await res.json();
  // The terminal server returns { content: string } or { content: string, path: string }
  // content can be "" (empty file) — that is a valid canonical file
  const content = typeof data.content === "string" ? data.content : null;
  return { content, exists: content !== null };
}

/**
 * Write a file to the server workspace.
 * Throws if the server returns a non-2xx response.
 */
async function writeServerFile(
  projectId: string,
  fileName: string,
  content: string,
): Promise<void> {
  const res = await fetch(`/api/studio-projects/${projectId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", path: fileName, content }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

export function useHtmlProjectSync({
  projectId,
  enabled,
}: UseHtmlProjectSyncOptions): UseHtmlProjectSyncResult {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedProjectIdRef = useRef<string | null>(null);
  const isInternalUpdateRef = useRef(false);

  // ─── Reset + load on project change ─────────────────────────────────
  useEffect(() => {
    if (!enabled || !projectId) return;
    if (loadedProjectIdRef.current === projectId) return;

    // FIX 1: Immediately reset client state to a fresh empty template.
    // This prevents cross-project file bleed — the previous project's
    // files are never uploaded to the new project's workspace.
    isInternalUpdateRef.current = true;
    const freshProject = createEmptyHtmlProject();

    // Try to restore from per-project localStorage cache first (instant)
    try {
      const cached = localStorage.getItem(CACHE_KEY_PREFIX + projectId);
      if (cached) {
        const parsed = JSON.parse(cached) as HtmlProject;
        if (parsed.files && Array.isArray(parsed.files) && parsed.files.length > 0) {
          useCanvasBuilderStore.getState().setHtmlProject(parsed);
          isInternalUpdateRef.current = false;
          // Don't set loadedProjectIdRef yet — loadFromServer will set it
          // after the server content is confirmed. This prevents the
          // debounced save from firing with stale cached content before
          // the server content has been loaded.
          void loadFromServer(projectId, /* hasLocalCache */ true);
          return;
        }
      }
    } catch {
      // Cache read failed — continue with fresh template
    }

    // No local cache — start with fresh template, then load from server
    useCanvasBuilderStore.getState().setHtmlProject(freshProject);
    isInternalUpdateRef.current = false;

    void loadFromServer(projectId, /* hasLocalCache */ false);

    async function loadFromServer(pid: string, hasLocalCache: boolean) {
      setIsLoading(true);
      setError(null);
      try {
        // Fetch each HTML file from the server workspace
        const fileResults = await Promise.allSettled(
          HTML_FILES.map((fileName) => fetchServerFile(pid, fileName)),
        );

        // Collect successfully loaded files
        // FIX 3: Distinguish "file exists with empty content" from "file not found"
        const loadedFiles: { name: string; content: string }[] = [];
        let anyExists = false;
        for (let i = 0; i < fileResults.length; i++) {
          const result = fileResults[i];
          if (result.status === "fulfilled" && result.value.exists) {
            anyExists = true;
            loadedFiles.push({
              name: HTML_FILES[i],
              content: result.value.content ?? "",
            });
          }
        }

        if (anyExists) {
          // Server has files — use them as canonical (overrides local cache)
          const currentProject = useCanvasBuilderStore.getState().htmlProject;
          const newFiles = currentProject.files.map((f) => {
            const loaded = loadedFiles.find((lf) => lf.name === f.name);
            return loaded ? { ...f, content: loaded.content } : f;
          });
          isInternalUpdateRef.current = true;
          useCanvasBuilderStore.getState().setHtmlProject({
            ...currentProject,
            files: newFiles,
          });
          isInternalUpdateRef.current = false;
        } else if (!hasLocalCache) {
          // Server is empty AND no local cache — seed from the fresh template
          // (which is already in the store from the reset above)
          const currentProject = useCanvasBuilderStore.getState().htmlProject;
          const seedResults = await Promise.allSettled(
            currentProject.files.map((f) => writeServerFile(pid, f.name, f.content)),
          );
          // Only mark as "saved" if all seed writes returned 2xx
          const allSeedOk = seedResults.every(
            (r) => r.status === "fulfilled",
          );
          if (allSeedOk) {
            setLastSavedAt(Date.now());
          }
        }
        // If hasLocalCache and server is empty, keep the local cache
        // (it was likely seeded in a previous session)
        // Don't set lastSavedAt — nothing was saved by the user

        loadedProjectIdRef.current = pid;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load files";
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    }
  }, [projectId, enabled]);

  // ─── Debounced save to server on file changes ───────────────────────
  const htmlProject = useCanvasBuilderStore((s) => s.htmlProject);

  const saveToServer = useCallback(
    async (project: HtmlProject, pid: string) => {
      setIsSaving(true);
      setError(null);
      try {
        // FIX 2: Every write must return HTTP 2xx.
        // writeServerFile throws on non-2xx, so Promise.all rejects on any failure.
        await Promise.all(
          project.files.map((f) => writeServerFile(pid, f.name, f.content)),
        );

        // All writes succeeded — cache to per-project localStorage
        try {
          localStorage.setItem(CACHE_KEY_PREFIX + pid, JSON.stringify(project));
        } catch {
          // Cache write failed — non-fatal
        }

        setLastSavedAt(Date.now());
      } catch (err) {
        // FIX 2: Only set lastSavedAt after every file returns 2xx.
        // If any write fails, we set an error instead of "Saved".
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
  }, [htmlProject, projectId, enabled, saveToServer]);

  return { isLoading, isSaving, error, lastSavedAt };
}
