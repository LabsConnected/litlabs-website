"use client";

import { X } from "lucide-react";
import type { OpenEditorFile } from "./code-types";

interface EditorTabsProps {
  openTabs: string[];
  activePath: string | null;
  files: Record<string, OpenEditorFile>;
  savingPaths: Set<string>;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export default function EditorTabs({
  openTabs,
  activePath,
  files,
  savingPaths,
  onSelect,
  onClose,
}: EditorTabsProps) {
  if (openTabs.length === 0) return null;

  return (
    <div className="flex items-center overflow-x-auto border-b border-white/10 bg-black/20">
      {openTabs.map((path) => {
        const file = files[path];
        const isActive = path === activePath;
        const isDirty = file?.dirty;
        const isSaving = savingPaths.has(path);
        return (
          <div
            key={path}
            onClick={() => onSelect(path)}
            className="group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-white/10 px-3 py-1.5 text-[11px] transition-colors"
            style={{
              backgroundColor: isActive ? "rgba(145,71,255,0.10)" : "transparent",
              color: isActive ? "#c4b5fd" : "rgba(255,255,255,0.55)",
            }}
          >
            <span className="truncate max-w-[140px]">{basename(path)}</span>
            {isSaving ? (
              <span className="text-[9px] text-cyan-300">saving…</span>
            ) : isDirty ? (
              <span className="text-[10px] text-amber-400">●</span>
            ) : null}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(path);
              }}
              className="ml-1 rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-60"
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
