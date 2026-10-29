"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCanvasBuilderStore } from "./store";
import type { CanvasDocument } from "./types";

const CANVAS_FILE = ".litt/canvas.json";
const DEBOUNCE_MS = 1200;

/**
 * File-backed persistence for VisualCanvas.
 * Mirrors htmlProjectSyncPolicy pattern: server-wins on load, debounced writes.
 * Falls back to localStorage when no projectId (LOCAL without project).
 *
 * Load lifecycle is keyed to the CURRENT projectId: `loadedForRef` holds the
 * projectId whose canvas read has fully settled (adopted or baseline). Saves
 * are gated on it, so a debounced write can never fire for a project whose
 * canvas hasn't finished loading, and switching projects re-loads instead of
 * carrying the previous project's document forward.
 */
export function useCanvasFileSync(projectId: string | null) {
  const document = useCanvasBuilderStore((s) => s.document);
  const setDocument = useCanvasBuilderStore((s) => s.setDocument);
  const setSaveState = useCanvasBuilderStore((s) => s.setSaveState);
  const saveState = useCanvasBuilderStore((s) => s.saveState);

  const loadedForRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastSavedRef = useRef<string>("");
  const lastAttemptedRef = useRef<string>("");

  // Load from file on project change (server-wins)
  useEffect(() => {
    if (!projectId) return;
    if (loadedForRef.current === projectId) return;
    let cancelled = false;

    // A project switch abandons any pending write and resets the baseline so
    // the incoming project can never inherit the previous project's markers.
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastSavedRef.current = "";
    lastAttemptedRef.current = "";

    (async () => {
      try {
        const resp = await fetch(`/api/studio-projects/${projectId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read", path: CANVAS_FILE }),
        });
        if (cancelled) return;

        let adopted = false;
        if (resp.ok) {
          const data = (await resp.json()) as { content?: string };
          if (data.content) {
            try {
              const parsed = JSON.parse(data.content) as CanvasDocument;
              // Server-wins unconditionally: a valid saved canvas replaces
              // the local document. A fresh (empty/newer-timestamped) local
              // doc must never beat real saved work.
              if (parsed.nodes && parsed.rootNodeIds) {
                setDocument(parsed);
                setSaveState("saved");
                lastSavedRef.current = data.content;
                adopted = true;
              }
            } catch {
              // Malformed canvas file — keep the local document.
            }
          }
        }
        if (!adopted && !cancelled) {
          // No usable canvas on the server. Adopt the current local
          // document as the baseline so the first load does not trigger a
          // write, but subsequent edits still save.
          lastSavedRef.current = JSON.stringify(
            useCanvasBuilderStore.getState().document,
          );
        }
      } catch {
        if (!cancelled) {
          lastSavedRef.current = JSON.stringify(
            useCanvasBuilderStore.getState().document,
          );
        }
      } finally {
        if (!cancelled) loadedForRef.current = projectId;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, setDocument, setSaveState]);

  const saveToFile = useCallback(
    async (doc: CanvasDocument) => {
      if (!projectId) return;
      // Never write before this project's canvas read has settled — a save
      // racing the load could overwrite the saved document with a stale one.
      if (loadedForRef.current !== projectId) return;
      const serialized = JSON.stringify(doc);
      if (serialized === lastSavedRef.current) return;
      // Record the attempt BEFORE writing: on failure the debounce effect
      // must not reschedule this same serialization forever — only a new
      // change or a teardown flush retries it.
      lastAttemptedRef.current = serialized;
      setSaveState("saving");
      try {
        const resp = await fetch(`/api/studio-projects/${projectId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "write", path: CANVAS_FILE, content: serialized }),
        });
        if (resp.ok) {
          // The saved marker advances ONLY on a confirmed write, so a failed
          // save stays dirty and is retried by the next change or a flush.
          lastSavedRef.current = serialized;
        }
        setSaveState(resp.ok ? "saved" : "error");
      } catch {
        setSaveState("error");
      }
    },
    [projectId, setSaveState],
  );

  // Debounced auto-save on document changes
  useEffect(() => {
    if (!projectId) return;
    // Block saves until this project's load has settled.
    if (loadedForRef.current !== projectId) return;
    if (saveState === "saving") return;
    const serialized = JSON.stringify(document);
    if (serialized === lastSavedRef.current) return;
    if (serialized === lastAttemptedRef.current) return;

    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      saveToFile(document);
    }, DEBOUNCE_MS) as unknown as number;

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [document, projectId, saveState, saveToFile]);

  // Flush unsaved content when the component unmounts (SPA navigation) or
  // the page unloads. keepalive is required for the unload path.
  useEffect(() => {
    const flush = (keepalive: boolean) => {
      if (!projectId || loadedForRef.current !== projectId) return;
      const doc = useCanvasBuilderStore.getState().document;
      const serialized = JSON.stringify(doc);
      if (serialized === lastSavedRef.current) return;
      // Mark before firing: the hook is tearing down, and this one-shot
      // flush must not double-write alongside the reload-time load.
      lastSavedRef.current = serialized;
      void fetch(`/api/studio-projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write", path: CANVAS_FILE, content: serialized }),
        ...(keepalive ? { keepalive: true } : {}),
      }).catch(() => {});
    };
    const onPageHide = () => flush(true);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      flush(false);
    };
  }, [projectId]);
}
