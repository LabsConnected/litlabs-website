"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addFileBlocks,
  archiveCanvas,
  blockToFile,
  createCanvas,
  deleteBlock,
  diffFilesAgainstBlocks,
  fileToBlockInput,
  getCanvasWithBlocks,
  listCanvases,
  patchFileBlock,
  type CanvasFile,
} from "@/lib/canvas/client";
import type { Canvas, CanvasBlock } from "@/lib/canvas/types";

export type { CanvasFile };
export type LoadState = "loading" | "ready" | "error";
export type SaveState = "idle" | "saving" | "saved" | "error";

/** localStorage pointer to the active canvas — a hint only, never the data. */
const CANVAS_ID_KEY = "litlabs:canvas:id";
/** localStorage write-through cache of file data — a supplement, never the source of truth. */
const FILES_CACHE_KEY = "litlabs:canvas:files";

const SAVE_DEBOUNCE_MS = 1200;
const SAVED_INDICATOR_MS = 2500;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — server remains the source of truth */
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function readCachedFiles(): CanvasFile[] | null {
  try {
    const raw = localStorage.getItem(FILES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Array<{
      name?: unknown;
      content?: unknown;
      language?: unknown;
    }>;
    if (!Array.isArray(parsed)) return null;
    const files = parsed.filter(
      (f): f is { name: string; content: string; language: string } =>
        !!f && typeof f.name === "string" && typeof f.content === "string",
    );
    return files.map((f) => ({
      name: f.name,
      content: f.content,
      language: typeof f.language === "string" ? f.language : "text",
    }));
  } catch {
    return null;
  }
}

function writeCachedFiles(files: CanvasFile[]): void {
  safeSet(
    FILES_CACHE_KEY,
    JSON.stringify(
      files.map((f) => ({ name: f.name, content: f.content, language: f.language })),
    ),
  );
}

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/**
 * useCanvasPersistence — Supabase-backed persistence for CanvasTool.
 *
 * The server is the source of truth for generated files (one `file`
 * block per file). On mount the hook resolves the tool's canvas
 * (saved pointer → most-recent active `code` canvas → create), loads
 * its blocks, and thereafter syncs local edits through the API with
 * a debounce. Failures are surfaced honestly via `saveState` /
 * `saveError` / `loadError` — a failed save never reports success.
 *
 * localStorage holds only a canvas-id pointer and a write-through
 * file cache used when the server is unreachable on load.
 */
export function useCanvasPersistence(
  projectId?: string | null,
  opts?: { debounceMs?: number },
) {
  const debounceMs = opts?.debounceMs ?? SAVE_DEBOUNCE_MS;
  const [files, setFilesState] = useState<CanvasFile[]>([]);
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const filesRef = useRef<CanvasFile[]>([]);
  const blocksRef = useRef<CanvasBlock[]>([]);
  const canvasIdRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const mountedRef = useRef(true);
  const projectIdRef = useRef(projectId);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyLoaded = useCallback((canvas: Canvas, blocks: CanvasBlock[]) => {
    canvasIdRef.current = canvas.id;
    blocksRef.current = blocks;
    const loaded = blocks
      .map(blockToFile)
      .filter((f): f is CanvasFile => f !== null);
    filesRef.current = loaded;
    safeSet(CANVAS_ID_KEY, canvas.id);
    writeCachedFiles(loaded);
    readyRef.current = true;
    if (!mountedRef.current) return;
    setCanvasId(canvas.id);
    setFilesState(loaded);
    setLoadState("ready");
    setLoadError(null);
  }, []);

  /** Resolve the tool's canvas, creating it server-side if needed. */
  const ensureCanvas = useCallback(async (excludeIds?: Set<string>): Promise<Canvas> => {
    // 1. Saved pointer (hint only — verified against the server).
    const pointer = safeGet(CANVAS_ID_KEY);
    if (pointer && !excludeIds?.has(pointer)) {
      try {
        const res = await getCanvasWithBlocks(pointer);
        if (res.canvas.status === "active") return res.canvas;
      } catch {
        /* pointer stale — fall through to list */
      }
    }
    // 2. Most-recently-updated active `code` canvas for this context.
    const canvases = await listCanvases({
      projectId: projectIdRef.current ?? undefined,
      status: "active",
    });
    const mine = canvases
      .filter((c) => c.type === "code" && !excludeIds?.has(c.id))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    if (mine) return mine;
    // 3. Create server-side.
    const { canvas } = await createCanvas({
      title: "Canvas",
      projectId: projectIdRef.current ?? null,
    });
    return canvas;
  }, []);

  const loadFromServer = useCallback(async (excludeIds?: Set<string>) => {
    readyRef.current = false;
    canvasIdRef.current = null;
    if (mountedRef.current) {
      setLoadState("loading");
      setLoadError(null);
    }
    try {
      const canvas = await ensureCanvas(excludeIds);
      const { blocks } = await getCanvasWithBlocks(canvas.id);
      applyLoaded(canvas, blocks);
    } catch (err) {
      if (!mountedRef.current) return;
      // Graceful degradation: serve the write-through cache, honestly labeled.
      const cached = readCachedFiles();
      if (cached && cached.length > 0) {
        filesRef.current = cached;
        setFilesState(cached);
        setLoadError(
          "Couldn't reach the canvas server — showing your last synced copy. " +
            "Edits will sync when the connection is back.",
        );
      } else {
        setLoadError(toErrorMessage(err, "Couldn't load your canvas."));
      }
      setLoadState("error");
    }
  }, [ensureCanvas, applyLoaded]);

  // Mount: load once. projectId is intentionally captured at mount so
  // switching projects mid-session doesn't yank the canvas away.
  useEffect(() => {
    mountedRef.current = true;
    void loadFromServer();
    return () => {
      mountedRef.current = false;
      if (syncTimer.current) clearTimeout(syncTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, [loadFromServer]);

  const markSaved = useCallback(() => {
    if (!mountedRef.current) return;
    setSaveState("saved");
    setSaveError(null);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => {
      if (mountedRef.current) setSaveState("idle");
    }, SAVED_INDICATOR_MS);
  }, []);

  /** Push the current file list to the server (diffed against last-known blocks). */
  const syncNow = useCallback(async () => {
    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
      syncTimer.current = null;
    }
    let cid = canvasIdRef.current;
    if (!cid) {
      try {
        cid = (await ensureCanvas()).id;
      } catch (err) {
        if (!mountedRef.current) return;
        setSaveState("error");
        setSaveError(toErrorMessage(err, "No canvas available — changes are not saved."));
        return;
      }
    }

    const diff = diffFilesAgainstBlocks(filesRef.current, blocksRef.current);
    if (diff.toAdd.length === 0 && diff.toUpdate.length === 0 && diff.toDelete.length === 0) {
      return;
    }

    if (mountedRef.current) {
      setSaveState("saving");
      setSaveError(null);
    }
    try {
      for (const blockId of diff.toDelete) {
        await deleteBlock(cid, blockId);
      }
      for (const u of diff.toUpdate) {
        await patchFileBlock(cid, u.blockId, u.file);
      }
      if (diff.toAdd.length > 0) {
        await addFileBlocks(
          cid,
          diff.toAdd.map((a) => fileToBlockInput(a.file, a.position)),
        );
      }
      // Re-read server state so block ids/positions stay consistent.
      const { blocks } = await getCanvasWithBlocks(cid);
      if (!mountedRef.current) return;
      blocksRef.current = blocks;
      const byPath = new Map<string, string>();
      for (const b of blocks) {
        if (b.type !== "file") continue;
        const p = (b.content as { path?: unknown } | null | undefined)?.path;
        if (typeof p === "string" && !byPath.has(p)) byPath.set(p, b.id);
      }
      const withIds = filesRef.current.map((f) => ({
        ...f,
        blockId: byPath.get(f.name),
      }));
      filesRef.current = withIds;
      setFilesState(withIds);
      writeCachedFiles(withIds);
      markSaved();
    } catch (err) {
      if (!mountedRef.current) return;
      // Honest failure: keep the local edits, report that they are NOT saved.
      setSaveState("error");
      setSaveError(toErrorMessage(err, "Failed to save canvas."));
    }
  }, [ensureCanvas, markSaved]);

  const scheduleSync = useCallback(() => {
    if (!readyRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      void syncNow();
    }, debounceMs);
  }, [syncNow, debounceMs]);

  /**
   * Single mutation path for the file list. Derives the next state from
   * the ref (never a side effect inside a setState updater) and then
   * schedules the debounced server sync.
   */
  const setFiles = useCallback(
    (updater: React.SetStateAction<CanvasFile[]>) => {
      const next =
        typeof updater === "function"
          ? (updater as (prev: CanvasFile[]) => CanvasFile[])(filesRef.current)
          : updater;
      filesRef.current = next;
      setFilesState(next);
      scheduleSync();
    },
    [scheduleSync],
  );

  /** Archive the current canvas and start a fresh one (history preserved). */
  const resetCanvas = useCallback(async () => {
    const oldId = canvasIdRef.current;
    filesRef.current = [];
    blocksRef.current = [];
    readyRef.current = false;
    canvasIdRef.current = null;
    if (mountedRef.current) {
      setFilesState([]);
      setCanvasId(null);
      setLoadState("loading");
      setLoadError(null);
      setSaveState("idle");
      setSaveError(null);
    }
    if (oldId) {
      // Best-effort: the fresh canvas is what matters for UX. The old id is
      // excluded from lookup so a slow archive can't be re-adopted.
      archiveCanvas(oldId).catch(() => {});
    }
    safeRemove(CANVAS_ID_KEY);
    writeCachedFiles([]);
    await loadFromServer(oldId ? new Set([oldId]) : undefined);
  }, [loadFromServer]);

  const retrySave = useCallback(() => {
    void syncNow();
  }, [syncNow]);

  const retryLoad = useCallback(() => {
    void loadFromServer();
  }, [loadFromServer]);

  return {
    files,
    setFiles,
    canvasId,
    loadState,
    loadError,
    saveState,
    saveError,
    retrySave,
    retryLoad,
    resetCanvas,
  };
}
