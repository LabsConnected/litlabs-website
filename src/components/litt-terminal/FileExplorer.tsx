"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Folder, FileCode, ChevronRight, ChevronDown, RefreshCw, Plus, Trash2, Loader2 } from "lucide-react";

interface FileNode {
  name: string;
  type: "folder" | "file";
  children?: FileNode[];
  path: string;
  loaded?: boolean;
}

interface FileExplorerProps {
  projectId?: string | null;
  onOpenFile?: (path: string) => void;
}

/**
 * FileExplorer — project-scoped file browser.
 *
 * All file operations route through the authenticated Next.js API:
 *   GET  /api/studio-projects/[projectId]/files?path=...
 *   POST /api/studio-projects/[projectId]/files  { action, path, content? }
 *
 * The browser NEVER talks to terminal-server directly for project files.
 * When projectId is absent, mutations are disabled and a prompt is shown.
 */
export function FileExplorer({ projectId, onOpenFile }: FileExplorerProps) {
  const { getToken } = useClerkAuth();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const hasProject = Boolean(projectId);

  const authHeaders = useCallback(
    async (json = false): Promise<HeadersInit> => {
      const token = await getToken?.();
      return {
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
    },
    [getToken],
  );

  const fetchEntries = useCallback(
    async (path: string): Promise<FileNode[]> => {
      if (!projectId) throw new Error("No project selected");
      const res = await fetch(
        `/api/studio-projects/${projectId}/files?path=${encodeURIComponent(path)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(sanitizeError(data?.error, res.status));
      }
      const data = await res.json();
      if (data.error) throw new Error(sanitizeError(data.error));
      return (data.entries as { name: string; type: "folder" | "file" }[]).map((entry) => ({
        ...entry,
        path: `${path === "." ? "" : path}/${entry.name}`.replace(/^\//, ""),
      }));
    },
    [projectId, authHeaders],
  );

  const loadRoot = useCallback(async () => {
    if (!projectId) {
      setTree([]);
      setError(null);
      return;
    }
    // Abort any in-flight load
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    try {
      const entries = await fetchEntries(".");
      if (ac.signal.aborted) return;
      // Re-expand previously expanded folders
      const expanded = expandedPaths;
      if (expanded.size > 0) {
        const withChildren = await expandPaths(entries, expanded, fetchEntries);
        setTree(withChildren);
      } else {
        setTree(entries);
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [projectId, fetchEntries, expandedPaths]);

  useEffect(() => {
    loadRoot();
    return () => abortRef.current?.abort();
  }, [loadRoot]);

  // Reload when project changes, preserving nothing (fresh tree)
  useEffect(() => {
    setExpandedPaths(new Set());
  }, [projectId]);

  const toggleNode = async (node: FileNode, currentTree: FileNode[]) => {
    if (node.type === "file") {
      onOpenFile?.(node.path);
      return;
    }

    const updateTree = (nodes: FileNode[]): FileNode[] =>
      nodes.map((n) => {
        if (n.path === node.path) {
          if (n.loaded && n.children) {
            return { ...n, children: undefined, loaded: false };
          }
          return { ...n, loaded: true };
        }
        if (n.children) {
          return { ...n, children: updateTree(n.children) };
        }
        return n;
      });

    // Toggle expanded state tracking
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (node.loaded && node.children) {
        next.delete(node.path);
      } else {
        next.add(node.path);
      }
      return next;
    });

    if (node.loaded && node.children) {
      setTree(updateTree(currentTree));
      return;
    }

    try {
      const entries = await fetchEntries(node.path);
      const insertChildren = (nodes: FileNode[]): FileNode[] =>
        nodes.map((n) => {
          if (n.path === node.path) {
            return { ...n, children: entries, loaded: true };
          }
          if (n.children) {
            return { ...n, children: insertChildren(n.children) };
          }
          return n;
        });
      setTree(insertChildren(currentTree));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load folder");
    }
  };

  const createFile = async () => {
    if (!projectId) return;
    if (mutating) return; // Prevent duplicate submission
    const name = prompt("New file name?");
    if (!name) return;
    setMutating(true);
    setError(null);
    try {
      const res = await fetch(`/api/studio-projects/${projectId}/files`, {
        method: "POST",
        headers: await authHeaders(true),
        body: JSON.stringify({ action: "write", path: name, content: "" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(sanitizeError(data?.error, res.status));
      }
      await loadRoot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create file");
    } finally {
      setMutating(false);
    }
  };

  const deleteFile = async (path: string) => {
    if (!projectId) return;
    if (mutating) return; // Prevent duplicate submission
    if (!confirm(`Delete ${path}?`)) return;
    setMutating(true);
    setError(null);
    try {
      const res = await fetch(`/api/studio-projects/${projectId}/files`, {
        method: "POST",
        headers: await authHeaders(true),
        body: JSON.stringify({ action: "delete", path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(sanitizeError(data?.error, res.status));
      }
      await loadRoot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete file");
    } finally {
      setMutating(false);
    }
  };

  function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
    const isFolder = node.type === "folder";
    const open = !!node.children;

    return (
      <div>
        <div
          className="group flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm text-neutral-400 hover:bg-neutral-900 hover:text-white"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <button
            onClick={() => toggleNode(node, tree)}
            className="flex min-w-0 flex-1 items-center gap-2"
            aria-label={isFolder ? `${open ? "Collapse" : "Expand"} folder ${node.name}` : `Open file ${node.name}`}
          >
            {isFolder ? (
              <>
                {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                <Folder className="h-4 w-4 shrink-0 text-orange-400" />
              </>
            ) : (
              <>
                <span className="w-3 shrink-0" />
                <FileCode className="h-4 w-4 shrink-0 text-neutral-500" />
              </>
            )}
            <span className="truncate">{node.name}</span>
          </button>
          {hasProject && (
            <button
              onClick={() => deleteFile(node.path)}
              disabled={mutating}
              className="opacity-0 text-neutral-600 hover:text-red-400 group-hover:opacity-100 disabled:opacity-30"
              aria-label={`Delete ${node.name}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>

        {isFolder && open && node.children?.map((child) => <TreeNode key={child.path} node={child} depth={depth + 1} />)}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-neutral-800 bg-neutral-950 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10px] font-black uppercase tracking-wider text-neutral-500">Files</div>
        <div className="flex gap-1">
          <button
            onClick={loadRoot}
            disabled={loading || !hasProject}
            className="text-neutral-500 hover:text-white disabled:opacity-30"
            aria-label="Refresh file list"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={createFile}
            disabled={!hasProject || mutating}
            className="text-neutral-500 hover:text-white disabled:opacity-30"
            aria-label="Create new file"
          >
            {mutating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {error && <div className="mb-2 text-xs text-red-400">{error}</div>}

      {!hasProject && (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-neutral-600">
          Open or create a project first.
        </div>
      )}

      {hasProject && (
        <div className="flex-1 space-y-1 overflow-y-auto">
          {loading && tree.length === 0 ? (
            <div className="flex items-center justify-center p-4 text-xs text-neutral-600">
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              Loading...
            </div>
          ) : (
            tree.map((node) => <TreeNode key={node.path} node={node} />)
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Recursively expand folders whose paths are in the expanded set.
 * Used to restore expanded state after a refresh.
 */
async function expandPaths(
  nodes: FileNode[],
  expanded: Set<string>,
  fetchEntries: (path: string) => Promise<FileNode[]>,
): Promise<FileNode[]> {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === "folder" && expanded.has(node.path)) {
      try {
        const children = await fetchEntries(node.path);
        const expandedChildren = await expandPaths(children, expanded, fetchEntries);
        result.push({ ...node, children: expandedChildren, loaded: true });
      } catch {
        result.push(node);
      }
    } else {
      result.push(node);
    }
  }
  return result;
}

/**
 * Sanitize error messages for user display.
 * Never expose raw terminal-server errors or internal paths.
 */
function sanitizeError(error: unknown, status?: number): string {
  if (status === 401) return "Your session expired. Please sign in again.";
  if (status === 403) return "You do not have access to this project.";
  if (status === 404) return "Project or file not found.";
  if (status === 503) return "Workspace is not ready yet. Try again in a moment.";
  if (typeof error === "string" && error.length > 0 && error.length < 200) {
    // Strip any potential path leaks
    return error.replace(/\/[a-zA-Z]:\/[^\s]+/g, "[path]");
  }
  return "File operation failed. Please try again.";
}
