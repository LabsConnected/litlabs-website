"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useCanvasBuilderStore, setCanvasServerFlush, loadFromStorage } from "./store";
import { createEmptyDocument, type CanvasDocument } from "./types";
import { sha256Hex, CAS_ABSENT, type CanvasFileState } from "@/lib/studio/canvas-ssot";

const CANVAS_FILE = ".litt/canvas.json";
const DEBOUNCE_MS = 1200;
const APPLY_DEBOUNCE_MS = 800;

type SyncPhase =
  /** No project bound — file sync is inert (LOCAL/localStorage only). */
  | "idle"
  /** The project's canvas read is in flight or pending. Writes are blocked. */
  | "loading"
  /** This project's document was loaded (or confirmed absent). Writes allowed. */
  | "ready"
  /** The project's canvas read failed for an unexplained reason, or a write
   *  was rejected by the revision check. Writes are blocked so a stale or
   *  default document can never clobber the saved canvas. */
  | "blocked";

/**
 * File-backed persistence for VisualCanvas.
 *
 * Safety contract (per-project, refs are reset on every projectId change):
 * - No write may happen before this project's canvas read has settled.
 * - The server document always wins on load: at load time the local document
 *   is either a fresh default or the PREVIOUS project's canvas — never an
 *   authorized edit of this project's file.
 * - A missing canvas (404) seeds this project's NAMESPACED localStorage draft
 *   when one exists (drafts are never silently dropped); otherwise a fresh
 *   empty document. The previous project's document is never adopted.
 * - Writes carry `expectedSha256` (compare-and-swap): if the server file
 *   changed since our last confirmed revision — another tab, another device,
 *   a supersede write from the apply route — the write is rejected (409) and
 *   the project moves to "blocked" with an explicit conflict flag instead of
 *   silently overwriting. Explicit Save retries the READ, never the write.
 * - After a confirmed canvas.json write, materialization is requested from
 *   the server (`/canvas/apply`), which regenerates index.html only when the
 *   classified state allows it — a diverged hand-written file is never
 *   overwritten automatically.
 */
