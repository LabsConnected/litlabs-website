"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCanvasBuilderStore } from "./store";
import type { CanvasDocument } from "./types";

const CANVAS_FILE = ".litt/canvas.json";
const DEBOUNCE_MS = 1200;

/** True when the document holds user content — any node with children. */
function hasCanvasContent(doc: CanvasDocument): boolean {
  return Object.values(doc.nodes ?? {}).some(
    (node) => (node?.children?.length ?? 0) > 0,
  );
}

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
 *
 * Read outcomes (same contract as htmlProjectSyncPolicy.fetchServerFile):
 * - valid canvas        → server-wins: adopted unconditionally.
 * - missing file        → 404 or a 2xx without content = confirmed-empty: real
 *                         local work is first-synced into the workspace; an
 *                         untouched empty doc is baseline-adopted instead so
 *                         it is never persisted as a blank canvas.
 * - anything else       → 5xx/401/403/network/malformed = unverified server
 *                         state: the local doc is baseline-adopted and never
 *                         auto-written over content we could not inspect.
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
      let settled: "adopted" | "empty" | "unknown";
      try {
        const resp = await fetch(`/api/studio-projects/${projectId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read", path: CANVAS_FILE }),
        });
        if (cancelled) return;

        if (resp.status === 404) {
          settled = "empty";
        } else if (!resp.ok) {
          settled = "unknown";
        } else {
          const data = (await resp.json()) as { content?: unknown };
          if (cancelled) return;
          const content = data.content;
          if (content == null || content === "") {
            settled = "empty";
          } else if (typeof content !== "string") {
            // Response contract violation — cannot verify server state.
            settled = "unknown";
          } else {
            try {
              const parsed = JSON.parse(content) as CanvasDocument;
              // Server-wins unconditionally: a valid saved canvas replaces
              // the local document. A fresh (empty/newer-timestamped) local
              // doc must never beat real saved work.
              if (parsed.nodes && parsed.rootNodeIds) {
                setDocument(parsed);
                setSaveState("saved");
                lastSavedRef.current = content;
                settled = "adopted";
              } else {
                settled = "unknown";
              }
            } catch {
              // Malformed canvas file — unverified content, not "empty".
              settled = "unknown";
            }
          }
        }
      } catch {
        settled = "unknown";
      }

      if (cancelled) return;
      if (settled === "empty") {
        // The server confirmed it holds no canvas. Local work is real user
        // content (project-less building, restored session) — first-sync it
        // into the workspace now that the read has settled.
        const local = useCanvasBuilderStore.getState().document;
        if (hasCanvasContent(local)) {
          loadedForRef.current = projectId;
          void saveToFile(local);
        } else {
          lastSavedRef.current = JSON.stringify(local);
        }
      } else if (settled === "unknown") {
        // Server state could not be verified — never auto-write over it.
        // Baseline-adopt the local doc so only explicit edits persist.
        lastSavedRef.current = JSON.stringify(
          useCanvasBuilderStore.getState().document,
        );
      }
      loadedForRef.current = projectId;
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, setDocument, setSaveState, saveToFile]);

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
