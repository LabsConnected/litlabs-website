"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Plus,
  Search,
  Folder,
  Trash2,
  Loader2,
  ArrowRight,
  GitBranch,
} from "lucide-react";

type Project = {
  id: string;
  name: string;
  files?: string[];
  activeFile?: string;
  createdAt?: number;
  updatedAt?: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (projectId: string) => void;
  activeProjectId?: string | null;
};

export default function ProjectDrawer({
  open,
  onClose,
  onSelect,
  activeProjectId,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/projects");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load projects");
      setProjects(data.projects ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void fetchProjects();
  }, [open, fetchProjects]);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const id = `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();
      const project: Project = {
        id,
        name,
        files: [],
        activeFile: "",
        createdAt: now,
        updatedAt: now,
      };
      const res = await fetch("/api/studio/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create project");
      setProjects((prev) => [project, ...prev]);
      setNewName("");
      onSelect(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }, [newName, onSelect]);

  const handleDelete = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const res = await fetch("/api/studio/projects", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to delete");
        }
        setProjects((prev) => prev.filter((p) => p.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete project");
      }
    },
    [],
  );

  const filtered = search.trim()
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()),
      )
    : projects;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-90 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer — slides from left on desktop, bottom sheet on mobile */}
      <div className="fixed inset-y-0 left-0 z-100 flex w-full max-w-md flex-col border-r border-white/10 bg-[#0a0a0f] shadow-2xl sm:w-96">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h2 className="text-sm font-black text-white">Projects</h2>
          <button
            onClick={onClose}
            aria-label="Close projects"
            className="rounded-md p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-cyan-500/30"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-4 pb-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <Plus size={14} className="text-cyan-400" />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="New project name..."
              className="flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="rounded-md bg-cyan-500/10 px-2 py-1 text-[11px] font-bold text-cyan-400 transition hover:bg-cyan-500/20 disabled:opacity-40"
            >
              {creating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                "Create"
              )}
            </button>
          </div>
          <a
            href="/studio/github"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-300 transition hover:bg-white/10"
          >
            <GitBranch size={14} className="text-neutral-400" />
            <span className="hidden sm:inline">Import</span>
          </a>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-neutral-500">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : error ? (
            <div className="px-4 py-4 text-center text-xs text-rose-400">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Folder size={28} className="mx-auto mb-2 text-neutral-600" />
              <p className="text-xs text-neutral-500">
                {search ? "No projects match your search." : "No projects yet. Create one above."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filtered.map((project) => (
                <button
                  key={project.id}
                  onClick={() => onSelect(project.id)}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                    activeProjectId === project.id
                      ? "border border-cyan-500/30 bg-cyan-500/5"
                      : "border border-transparent hover:bg-white/5"
                  }`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-xs font-bold text-cyan-400">
                    {project.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-neutral-100">
                      {project.name}
                    </div>
                    <div className="truncate text-[10px] text-neutral-500">
                      {project.files?.length ?? 0} files ·{" "}
                      {project.updatedAt
                        ? new Date(project.updatedAt).toLocaleDateString()
                        : "—"}
                    </div>
                  </div>
                  <ArrowRight
                    size={14}
                    className="shrink-0 text-neutral-600 transition group-hover:text-neutral-400"
                  />
                  <button
                    onClick={(e) => handleDelete(project.id, e)}
                    aria-label="Delete project"
                    className="shrink-0 rounded p-1 text-neutral-600 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
