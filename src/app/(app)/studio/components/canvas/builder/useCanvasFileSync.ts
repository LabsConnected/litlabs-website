"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useCanvasBuilderStore, setCanvasServerFlush } from "./store";
import { createEmptyDocument, type CanvasDocument } from "./types";

const CANVAS_FILE = ".litt/canvas.json";
const DEBOUNCE_MS = 1200;

type SyncPhase =
  /** No project bound — file sync is inert (LOCAL/localStorage only). */
  | "idle"
  /** The project's canvas read is in flight or pending. Writes are blocked. */
  | "loading"
  /** This project's document was loaded (or confirmed absent). Writes allowed. */
  | "ready"
  /** The project's canvas read failed for an unexplained reason. Writes are
   *  blocked so a stale/default document can never clobber the saved canvas. */
  | "blocked";

/**
 * File-backed persistence for VisualCanvas.
 *
 * Safety contract (per-project, refs are reset on every projectId change):
 * - No write may happen before this project's canvas read has settled.
 * - The server document always wins on load: at load time the local document
 *   is either a fresh default or the PREVIOUS project's canvas — never an
 *   authorized edit of this project's file.
 * - A missing canvas (404 / empty response) seeds a fresh empty document for
 *   this project; the previous project's document is never adopted or
 *   persisted into the newly selected project.
 * - An unexplained read failure moves the project to "blocked" — auto-save
 *   is disabled until a clean read succeeds (explicit Save retries the read,
 *   never the write).
 * - `lastSaved` only advances after a successful write, so a failed save is
 *   retried on the next document change or explicit Save.
 */
export function useCanvasFileSync(projectId: string | null) {
  const document = useCanvasBuilderStore((s) => s.document);
  const setDocument = useCanvasBuilderStore((s) => s.setDocument);
  const setSaveState = useCanvasBuilderStore((s) => s.setSaveState);
  const saveState = useCanvasBuilderStore((s) => s.saveState);

  const syncRef = useRef<{
    phase: SyncPhase;
    projectId: string | null;
    /** Read request in flight for the current project. */
    inflight: boolean;
    /** Last content confirmed persisted for the CURRENT project. */
    lastSaved: string;
    /** Last content a write was attempted for — suppresses auto-save retry
     *  loops on persistent failure; explicit Save bypasses it. */
    lastAttempted: string;
  }>({ phase: "idle", projectId: null, inflight: false, lastSaved: "", lastAttempted: "" });
  const timerRef = useRef<number | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  // Load the canvas file whenever the bound project changes (server-wins).
  useEffect(() => {
    const sync = syncRef.current;
    if (!projectId) {
      sync.phase = "idle";
      sync.projectId = null;
      sync.inflight = false;
      sync.lastSaved = "";
      sync.lastAttempted = "";
      return;
    }
    if (sync.projectId !== projectId) {
      // Project switch: drop any pending write for the old project and start
      // a fresh load. Until the read settles, every write is blocked.
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      sync.phase = "loading";
      sync.projectId = projectId;
      sync.inflight = false;
      sync.lastSaved = "";
      sync.lastAttempted = "";
    }
    if (sync.phase !== "loading" || sync.inflight) return;
    sync.inflight = true;

    const expectedProject = projectId;
    const seedEmptyDocument = () => {
      const fresh = createEmptyDocument(expectedProject);
      setDocument(fresh);
      sync.lastSaved = JSON.stringify(fresh);
      sync.lastAttempted = "";
      sync.inflight = false;
      sync.phase = "ready";
      setSaveState("saved");
    };

    (async () => {
      try {
        const resp = await fetch(`/api/studio-projects/${expectedProject}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read", path: CANVAS_FILE }),
        });
        // A different project was selected (or a retry was forced) while the
        // read was in flight — discard this result.
        if (sync.projectId !== expectedProject || sync.phase !== "loading") return;
        if (!resp.ok) {
          // 404 = no saved canvas for this project (the API re-provisions and
          // retries once before reporting it, so this is a genuine absence).
          if (resp.status === 404) {
            seedEmptyDocument();
            return;
          }
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = (await resp.json()) as { content?: string };
        if (!data.content) {
          seedEmptyDocument();
          return;
        }
        const parsed = JSON.parse(data.content) as CanvasDocument;
        if (!parsed.nodes || !parsed.rootNodeIds) {
          throw new Error("Invalid canvas document");
        }
        setDocument(parsed);
        sync.lastSaved = data.content;
        sync.lastAttempted = "";
        sync.inflight = false;
        sync.phase = "ready";
        setSaveState("saved");
      } catch {
        if (sync.projectId !== expectedProject) return;
        // Unexplained read failure: block every write for this project so a
        // default/stale document cannot overwrite the saved canvas. The user
        // sees the honest error state; explicit Save retries the READ.
        sync.inflight = false;
        sync.phase = "blocked";
        setSaveState("error");
      }
    })();
  }, [projectId, loadNonce, setDocument, setSaveState]);

  const saveToFile = useCallback(
    async (doc: CanvasDocument) => {
      const sync = syncRef.current;
      if (!projectId) return;
      if (sync.phase !== "ready" || sync.projectId !== projectId) return;
      const serialized = JSON.stringify(doc);
      if (serialized === sync.lastSaved) return;
      sync.lastAttempted = serialized;
      setSaveState("saving");
      try {
        const resp = await fetch(`/api/studio-projects/${projectId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "write", path: CANVAS_FILE, content: serialized }),
        });
        if (resp.ok) {
          // Only a confirmed write may advance the saved marker — otherwise a
          // failed save would look persisted and never retry.
          sync.lastSaved = serialized;
          setSaveState("saved");
        } else {
          setSaveState("error");
        }
      } catch {
        setSaveState("error");
      }
    },
    [projectId, setSaveState],
  );

  // Debounced auto-save on document changes — only once this project's
  // document has loaded, and never after an unexplained read failure.
  useEffect(() => {
    if (!projectId) return;
    const sync = syncRef.current;
    if (sync.phase !== "ready" || sync.projectId !== projectId) return;
    if (saveState === "saving") return;
    const serialized = JSON.stringify(document);
    if (serialized === sync.lastSaved) return;
    // This exact content already failed to write — do not loop the same
    // request every debounce. A new edit changes the serialized form and
    // retries naturally; explicit Save bypasses this guard.
    if (serialized === sync.lastAttempted) return;

    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      saveToFile(document);
    }, DEBOUNCE_MS) as unknown as number;

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [document, projectId, saveState, saveToFile]);

  // Explicit Save (CanvasToolbar → store.saveDocument) reaches the file write
  // through this registered flush. When the project is blocked, the safe
  // retry is a fresh READ (never a blind write).
  const flushNow = useCallback(() => {
    const sync = syncRef.current;
    if (!projectId) return;
    if (sync.phase === "blocked") {
      sync.phase = "loading";
      sync.inflight = false;
      setLoadNonce((n) => n + 1);
      return;
    }
    if (sync.phase !== "ready" || sync.projectId !== projectId) return;
    // Manual save retries content that already failed once.
    sync.lastAttempted = "";
    void saveToFile(useCanvasBuilderStore.getState().document);
  }, [projectId, saveToFile]);

  useEffect(() => {
    setCanvasServerFlush(flushNow);
    return () => setCanvasServerFlush(null);
  }, [flushNow]);
}
