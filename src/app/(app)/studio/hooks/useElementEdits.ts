"use client";

/**
 * useElementEdits — the write path behind the ContextInspector's
 * element editor.
 *
 * Flow: preview selection → resolve the workspace .html file the element
 * lives in → read it once → every inspector edit applies a DOMParser
 * patch and POSTs the full file back. Truthful states only:
 * "resolving" | "ready" | "unavailable" (non-HTML source / no match) |
 * "error" (write failed). No fake controls — when a file cannot be
 * resolved the inspector renders the reason + Ask LiTT.
 *
 * Undo: every applied edit pushes the previous file content onto a
 * stack; undo/redo write that content back through the same audited
 * endpoint. Mutations therefore survive reload (they ARE the file) and
 * are individually reversible within the session.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  applyElementPatch,
  candidateHtmlFiles,
  describePatch,
  locateElement,
  sha256HexUtf8,
  type ElementIdentity,
  type ElementPatch,
} from "../lib/element-edits";

export interface ElementEditRecord {
  filePath: string;
  before: string;
  after: string;
  description: string;
  at: number;
}

export type ElementEditStatus =
  | "idle"
  | "resolving"
  | "ready"
  | "unavailable"
  | "applying"
  | "conflict"
  | "error";

interface FileCache {
  path: string;
  content: string;
}

interface WriteResult {
  ok: boolean;
  /** Server rejected the write because the file changed since our read. */
  conflict?: boolean;
}

