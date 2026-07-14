"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppUser } from "@/hooks/useClerkAuth";
import { Folder, FileCode, ChevronRight, ChevronDown, RefreshCw, Plus, Trash2 } from "lucide-react";

interface FileNode {
  name: string;
  type: "folder" | "file";
  children?: FileNode[];
  path: string;
  loaded?: boolean;
}

interface FileExplorerProps {
  onOpenFile?: (path: string) => void;
}

export function FileExplorer({ onOpenFile }: FileExplorerProps) {
  const { user } = useAppUser();
  const userId = user?.id ?? "anonymous";
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsUrl = process.env.NEXT_PUBLIC_TERMINAL_WS_URL || "http://localhost:4001";

  const fetchEntries = useCallback(
    async (path: string) => {
      const res = await fetch(`${wsUrl}/files?userId=${encodeURIComponent(userId)}&path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return (data.entries as { name: string; type: "folder" | "file" }[]).map((entry) => ({
        ...entry,
        path: `${path === "." ? "" : path}/${entry.name}`.replace(/^\//, ""),
      }));
    },
    [userId, wsUrl]
  );

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const entries = await fetchEntries(".");
      setTree(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [fetchEntries]);

  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

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
    const name = prompt("New file name?");
    if (!name) return;
    try {
      const res = await fetch(`${wsUrl}/files/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, path: name, content: "" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      loadRoot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create file");
    }
  };

  const deleteFile = async (path: string) => {
    if (!confirm(`Delete ${path}?`)) return;
    try {
      const res = await fetch(`${wsUrl}/files/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, path }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      loadRoot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete file");
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
          <button
            onClick={() => deleteFile(node.path)}
            className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
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
          <button onClick={loadRoot} disabled={loading} className="text-neutral-500 hover:text-white disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={createFile} className="text-neutral-500 hover:text-white">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error && <div className="mb-2 text-xs text-red-400">{error}</div>}

      <div className="flex-1 space-y-1 overflow-y-auto">
        {tree.map((node) => (
          <TreeNode key={node.path} node={node} />
        ))}
      </div>
    </div>
  );
}
