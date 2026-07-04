"use client";

import { useState } from "react";
import { Folder, FileCode, ChevronRight, ChevronDown } from "lucide-react";

interface FileNode {
  name: string;
  type: "folder" | "file";
  children?: FileNode[];
}

const fileTree: FileNode[] = [
  {
    name: "app",
    type: "folder",
    children: [
      {
        name: "jarvis-terminal",
        type: "folder",
        children: [{ name: "page.tsx", type: "file" }],
      },
      {
        name: "api",
        type: "folder",
        children: [
          {
            name: "jarvis",
            type: "folder",
            children: [{ name: "command", type: "folder", children: [{ name: "route.ts", type: "file" }] }],
          },
        ],
      },
    ],
  },
  {
    name: "components",
    type: "folder",
    children: [
      { name: "jarvis-terminal", type: "folder", children: [{ name: "TerminalPanel.tsx", type: "file" }] },
    ],
  },
  { name: "lib", type: "folder", children: [{ name: "terminal-client.ts", type: "file" }] },
  { name: "terminal-server", type: "folder", children: [{ name: "server.ts", type: "file" }] },
  { name: "package.json", type: "file" },
  { name: "docker", type: "folder", children: [{ name: "Dockerfile.terminal", type: "file" }] },
];

function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const isFolder = node.type === "folder";

  return (
    <div>
      <button
        onClick={() => isFolder && setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-neutral-400 hover:bg-neutral-900 hover:text-white"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {isFolder ? (
          <>
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Folder className="h-4 w-4 text-orange-400" />
          </>
        ) : (
          <>
            <span className="w-3" />
            <FileCode className="h-4 w-4 text-neutral-500" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>

      {isFolder && open && node.children?.map((child) => <TreeNode key={child.name} node={child} depth={depth + 1} />)}
    </div>
  );
}

export function FileExplorer() {
  return (
    <div className="h-full rounded-xl border border-neutral-800 bg-neutral-950 p-3">
      <div className="mb-3 text-[10px] font-black uppercase tracking-wider text-neutral-500">
        Files
      </div>

      <div className="space-y-1">
        {fileTree.map((node) => (
          <TreeNode key={node.name} node={node} />
        ))}
      </div>
    </div>
  );
}
