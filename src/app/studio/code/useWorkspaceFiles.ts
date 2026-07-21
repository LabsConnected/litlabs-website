"use client";

import { useState, useCallback, useEffect } from "react";
import type {
  WorkspaceTreeNode,
  WorkspaceFile,
  OpenEditorFile,
} from "./code-types";
import { languageFromPath } from "./language-from-path";

export function useWorkspaceFiles(workspaceId: string | null) {
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [files, setFiles] = useState<Record<string, OpenEditorFile>>({});
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [savingPaths, setSavingPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refreshTree = useCallback(async () => {
    if (!workspaceId) return;
    setTreeLoading(true);
    try {
      const res = await fetch(
        `/api/studio/workspaces/${workspaceId}/tree?depth=2`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load tree");
      const data = await res.json();
      setTree(data.tree ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tree load failed");
    } finally {
      setTreeLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId) {
      void refreshTree();
    } else {
      setTree([]);
      setFiles({});
      setOpenTabs([]);
      setActivePath(null);
    }
  }, [workspaceId, refreshTree]);

  const openFile = useCallback(
    async (path: string) => {
      if (!workspaceId) return;
      if (files[path]) {
        setActivePath(path);
        setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
        return;
      }

      setLoadingPath(path);
      try {
        const res = await fetch(
          `/api/studio/workspaces/${workspaceId}/file?path=${encodeURIComponent(path)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("Failed to read file");
        const data = await res.json();
        const file: WorkspaceFile = data.file;
        const editorFile: OpenEditorFile = {
          path: file.path,
          content: file.content,
          savedContent: file.content,
          language: languageFromPath(file.path),
          version: file.version,
          dirty: false,
        };
        setFiles((prev) => ({ ...prev, [path]: editorFile }));
        setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
        setActivePath(path);
      } catch (err) {
        setError(err instanceof Error ? err.message : "File open failed");
      } finally {
        setLoadingPath(null);
      }
    },
    [workspaceId, files],
  );

  const updateBuffer = useCallback(
    (path: string, content: string) => {
      setFiles((prev) => {
        const file = prev[path];
        if (!file) return prev;
        return {
          ...prev,
          [path]: { ...file, content, dirty: content !== file.savedContent },
        };
      });
    },
    [],
  );

  const saveFile = useCallback(
    async (path: string) => {
      if (!workspaceId) return;
      const file = files[path];
      if (!file || !file.dirty) return;

      setSavingPaths((prev) => new Set(prev).add(path));
      try {
        const res = await fetch(
          `/api/studio/workspaces/${workspaceId}/file`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path,
              content: file.content,
              expectedVersion: file.version,
            }),
          },
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Save failed");
        }
        const data = await res.json();
        const saved: WorkspaceFile = data.file;
        setFiles((prev) => ({
          ...prev,
          [path]: {
            ...prev[path],
            savedContent: saved.content,
            version: saved.version,
            dirty: false,
          },
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      } finally {
        setSavingPaths((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [workspaceId, files],
  );

  const closeTab = useCallback((path: string) => {
    setOpenTabs((prev) => prev.filter((p) => p !== path));
    setFiles((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setActivePath((prev) => {
      if (prev !== path) return prev;
      const remaining = openTabs.filter((p) => p !== path);
      return remaining[remaining.length - 1] ?? null;
    });
  }, [openTabs]);

  return {
    tree,
    treeLoading,
    files,
    openTabs,
    activePath,
    loadingPath,
    savingPaths,
    error,
    refreshTree,
    openFile,
    updateBuffer,
    saveFile,
    closeTab,
    setActivePath,
  };
}
