"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCanvasBuilderStore } from "./store";
import type { CanvasDocument } from "./types";
import { CANVAS_DOC_FILE, readWorkspaceFile } from "./canvas-site-export";

const DEBOUNCE_MS = 1200;

/** True when the document holds user content — any node with children. */
function hasCanvasContent(doc: CanvasDocument): boolean {
  return Object.values(doc.nodes ?? {}).some(
    (node) => (node?.children?.length ?? 0) > 0,
  );
}

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

/**
 * File-backed persistence for VisualCanvas (.litt/canvas.json).
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
 *
 * Durable-persistence guards:
 *   - revision check before every write: if the server's canvas.json no
 *     longer matches the content we last confirmed persisted (another
 *     tab/client won the race), the write is refused and saveState becomes
 *     "conflict" instead of silently reverting newer content.
 *   - stale-completion guard: an in-flight save resolving after a project
 *     switch stamps nothing into the new project's sync state.
 *   - unmount/pagehide flush: a pending debounced save is sent (keepalive on
 *     unload) so navigation doesn't silently drop the last edit — but only
 *     while the bound project is still the loaded one; a flush never fires
 *     into a project we haven't finished loading.
 */
export function useCanvasFileSync(projectId: string | null) {
  const document = useCanvasBuilderStore((s) => s.document);
  const setDocument = useCanvasBuilderStore((s) => s.setDocument);
  const setSaveState = useCanvasBuilderStore((s) => s.setSaveState);
  const saveState = useCanvasBuilderStore((s) => s.saveState);

  const loadedForRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastSavedRef = useRef<string>("");
  /** True when the canvas read proved the server file does not exist —
   *  the CAS baseline for first writes. Distinct from lastSavedRef: a
   *  serialized empty document is NOT the same baseline as an absent file. */
  const baselineAbsentRef = useRef<boolean>(false);
  const lastAttemptedRef = useRef<string>("");
  const pendingRef = useRef<{ projectId: string; serialized: string } | null>(null);

  const saveToFile = useCallback(
    async (doc: CanvasDocument, pid: string) => {
      // Never write before this project's canvas read has settled — a save
      // racing the load could overwrite the saved document with a stale one.
      if (loadedForRef.current !== pid) return;
      const serialized = JSON.stringify(doc);
      if (serialized === lastSavedRef.current) return;
      // Record the attempt BEFORE writing: on failure the debounce effect
      // must not reschedule this same serialization forever — only a new
      // change or a teardown flush retries it.
      lastAttemptedRef.current = serialized;
      setSaveState("saving");

      // Revision check: refuse to overwrite a server document that no longer
      // matches our last confirmed baseline — a concurrent writer won. The
      // baseline is tri-state: confirmed-absent (file verified missing),
      // confirmed content (adopted/written by us), or unverifiable (read
      // failed at load — any mismatch fails closed to "conflict").
      const serverContent = await readWorkspaceFile(pid, CANVAS_DOC_FILE);
      // Stale-completion guard: the project may have switched while the read
      // was in flight. Touch nothing — markers, saveState, and the pending
      // schedule all belong to the now-current project.
      if (loadedForRef.current !== pid) return;
      const serverMatchesBaseline = baselineAbsentRef.current
        ? serverContent == null || serverContent === ""
        : serverContent === lastSavedRef.current;
      if (!serverMatchesBaseline) {
        setSaveState("conflict");
        return;
      }

      const ok = await writeCanvasFile(pid, serialized);
      // Same stale-completion guard after the write: the write itself landed
      // on the right project (the pid is bound in the URL), but only the
      // still-current project may advance its saved markers.
      if (loadedForRef.current !== pid) return;
      if (ok) {
        lastSavedRef.current = serialized;
        baselineAbsentRef.current = false;
        pendingRef.current = null;
      }
      setSaveState(ok ? "saved" : "error");
    },
    [setSaveState],
  );

  // Load from file on project change (server-wins)
  useEffect(() => {
    if (!projectId) return;
    if (loadedForRef.current === projectId) return;
    let cancelled = false;

    // A project switch abandons any pending write and resets the baseline so
    // the incoming project can never inherit the previous project's markers.
    // The pending debounced document is deliberately NOT flushed here — the
    // drop contract routes recovery through namespaced localStorage instead.
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    lastSavedRef.current = "";
    baselineAbsentRef.current = false;
    lastAttemptedRef.current = "";

    (async () => {
      let settled: "adopted" | "empty" | "unknown";
      let content: string | null = null;
      try {
        const resp = await fetch(`/api/studio-projects/${projectId}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read", path: CANVAS_DOC_FILE }),
        });
        if (cancelled) return;

        if (resp.status === 404) {
          settled = "empty";
        } else if (!resp.ok) {
          settled = "unknown";
        } else {
          const data = (await resp.json()) as { content?: unknown };
          if (cancelled) return;
          const c = data.content;
          if (c == null || c === "") {
            settled = "empty";
          } else if (typeof c !== "string") {
            // Response contract violation — cannot verify server state.
            settled = "unknown";
          } else {
            content = c;
            try {
              const parsed = JSON.parse(c) as CanvasDocument;
              // Server-wins unconditionally: a valid saved canvas replaces
              // the local document. A fresh (empty/newer-timestamped) local
              // doc must never beat real saved work.
              if (parsed.nodes && parsed.rootNodeIds) {
                setDocument(parsed);
                setSaveState("saved");
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
      if (settled === "adopted") {
        lastSavedRef.current = content ?? "";
        baselineAbsentRef.current = false;
      } else if (settled === "empty") {
        // The server confirmed it holds no canvas. Local work is real user
        // content (project-less building, restored session) — first-sync it
        // into the workspace now that the read has settled.
        baselineAbsentRef.current = true;
        const local = useCanvasBuilderStore.getState().document;
        if (hasCanvasContent(local)) {
          loadedForRef.current = projectId;
          void saveToFile(local, projectId);
        } else {
          lastSavedRef.current = JSON.stringify(local);
        }
      } else {
        // Server state could not be verified — never auto-write over it.
        // Baseline-adopt the local doc so only explicit edits persist; any
        // later divergence fails closed to "conflict" at the revision check.
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

  // Flush unsaved content when the component unmounts (SPA navigation) or
  // the page unloads. keepalive is required for the unload path. The flush
  // fires only while the bound project is still the loaded one, so a
  // teardown can never write a stale document into a different project.
  useEffect(() => {
    const flush = (keepalive: boolean) => {
      if (!projectId || loadedForRef.current !== projectId) return;
      const pending = pendingRef.current;
      const serialized =
        pending && pending.projectId === projectId
          ? pending.serialized
          : JSON.stringify(useCanvasBuilderStore.getState().document);
      if (serialized === lastSavedRef.current) return;
      // Mark before firing: the hook is tearing down, and this one-shot
      // flush must not double-write alongside the reload-time load.
      lastSavedRef.current = serialized;
      pendingRef.current = null;
      void fetch(`/api/studio-projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write", path: CANVAS_DOC_FILE, content: serialized }),
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
