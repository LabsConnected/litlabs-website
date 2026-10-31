"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCanvasBuilderStore } from "./store";
import type { CanvasDocument } from "./types";
import { CANVAS_DOC_FILE } from "./canvas-site-export";

const DEBOUNCE_MS = 1200;

/** Sentinel CAS revision: "the file must not exist". */
const CAS_ABSENT = "absent";

/** True when the document holds user content — any node with children. */
function hasCanvasContent(doc: CanvasDocument): boolean {
  return Object.values(doc.nodes ?? {}).some(
    (node) => (node?.children?.length ?? 0) > 0,
  );
}

interface CanvasRead {
  /** HTTP status of the files read (404 = confirmed absent). */
  status: number;
  content: string | null;
  /** sha256 revision reported by the terminal (null = older terminal). */
  sha256: string | null;
}

async function readCanvasFile(projectId: string): Promise<CanvasRead> {
  try {
    const resp = await fetch(`/api/studio-projects/${projectId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", path: CANVAS_DOC_FILE }),
    });
    const data = (await resp.json().catch(() => ({}))) as {
      content?: unknown;
      sha256?: unknown;
    };
    return {
      status: resp.status,
      content: typeof data.content === "string" ? data.content : null,
      sha256: typeof data.sha256 === "string" ? data.sha256 : null,
    };
  } catch {
    return { status: 0, content: null, sha256: null };
  }
}

interface CanvasWriteResult {
  ok: boolean;
  status: number;
  sha256: string | null;
}

async function writeCanvasFile(
  projectId: string,
  serialized: string,
  opts: { keepalive?: boolean; expectedSha256?: string } = {},
): Promise<CanvasWriteResult> {
  try {
    const resp = await fetch(`/api/studio-projects/${projectId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "write",
        path: CANVAS_DOC_FILE,
        content: serialized,
        ...(opts.expectedSha256 ? { expectedSha256: opts.expectedSha256 } : {}),
      }),
      ...(opts.keepalive ? { keepalive: true } : {}),
    });
    const data = (await resp.json().catch(() => ({}))) as { sha256?: unknown };
    return {
      ok: resp.ok,
      status: resp.status,
      sha256: typeof data.sha256 === "string" ? data.sha256 : null,
    };
  } catch {
    return { ok: false, status: 0, sha256: null };
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
 * - valid canvas        → server-wins: adopted unconditionally; its sha256
 *                         becomes the compare-and-swap baseline.
 * - missing file        → 404 = confirmed-absent: real local work is
 *                         first-synced into the workspace; an untouched
 *                         empty doc is baseline-adopted instead so it is
 *                         never persisted as a blank canvas. Baseline is
 *                         the CAS sentinel "absent".
 * - anything else       → 5xx/401/403/network/malformed = unverified server
 *                         state: the local doc is baseline-adopted (sha
 *                         unknown) and never auto-written over content we
 *                         could not inspect.
 *
 * Durable-persistence guards:
 *   - compare-and-swap writes: every write carries `expectedSha256`, the
 *     sha256 of the revision we last confirmed (or "absent"). If the server
 *     file changed since then — another tab, another device — the write is
 *     rejected (409 REVISION_CONFLICT) and saveState becomes "conflict"
 *     instead of silently reverting newer content.
 *   - unverified baselines fail closed: when the load could not verify the
 *     server revision, a save first re-reads; anything that isn't exactly
 *     our adopted baseline is a "conflict", never an overwrite.
 *   - stale-completion guard: an in-flight save resolving after a project
 *     switch stamps nothing into the new project's sync state.
 *   - unmount/pagehide flush: a pending debounced save is sent (keepalive on
 *     unload) so navigation doesn't silently drop the last edit — CAS-
 *     guarded like any other write, and only while the bound project is
 *     still the loaded one.
 */
export function useCanvasFileSync(projectId: string | null) {
  const document = useCanvasBuilderStore((s) => s.document);
  const setDocument = useCanvasBuilderStore((s) => s.setDocument);
  const setSaveState = useCanvasBuilderStore((s) => s.setSaveState);
  const saveState = useCanvasBuilderStore((s) => s.saveState);

  const loadedForRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastSavedRef = useRef<string>("");
  /**
   * CAS baseline: sha256 of the revision we last confirmed persisted for the
   * current project, "absent" when the file was verified missing, or null
   * when the server revision is unverified (read failed at load).
   */
  const lastSavedShaRef = useRef<string | null>(null);
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

      let expectedSha = lastSavedShaRef.current;
      if (expectedSha == null) {
        // Unverified baseline: re-read to learn the server's real revision.
        // A file that is exactly our adopted baseline can be advanced with
        // its learned sha; a confirmed-absent file can be created under the
        // "absent" sentinel; anything else fails closed to "conflict".
        const probe = await readCanvasFile(pid);
        // Stale-completion guard: the project may have switched while the
        // probe was in flight — touch nothing that belongs to the new one.
        if (loadedForRef.current !== pid) return;
        if (probe.status === 404) {
          expectedSha = CAS_ABSENT;
        } else if (probe.status === 200 && probe.content === lastSavedRef.current) {
          expectedSha = probe.sha256;
        } else if (probe.status === 200) {
          setSaveState("conflict");
          return;
        } else {
          // Still unverifiable — not a conflict we can prove, a real failure.
          setSaveState("error");
          return;
        }
      }

      const res = await writeCanvasFile(pid, serialized, {
        expectedSha256: expectedSha ?? undefined,
      });
      // Stale-completion guard after the write: the write itself landed on
      // the right project (the pid is bound in the URL), but only the
      // still-current project may advance its saved markers.
      if (loadedForRef.current !== pid) return;
      if (res.ok) {
        lastSavedRef.current = serialized;
        // A write response without sha256 (older terminal) leaves the
        // revision unverified — the next save re-probes instead of CAS-ing
        // against a stale baseline.
        lastSavedShaRef.current = res.sha256;
        pendingRef.current = null;
        setSaveState("saved");
      } else {
        setSaveState(res.status === 409 ? "conflict" : "error");
      }
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
    lastSavedShaRef.current = null;
    lastAttemptedRef.current = "";

    (async () => {
      let settled: "adopted" | "empty" | "unknown";
      let content: string | null = null;
      let sha256: string | null = null;
      const read = await readCanvasFile(projectId);
      if (cancelled) return;

      if (read.status === 404) {
        settled = "empty";
      } else if (read.status !== 200) {
        settled = "unknown";
      } else if (read.content == null || read.content === "") {
        settled = "empty";
      } else {
        try {
          const parsed = JSON.parse(read.content) as CanvasDocument;
          // Server-wins unconditionally: a valid saved canvas replaces the
          // local document. A fresh (empty/newer-timestamped) local doc must
          // never beat real saved work.
          if (parsed.nodes && parsed.rootNodeIds) {
            content = read.content;
            sha256 = read.sha256;
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

      if (cancelled) return;
      if (settled === "adopted") {
        lastSavedRef.current = content ?? "";
        lastSavedShaRef.current = sha256;
      } else if (settled === "empty") {
        // The server confirmed it holds no canvas. Local work is real user
        // content (project-less building, restored session) — first-sync it
        // into the workspace now that the read has settled.
        lastSavedShaRef.current = CAS_ABSENT;
        const local = useCanvasBuilderStore.getState().document;
        if (hasCanvasContent(local)) {
          loadedForRef.current = projectId;
          void saveToFile(local, projectId);
        } else {
          lastSavedRef.current = JSON.stringify(local);
          // A "saving" state left behind by the previous project's in-flight
          // write would block this project's debounce forever — reset to the
          // truthful local-only state.
          setSaveState("local");
        }
      } else {
        // Server state could not be verified — never auto-write over it.
        // Baseline-adopt the local doc with an unknown sha so any later
        // divergence fails closed to "conflict" at the CAS check.
        lastSavedRef.current = JSON.stringify(
          useCanvasBuilderStore.getState().document,
        );
        setSaveState("error");
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
  // is CAS-guarded like any write — a file changed on the server is never
  // clobbered — and fires only while the bound project is still the loaded
  // one, so teardown can never write a stale document into another project.
  useEffect(() => {
    const flush = (keepalive: boolean) => {
      if (!projectId || loadedForRef.current !== projectId) return;
      const expectedSha = lastSavedShaRef.current;
      // Unverified baseline — we cannot prove this write won't clobber
      // newer server content, so it must not fire. The draft survives in
      // localStorage and reconciles on the next load.
      if (expectedSha == null) return;
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
      void writeCanvasFile(projectId, serialized, {
        keepalive,
        expectedSha256: expectedSha,
      });
    };
    const onPageHide = () => flush(true);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      flush(false);
    };
  }, [projectId]);
}