async function filesAction(
  projectId: string,
  getToken: () => Promise<string | null>,
  body: Record<string, unknown>,
): Promise<Response> {
  const token = await getToken();
  return fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/files`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

export function useElementEdits(projectId: string | null) {
  const { getToken } = useClerkAuth();
  const [status, setStatus] = useState<ElementEditStatus>("idle");
  const [statusReason, setStatusReason] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [history, setHistory] = useState<ElementEditRecord[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const cacheRef = useRef<FileCache | null>(null);
  const selectionRef = useRef<ElementIdentity | null>(null);
  const routeRef = useRef<string | null | undefined>(undefined);
  // Latest projectId — async continuations from a previous project must
  // never write state for the project the user switched away from.
  const projectRef = useRef(projectId);

  // Project switch: drop every piece of per-project state so nothing
  // (cache, selection, undo history, in-flight writes) bleeds across.
  useEffect(() => {
    projectRef.current = projectId;
    cacheRef.current = null;
    selectionRef.current = null;
    routeRef.current = undefined;
    setStatus("idle");
    setStatusReason(null);
    setFilePath(null);
    setHistory([]);
    setHistoryIndex(-1);
  }, [projectId]);

  const readFile = useCallback(async (path: string): Promise<string | null> => {
    if (!projectId) return null;
    const res = await filesAction(projectId, getToken, { action: "read", path });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { content?: unknown } | null;
    return typeof data?.content === "string" ? data.content : null;
  }, [projectId, getToken]);

  const writeFile = useCallback(async (
    path: string,
    content: string,
    expectedSha256?: string,
  ): Promise<WriteResult> => {
    if (!projectId) return { ok: false };
    const res = await filesAction(projectId, getToken, {
      action: "write",
      path,
      content,
      expectedSha256,
    });
    if (res.status === 409) return { ok: false, conflict: true };
    return { ok: res.ok };
  }, [projectId, getToken]);

  /** Resolve a preview selection to a workspace .html file that uniquely
      contains the element. Safe to call on every selection change. */
  const resolve = useCallback(async (selection: ElementIdentity, route?: string | null) => {
    if (!projectId) {
      setStatus("unavailable");
      setStatusReason("No project is attached — element editing needs a workspace.");
      return;
    }
    selectionRef.current = selection;
    routeRef.current = route;
    setStatus("resolving");
    setStatusReason(null);
    setFilePath(null);
    cacheRef.current = null;

    try {
      const listRes = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/files`);
      if (projectRef.current !== projectId) return;
      if (!listRes.ok) {
        setStatus("unavailable");
        setStatusReason("Workspace file list unavailable.");
        return;
      }
      const listData = (await listRes.json().catch(() => null)) as
        | { entries?: { name?: string; type?: string }[] }
        | null;
      const all = (listData?.entries ?? [])
        .filter((e) => e.type === "file" && typeof e.name === "string")
        .map((e) => e.name as string);

      for (const candidate of candidateHtmlFiles(route, all)) {
        const content = await readFile(candidate);
        if (content == null) continue;
        try {
          const doc = new DOMParser().parseFromString(content, "text/html");
          if (doc.querySelector("parsererror")) continue;
          if (locateElement(doc, selection)) {
            if (projectRef.current !== projectId) return;
            cacheRef.current = { path: candidate, content };
            setFilePath(candidate);
            setStatus("ready");
            setStatusReason(null);
            return;
          }
        } catch {
          continue;
        }
      }
      setStatus("unavailable");
      setStatusReason(
        "This element doesn't map to an HTML file in the project — it may come from a framework template. Use Ask LiTT to change it.",
      );
    } catch {
      setStatus("error");
      setStatusReason("Couldn't reach the workspace to resolve the element.");
    }
  }, [projectId, readFile]);

  const applyPatch = useCallback(async (patch: ElementPatch): Promise<boolean> => {
    const cache = cacheRef.current;
    const sel = selectionRef.current;
    if (!cache || !sel || status === "applying") return false;
    setStatus("applying");
    setStatusReason(null);

    const result = applyElementPatch(cache.content, sel, patch);
    if (!result.ok) {
      setStatus("ready");
      setStatusReason(result.error ?? "Edit could not be applied.");
      return false;
    }
    if (result.changed.length === 0) {
      setStatus("ready");
      return true; // no-op — truthful, nothing written
    }

    // CAS: pin the write to the exact bytes we patched. If the file moved
    // on disk (agent edit, another tab) the server returns 409 and the
    // local edit is preserved as an honest conflict — never a silent
    // overwrite.
    const expectedSha256 = await sha256HexUtf8(cache.content);
    if (projectRef.current !== projectId) return false;
    const saved = await writeFile(cache.path, result.html, expectedSha256);
    if (projectRef.current !== projectId) return false;
    if (saved.conflict) {
      // The cached content is now known-stale: drop it so no later patch
      // is computed against bytes the server no longer has.
      cacheRef.current = null;
      setStatus("conflict");
      setStatusReason(
        "This file changed on disk (an agent edit or another session) after it was loaded. " +
        "Your change was NOT saved — re-select the element to reload the latest version, then try again.",
      );
      return false;
    }
    if (!saved.ok) {
      setStatus("error");
      setStatusReason("The edit didn't reach the workspace file.");
      return false;
    }
    const record: ElementEditRecord = {
      filePath: cache.path,
      before: cache.content,
      after: result.html,
      description: describePatch(patch),
      at: Date.now(),
    };
    cacheRef.current = { path: cache.path, content: result.html };
    setHistory((prev) => [...prev.slice(0, historyIndex + 1), record].slice(-50));
    setHistoryIndex((i) => Math.min(i + 1, 49));
    setStatus("ready");
    // The preview reloads itself on files-changed.
    window.dispatchEvent(
      new CustomEvent("studio:files-changed", { detail: { projectId, source: "element-edit" } }),
    );
    return true;
  }, [projectId, status, writeFile, historyIndex]);

  /** sha256 of the content we believe the file currently holds — the CAS
      precondition for undo/redo writes. */
  const expectedShaFor = useCallback(async (path: string): Promise<string | undefined> => {
    if (cacheRef.current?.path === path) return sha256HexUtf8(cacheRef.current.content);
    for (let i = historyIndex; i >= 0; i--) {
      if (history[i].filePath === path) return sha256HexUtf8(history[i].after);
    }
    return undefined;
  }, [cacheRef, history, historyIndex]);

  const step = useCallback(async (dir: -1 | 1): Promise<boolean> => {
    const target = dir === -1 ? historyIndex : historyIndex + 1;
    const record = history[target];
    if (!record) return false;
    const content = dir === -1 ? record.before : record.after;
    const expectedSha256 = await expectedShaFor(record.filePath);
    if (projectRef.current !== projectId) return false;
    const saved = await writeFile(record.filePath, content, expectedSha256);
    if (projectRef.current !== projectId) return false;
    if (saved.conflict) {
      cacheRef.current = null;
      setStatus("conflict");
      setStatusReason(
        "This file changed on disk since your last edit — undo/redo was NOT applied. " +
        "Re-select the element to reload the latest version.",
      );
      return false;
    }
    if (!saved.ok) return false;
    if (cacheRef.current?.path === record.filePath) {
      cacheRef.current = { path: record.filePath, content };
    }
    setHistoryIndex(target);
    window.dispatchEvent(
      new CustomEvent("studio:files-changed", { detail: { projectId, source: "element-edit" } }),
    );
    return true;
  }, [history, historyIndex, projectId, writeFile, expectedShaFor]);

  return useMemo(() => ({
    status,
    statusReason,
    filePath,
    history,
    historyIndex,
    canUndo: historyIndex >= 0,
    canRedo: historyIndex < history.length - 1,
    resolve,
    applyPatch,
    undo: () => step(-1),
    redo: () => step(1),
    reset: () => {
      setStatus("idle");
      setStatusReason(null);
      setFilePath(null);
      cacheRef.current = null;
      selectionRef.current = null;
      routeRef.current = undefined;
    },
  }), [status, statusReason, filePath, history, historyIndex, resolve, applyPatch, step]);
}
