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
    lastSavedRef.current = serialized;
    setSaveState("saving");
    try {
      const resp = await fetch(`/api/studio-projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write", path: CANVAS_FILE, content: serialized }),
      });
      setSaveState(resp.ok ? "saved" : "error");
    } catch {
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

    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      saveToFile(document);
    }, DEBOUNCE_MS) as unknown as number;

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [document, projectId, saveState, saveToFile]);
}
