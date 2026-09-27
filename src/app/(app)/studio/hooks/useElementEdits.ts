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

import { useCallback, useMemo, useRef, useState } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  applyElementPatch,
  candidateHtmlFiles,
  describePatch,
  locateElement,
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
  | "error";

interface FileCache {
  path: string;
  content: string;
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

  const readFile = useCallback(async (path: string): Promise<string | null> => {
    if (!projectId) return null;
    const res = await filesAction(projectId, getToken, { action: "read", path });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { content?: unknown } | null;
    return typeof data?.content === "string" ? data.content : null;
  }, [projectId, getToken]);

  const writeFile = useCallback(async (path: string, content: string): Promise<boolean> => {
    if (!projectId) return false;
    const res = await filesAction(projectId, getToken, { action: "write", path, content });
    return res.ok;
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
    setStatus("resolving");
    setStatusReason(null);
    setFilePath(null);
    cacheRef.current = null;

    try {
      const listRes = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/files`);
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

    const saved = await writeFile(cache.path, result.html);
    if (!saved) {
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

  const step = useCallback(async (dir: -1 | 1): Promise<boolean> => {
    const target = dir === -1 ? historyIndex : historyIndex + 1;
    const record = history[target];
    if (!record) return false;
    const content = dir === -1 ? record.before : record.after;
    const ok = await writeFile(record.filePath, content);
    if (!ok) return false;
    if (cacheRef.current?.path === record.filePath) {
      cacheRef.current = { path: record.filePath, content };
    }
    setHistoryIndex(target);
    window.dispatchEvent(
      new CustomEvent("studio:files-changed", { detail: { projectId, source: "element-edit" } }),
    );
    return true;
  }, [history, historyIndex, projectId, writeFile]);

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
    },
  }), [status, statusReason, filePath, history, historyIndex, resolve, applyPatch, step]);
}
