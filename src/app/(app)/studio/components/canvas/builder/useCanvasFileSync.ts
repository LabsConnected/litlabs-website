"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCanvasBuilderStore } from "./store";
import type { CanvasDocument } from "./types";
import { CANVAS_DOC_FILE, readWorkspaceFile } from "./canvas-site-export";

const DEBOUNCE_MS = 1200;

async function writeCanvasFile(
  projectId: string,
  serialized: string,
  keepalive = false,
): Promise<boolean> {
  try {
    const resp = await fetch(`/api/studio-projects/${projectId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "write", path: CANVAS_DOC_FILE, content: serialized }),
      keepalive,
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function parseServerUpdatedAt(content: string | null): number | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as CanvasDocument;
    return typeof parsed.updatedAt === "number" ? parsed.updatedAt : null;
  } catch {
    return null;
  }
}

/**
 * File-backed persistence for VisualCanvas (.litt/canvas.json).
 * Mirrors htmlProjectSyncPolicy pattern: server-wins on load, debounced writes.
 * Falls back to localStorage when no projectId (LOCAL without project).
 *
 * Guards added for durable persistence:
 *   - per-project load keys: switching projects reloads THAT project's
 *     canvas and never carries the previous project's document across.
 *   - revision check before every write: if the server's canvas.json is
 *     newer than the document we're saving (another tab/client won the
 *     race), the write is refused and saveState becomes "conflict"
 *     instead of silently reverting newer content.
 *   - unmount flush: a pending debounced save is sent with keepalive so
 *     navigation doesn't silently drop the last edit.
 */
export function useCanvasFileSync(projectId: string | null) {
  const document = useCanvasBuilderStore((s) => s.document);
  const setDocument = useCanvasBuilderStore((s) => s.setDocument);
  const setSaveState = useCanvasBuilderStore((s) => s.setSaveState);
  const saveState = useCanvasBuilderStore((s) => s.saveState);

  const loadedProjectIdRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastSavedRef = useRef<string>("");
  const pendingRef = useRef<{ projectId: string; serialized: string } | null>(null);

  // Load from file on mount and whenever the project changes (server-wins)
  useEffect(() => {
    if (!projectId) {
      loadedProjectIdRef.current = null;
      return;
    }
    if (loadedProjectIdRef.current === projectId) return;
    loadedProjectIdRef.current = projectId;
    lastSavedRef.current = "";
    pendingRef.current = null;

    (async () => {
      const content = await readWorkspaceFile(projectId, CANVAS_DOC_FILE);
      if (!content) return;
      try {
        const parsed = JSON.parse(content) as CanvasDocument;
        if (!parsed.nodes || !parsed.rootNodeIds) return;
        // Server-wins: only adopt if server version is newer, and only
        // while still on this project (an async load must not bleed a
        // previous project's canvas into the current one).
        if (loadedProjectIdRef.current !== projectId) return;
        const local = useCanvasBuilderStore.getState().document;
        if (parsed.updatedAt && local.updatedAt && parsed.updatedAt <= local.updatedAt) return;
        setDocument(parsed);
        setSaveState("saved");
        lastSavedRef.current = content;
      } catch {
        // malformed server file — fall back to localStorage
      }
    })();
  }, [projectId, setDocument, setSaveState]);

  const saveToFile = useCallback(
    async (doc: CanvasDocument, pid: string) => {
      const serialized = JSON.stringify(doc);
      if (serialized === lastSavedRef.current) return;
      setSaveState("saving");

      // Revision check: refuse to overwrite a newer server document.
      const serverContent = await readWorkspaceFile(pid, CANVAS_DOC_FILE);
      const serverUpdatedAt = parseServerUpdatedAt(serverContent);
      if (
        serverContent != null &&
        serverContent !== lastSavedRef.current &&
        serverUpdatedAt != null &&
        doc.updatedAt != null &&
        serverUpdatedAt > doc.updatedAt
      ) {
        setSaveState("conflict");
        return;
      }

      const ok = await writeCanvasFile(pid, serialized);
      if (ok) {
        lastSavedRef.current = serialized;
        pendingRef.current = null;
      }
      setSaveState(ok ? "saved" : "error");
    },
    [setSaveState],
  );

  // Debounced auto-save on document changes
  useEffect(() => {
    if (!projectId) return;
    if (loadedProjectIdRef.current !== projectId) return;
    if (saveState === "saving") return;
    const serialized = JSON.stringify(document);
    if (serialized === lastSavedRef.current) return;

    if (timerRef.current) window.clearTimeout(timerRef.current);
    pendingRef.current = { projectId, serialized };
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      pendingRef.current = null;
      saveToFile(document, projectId);
    }, DEBOUNCE_MS) as unknown as number;

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [document, projectId, saveState, saveToFile]);

  // Flush a pending save on unmount/project-switch so navigation doesn't
  // silently drop the last edit (keepalive outlives the fetch initiator).
  useEffect(() => {
    return () => {
      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        void writeCanvasFile(pending.projectId, pending.serialized, true);
      }
    };
  }, [projectId]);
}
