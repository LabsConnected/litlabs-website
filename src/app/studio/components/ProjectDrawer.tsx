"use client";

import Link from "next/link";
import { X } from "lucide-react";

interface ProjectDrawerProps {
  open: boolean;
  onClose: () => void;
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
}

/**
 * ProjectDrawer — lightweight slide-in panel for quick project switching.
 *
 * v12 already manages project state via `useStudioProjectStore` and the
 * `ProjectSourceSelector` inside BuilderTool/PluginsTool. This drawer
 * provides a fast keyboard-accessible switcher reachable from the top bar
 * or a keyboard shortcut, without leaving the current tool.
 */
export default function ProjectDrawer({
  open,
  onClose,
  activeProjectId,
  onSelect,
}: ProjectDrawerProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Project switcher"
    >
      <aside
        className="h-full w-[min(360px,88vw)] border-r border-white/10 bg-[#09090f] p-4"
        style={{ backgroundColor: "var(--studio-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-white">Projects</h2>
          <button
            onClick={onClose}
            className="text-white/60 transition hover:text-white"
            aria-label="Close project drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {activeProjectId ? (
          <button
            onClick={() => onSelect(activeProjectId)}
            className="mt-4 w-full rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3 text-left text-xs text-cyan-200 transition hover:border-cyan-400/40"
          >
            Current project &middot; {activeProjectId}
          </button>
        ) : (
          <p className="mt-4 text-xs text-white/50">
            Choose a project to continue building.
          </p>
        )}

        <Link
          href="/projects"
          className="mt-4 inline-flex text-xs font-bold text-cyan-300 transition hover:text-cyan-200"
        >
          Browse all projects &rarr;
        </Link>
      </aside>
    </div>
  );
}
