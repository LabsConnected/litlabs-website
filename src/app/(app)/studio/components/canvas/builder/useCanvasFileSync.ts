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
 */
export function useCanvasFileSync(projectId: string | null) {
  const document = useCanvasBuilderStore((s) => s.document);
  const setDocument = useCanvasBuilderStore((s) => s.setDocument);
  const setSaveState = useCanvasBuilderStore((s) => s.setSaveState);
  const saveState = useCanvasBuilderStore((s) => s.saveState);

  const hasLoadedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const lastSavedRef = useRef<string>("");
  const lastFailedRef = useRef<string>("");

  // Load from file on mount (server-wins)
  useEffect(() => {
    if (!projectId) return;
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    (async () => {
      try {
        const resp = await fetch(`/api/studio-projects/${projectId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read", path: CANVAS_FILE }),
        });
        if (!resp.ok) return;
        const data = (await resp.json()) as { content?: string };
        if (!data.content) return;
        const parsed = JSON.parse(data.content) as CanvasDocument;
        if (!parsed.nodes || !parsed.rootNodeIds) return;
        // Server-wins: only adopt if server version is newer
        const local = useCanvasBuilderStore.getState().document;
        if (data.content === JSON.stringify(local)) {
          // Already in sync — mark as saved so nothing is rewritten.
          lastSavedRef.current = data.content;
          setSaveState("saved");
          return;
        }
        if (parsed.updatedAt && local.updatedAt && parsed.updatedAt <= local.updatedAt) return;
        setDocument(parsed);
        setSaveState("saved");
        lastSavedRef.current = data.content;
      } catch {
        // fallback to localStorage
      }
    })();
  }, [projectId, setDocument, setSaveState]);

  const saveToFile = useCallback(async (doc: CanvasDocument) => {
    if (!projectId) return;
    const serialized = JSON.stringify(doc);
    if (serialized === lastSavedRef.current) return;
    setSaveState("saving");
    try {
      const resp = await fetch(`/api/studio-projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write", path: CANVAS_FILE, content: serialized }),
      });
      // lastSaved only on success — a failed write must not poison the dedup
      // check. lastFailed dedupes retries of the same failing content so the
      // effect cannot reschedule into an infinite retry loop.
      if (resp.ok) {
        lastSavedRef.current = serialized;
        lastFailedRef.current = "";
      } else {
        lastFailedRef.current = serialized;
      }
      setSaveState(resp.ok ? "saved" : "error");
    } catch {
      lastFailedRef.current = serialized;
      setSaveState("error");
    }
  }, [projectId, setSaveState]);

  // Debounced auto-save on document changes
  useEffect(() => {
    if (!projectId) return;
    if (!hasLoadedRef.current) return;
    if (saveState === "saving") return;
    const serialized = JSON.stringify(document);
    if (serialized === lastSavedRef.current) return;
    if (serialized === lastFailedRef.current) return;

    if (timerRef.current) window.clearTimeout(timerRef.current);
    const doc = document;
    timerRef.current = window.setTimeout(() => {
      void saveToFile(doc);
    }, DEBOUNCE_MS) as unknown as number;

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [document, projectId, saveState, saveToFile]);

  // Flush unsaved content so a pending debounce or previously-failed write is
  // not silently lost. Two triggers are required:
  // - effect cleanup: covers SPA unmount (navigation within the app)
  // - pagehide: covers full reload/close, where React never runs cleanups
  // keepalive lets the request survive page unload. Reads the latest document
  // from the store so stale closures cannot drop newer edits.
  const flushUnsaved = useCallback((useKeepalive: boolean) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (!projectId || !hasLoadedRef.current) return;
    const serialized = JSON.stringify(useCanvasBuilderStore.getState().document);
    if (serialized === lastSavedRef.current) return;
    try {
      void fetch(`/api/studio-projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write", path: CANVAS_FILE, content: serialized }),
        // keepalive is required on unload but capped at 64KB by browsers —
        // SPA unmount uses a normal request (no cap, response tracked).
        ...(useKeepalive ? { keepalive: true } : {}),
      }).then((resp) => {
        if (resp.ok) lastSavedRef.current = serialized;
      });
    } catch {
      // fire-and-forget on unload
    }
  }, [projectId]);

  useEffect(() => {
    const onPageHide = () => flushUnsaved(true);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      flushUnsaved(false);
    };
  }, [flushUnsaved]);
}
