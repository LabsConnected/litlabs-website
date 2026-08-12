"use client";

/**
 * useHtmlProjectSync — bridges the HTML project store to the server
 * workspace so files are canonical on the server, not just localStorage.
 *
 * Flow:
 *   1. On mount, if there's an active studio project, load files from
 *      the server workspace (index.html, style.css, script.js).
 *   2. On file edits, debounce-save to the server workspace.
 *   3. localStorage remains as a cache/fallback for offline speed.
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

  // ─── Load files from server when project changes ────────────────────
  useEffect(() => {
    if (!enabled || !projectId) return;
    if (loadedProjectIdRef.current === projectId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        // Fetch each HTML file from the server workspace
        const fileResults = await Promise.allSettled(
          HTML_FILES.map(async (fileName) => {
            const res = await fetch(
              `/api/studio-projects/${projectId}/files`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "read", path: fileName }),
              },
            );
            if (!res.ok) return null;
            const data = await res.json();
            // The terminal server returns { content: string } or { content: string, path: string }
            const content = typeof data.content === "string" ? data.content : null;
            return { name: fileName, content };
          }),
        );

        if (cancelled) return;

        // Collect successfully loaded files
        const loadedFiles: { name: string; content: string }[] = [];
        for (let i = 0; i < fileResults.length; i++) {
          const result = fileResults[i];
          if (result.status === "fulfilled" && result.value?.content) {
            loadedFiles.push(result.value as { name: string; content: string });
          }
        }

        if (loadedFiles.length > 0) {
          // Server has files — use them as canonical
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
        } else {
          // Server is empty — push current local files to server
          // (this is a new workspace or first time opening HTML mode)
          const currentProject = useCanvasBuilderStore.getState().htmlProject;
          await Promise.allSettled(
            currentProject.files.map((f) =>
              fetch(`/api/studio-projects/${projectId}/files`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "write", path: f.name, content: f.content }),
              }),
            ),
          );
        }

        loadedProjectIdRef.current = projectId;
        setLastSavedAt(Date.now());
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

  // ─── Debounced save to server on file changes ───────────────────────
  const htmlProject = useCanvasBuilderStore((s) => s.htmlProject);

  const saveToServer = useCallback(
    async (project: HtmlProject, pid: string) => {
      setIsSaving(true);
      setError(null);
      try {
        // Save all files (they're small, and this ensures server matches local)
        const results = await Promise.allSettled(
          project.files.map((f) =>
            fetch(`/api/studio-projects/${pid}/files`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "write", path: f.name, content: f.content }),
            }),
          ),
        );

        const failed = results.some((r) => r.status === "rejected");
        if (failed) {
          setError("Some files failed to save");
        } else {
          setLastSavedAt(Date.now());
        }
      } catch (err) {
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
