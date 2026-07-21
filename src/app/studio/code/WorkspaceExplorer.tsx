"use client";

import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, FileCode2, Folder, FolderOpen, RefreshCw, Search } from "lucide-react";
import type { WorkspaceTreeNode } from "./code-types";

interface WorkspaceExplorerProps {
  tree: WorkspaceTreeNode[];
  loading: boolean;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onRefresh: () => void;
  onSearch?: () => void;
}

function TreeNode({
  node,
  depth,
  activePath,
  onOpenFile,
}: {
  node: WorkspaceTreeNode;
  depth: number;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (node.type === "folder") {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-white/5"
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          {expanded ? <ChevronDown size={11} className="shrink-0 opacity-50" /> : <ChevronRight size={11} className="shrink-0 opacity-50" />}
          {expanded ? <FolderOpen size={12} className="shrink-0 text-cyan-300/60" /> : <Folder size={12} className="shrink-0 text-cyan-300/60" />}
          <span className="truncate text-white/70">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onOpenFile(node.path)}
      className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-white/5"
      style={{
        paddingLeft: depth * 12 + 20,
        backgroundColor: activePath === node.path ? "rgba(145,71,255,0.12)" : undefined,
        color: activePath === node.path ? "#c4b5fd" : undefined,
      }}
    >
      <FileCode2 size={11} className="shrink-0 opacity-50" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export default function WorkspaceExplorer({
  tree,
  loading,
  activePath,
  onOpenFile,
  onRefresh,
  onSearch,
}: WorkspaceExplorerProps) {
  const flatTree = useMemo(() => tree, [tree]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-2 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[.16em] text-white/55">
          Explorer
        </span>
        <div className="flex gap-1">
          {onSearch && (
            <button
              onClick={onSearch}
              className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
              title="Search files"
            >
              <Search size={12} />
            </button>
          )}
          <button
            onClick={onRefresh}
            className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
            title="Refresh"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading && tree.length === 0 ? (
          <p className="px-3 py-4 text-center text-[10px] text-white/40">Loading files…</p>
        ) : tree.length === 0 ? (
          <p className="px-3 py-4 text-center text-[10px] text-white/40">No files</p>
        ) : (
          flatTree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              activePath={activePath}
              onOpenFile={onOpenFile}
            />
          ))
        )}
      </div>
    </div>
  );
}