export function useCanvasFileSync(projectId: string | null) {
  const document = useCanvasBuilderStore((s) => s.document);
  const setDocument = useCanvasBuilderStore((s) => s.setDocument);
  const setSaveState = useCanvasBuilderStore((s) => s.setSaveState);
  const saveState = useCanvasBuilderStore((s) => s.saveState);
  const setCanvasFileState = useCanvasBuilderStore((s) => s.setCanvasFileState);
  const setSyncConflict = useCanvasBuilderStore((s) => s.setSyncConflict);

  const syncRef = useRef<{
    phase: SyncPhase;
    projectId: string | null;
    /** Read request in flight for the current project. */
    inflight: boolean;
    /** Last content confirmed persisted for the CURRENT project. */
    lastSaved: string;
    /** sha256 of the server's current canvas.json revision for CAS writes —
     *  "absent" when we know the file does not exist. */
    lastSavedSha: string;
    /** Last content a write was attempted for — suppresses auto-save retry
     *  loops on persistent failure; explicit Save bypasses it. */
    lastAttempted: string;
  }>({ phase: "idle", projectId: null, inflight: false, lastSaved: "", lastSavedSha: CAS_ABSENT, lastAttempted: "" });
  const timerRef = useRef<number | null>(null);
  const applyTimerRef = useRef<number | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  const applyUrl = useCallback(
    (pid: string) => `/api/studio-projects/${pid}/canvas/apply`,
    [],
  );

  /** Poll the server-side classification and publish it to the store. */
  const refreshCanvasFileState = useCallback(
    async (pid: string) => {
      try {
        const resp = await fetch(applyUrl(pid));
        if (!resp.ok) return;
        const data = (await resp.json()) as { state?: CanvasFileState };
        if (data.state) setCanvasFileState(data.state);
      } catch {
        // Status poll — non-fatal; the banner simply shows nothing new.
      }
    },
    [applyUrl, setCanvasFileState],
  );

  /**
   * Ask the server to materialize canvas → index.html when safe. No
   * resolution is sent: a "conflict" response only updates the banner state.
   */
  const requestApply = useCallback(
    async (pid: string) => {
      try {
        const resp = await fetch(applyUrl(pid), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = (await resp.json().catch(() => ({}))) as { state?: CanvasFileState };
        if (data.state) setCanvasFileState(data.state);
      } catch {
        // Apply is best-effort here; publish still enforces the gate.
      }
    },
    [applyUrl, setCanvasFileState],
  );

  const scheduleApply = useCallback(
    (pid: string) => {
      if (applyTimerRef.current) window.clearTimeout(applyTimerRef.current);
      applyTimerRef.current = window.setTimeout(() => {
        void requestApply(pid);
      }, APPLY_DEBOUNCE_MS) as unknown as number;
    },
    [requestApply],
  );

  // Load the canvas file whenever the bound project changes (server-wins).
  useEffect(() => {
    const sync = syncRef.current;
    if (!projectId) {
      sync.phase = "idle";
      sync.projectId = null;
      sync.inflight = false;
      sync.lastSaved = "";
      sync.lastSavedSha = CAS_ABSENT;
      sync.lastAttempted = "";
      setCanvasFileState(null);
      setSyncConflict(null);
      return;
    }
    if (sync.projectId !== projectId) {
      // Project switch: drop any pending write/apply for the old project and
      // start a fresh load. Until the read settles, every write is blocked.
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (applyTimerRef.current) {
        window.clearTimeout(applyTimerRef.current);
        applyTimerRef.current = null;
      }
      sync.phase = "loading";
      sync.projectId = projectId;
      sync.inflight = false;
      sync.lastSaved = "";
      sync.lastSavedSha = CAS_ABSENT;
      sync.lastAttempted = "";
      setCanvasFileState(null);
      setSyncConflict(null);
    }
    if (sync.phase !== "loading" || sync.inflight) return;
    sync.inflight = true;

    const expectedProject = projectId;
    const seedDocument = () => {
      // Server has no canvas for this project. A namespaced local draft is
      // this project's own unfinished work — adopt it (marked dirty so the
      // next edit persists it); never adopt another project's document.
      const local = loadFromStorage(expectedProject);
      const fresh = local ?? createEmptyDocument(expectedProject);
      setDocument(fresh);
      // History must restart at this project's document — undo into a
      // different project's state would write it into this project.
      useCanvasBuilderStore.setState({
        history: [{ document: fresh, description: "Loaded", timestamp: Date.now() }],
        historyIndex: 0,
      });
      sync.lastSaved = local ? "" : JSON.stringify(fresh);
      sync.lastSavedSha = CAS_ABSENT;
      sync.lastAttempted = "";
      sync.inflight = false;
      sync.phase = "ready";
      setSaveState(local ? "dirty" : "saved");
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
            seedDocument();
            return;
          }
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = (await resp.json()) as { content?: string; sha256?: string };
        if (!data.content) {
          seedDocument();
          return;
        }
        const parsed = JSON.parse(data.content) as CanvasDocument;
        if (!parsed.nodes || !parsed.rootNodeIds) {
          throw new Error("Invalid canvas document");
        }
        setDocument(parsed);
        useCanvasBuilderStore.setState({
          history: [{ document: parsed, description: "Loaded", timestamp: Date.now() }],
          historyIndex: 0,
        });
        sync.lastSaved = data.content;
        sync.lastSavedSha = data.sha256 ?? (await sha256Hex(data.content));
        sync.lastAttempted = "";
        sync.inflight = false;
        sync.phase = "ready";
        setSaveState("saved");
        // The canvas may already hold unapplied work (saved before the apply
        // path existed, or written by another session). Surface the state;
        // auto-apply only when classification says the file is untouched.
        void refreshCanvasFileState(expectedProject).then(() => {
          if (sync.projectId !== expectedProject) return;
          const state = useCanvasBuilderStore.getState().canvasFileState;
          if (state === "pending" || state === "unapplied") {
            void requestApply(expectedProject);
          }
        });
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
  }, [projectId, loadNonce, setDocument, setSaveState, setCanvasFileState, setSyncConflict, refreshCanvasFileState, requestApply]);

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
          body: JSON.stringify({
            action: "write",
            path: CANVAS_FILE,
            content: serialized,
            expectedSha256: sync.lastSavedSha,
          }),
        });
        if (resp.ok) {
          // Only a confirmed write may advance the saved marker — otherwise a
          // failed save would look persisted and never retry.
          const data = (await resp.json().catch(() => ({}))) as { sha256?: string };
          sync.lastSaved = serialized;
          sync.lastSavedSha = data.sha256 ?? (await sha256Hex(serialized));
          setSaveState("saved");
          // Canvas persisted — materialize to index.html when safe.
          scheduleApply(projectId);
        } else if (resp.status === 409) {
          // CAS rejected: canvas.json changed on the server since our last
          // revision. Do NOT retry the write — block and flag it; the local
          // document stays intact in localStorage for the user to reconcile.
          sync.phase = "blocked";
          setSyncConflict("canvas.json changed on the server — local draft preserved, reload to reconcile");
          setSaveState("error");
        } else {
          setSaveState("error");
        }
      } catch {
        setSaveState("error");
      }
    },
    [projectId, setSaveState, setSyncConflict, scheduleApply],
  );

  // Debounced auto-save on document changes — only once this project's
  // document has loaded, and never after an unexplained read failure or a
  // rejected write.
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
  // retry is a fresh READ (never a blind write) — it clears the CAS conflict
  // state the same way.
  const flushNow = useCallback(() => {
    const sync = syncRef.current;
    if (!projectId) return;
    if (sync.phase === "blocked") {
      sync.phase = "loading";
      sync.inflight = false;
      setSyncConflict(null);
      setLoadNonce((n) => n + 1);
      return;
    }
    if (sync.phase !== "ready" || sync.projectId !== projectId) return;
    // Manual save retries content that already failed once.
    sync.lastAttempted = "";
    void saveToFile(useCanvasBuilderStore.getState().document);
  }, [projectId, saveToFile, setSyncConflict]);

  useEffect(() => {
    setCanvasServerFlush(flushNow);
    return () => setCanvasServerFlush(null);
  }, [flushNow]);
}
