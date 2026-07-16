"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Search,
  Folder,
  Trash2,
  Loader2,
  ArrowRight,
  GitBranch,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Check,
  Package,
  Zap,
  Cloud,
  Plus,
} from "lucide-react";

/**
 * A GitHub-backed studio project from /api/studio/projects.
 * Mirrors the studio_projects table schema.
 */
type StudioProject = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  github_installation_id: number | null;
  github_repository_id: number | null;
  github_owner: string | null;
  github_repo: string | null;
  github_full_name: string | null;
  github_default_branch: string | null;
  github_branch: string | null;
  latest_commit_sha: string | null;
  framework: string | null;
  package_manager: string | null;
  root_directory: string | null;
  development_command: string | null;
  build_command: string | null;
  test_command: string | null;
  install_command: string | null;
  scan_status: "pending" | "scanning" | "ready" | "failed";
  scan_error: string | null;
  scan_summary: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  last_scanned_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A GitHub installation from /api/github/installations */
type Installation = {
  id: number;
  account: string | null;
  repositorySelection?: string;
};

/** A repository from /api/github/repositories */
type Repo = {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (projectId: string) => void;
  activeProjectId?: string | null;
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ScanStatusBadge({ status }: { status: StudioProject["scan_status"] }) {
  const config = {
    pending: { icon: AlertCircle, color: "text-amber-400", label: "Pending" },
    scanning: { icon: Loader2, color: "text-cyan-400", label: "Scanning" },
    ready: { icon: Check, color: "text-emerald-400", label: "Ready" },
    failed: { icon: AlertCircle, color: "text-rose-400", label: "Failed" },
  };
  const { icon: Icon, color, label } = config[status];
  return (
    <span className={`flex items-center gap-1 text-[10px] font-bold ${color}`}>
      <Icon size={10} className={status === "scanning" ? "animate-spin" : ""} />
      {label}
    </span>
  );
}

export default function ProjectDrawer({
  open,
  onClose,
  onSelect,
  activeProjectId,
}: Props) {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // GitHub import state
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [selectedInstall, setSelectedInstall] = useState<number | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showCreateEmpty, setShowCreateEmpty] = useState(false);
  const [emptyName, setEmptyName] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/projects");
      const text = await res.text();
      let data: { projects?: StudioProject[]; error?: string };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Failed to load projects. Please try again.");
      }
      if (!res.ok) throw new Error(data.error || "Failed to load projects");
      setProjects(data.projects ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInstallations = useCallback(async () => {
    try {
      const res = await fetch("/api/github/installations");
      if (!res.ok) {
        setInstallations([]);
        return;
      }
      const data = await res.json();
      setInstallations(data.installations ?? []);
      if (data.installations?.length > 0 && !selectedInstall) {
        setSelectedInstall(data.installations[0].id);
      }
    } catch {
      setInstallations([]);
    }
  }, [selectedInstall]);

  const fetchRepos = useCallback(async (installId: number) => {
    setLoadingRepos(true);
    setImportError(null);
    try {
      const res = await fetch(
        `/api/github/repositories?installation_id=${installId}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load repositories");
      setRepos(data.repositories ?? []);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Failed to load repositories",
      );
      setRepos([]);
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchProjects();
      void fetchInstallations();
    }
  }, [open, fetchProjects, fetchInstallations]);

  useEffect(() => {
    if (showImport && selectedInstall) {
      void fetchRepos(selectedInstall);
    }
  }, [showImport, selectedInstall, fetchRepos]);

  const handleImportRepo = useCallback(
    async (repo: Repo) => {
      if (!selectedInstall) return;
      setImporting(repo.id.toString());
      setImportError(null);
      try {
        const res = await fetch("/api/studio/projects/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            installation_id: selectedInstall,
            repository_id: repo.id,
            owner: repo.owner,
            repo: repo.name,
            default_branch: repo.defaultBranch,
            branch: repo.defaultBranch,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to import project");
        // Refresh project list
        void fetchProjects();
        setShowImport(false);
        if (data.project?.id) {
          onSelect(data.project.id);
        }
      } catch (err) {
        setImportError(
          err instanceof Error ? err.message : "Failed to import project",
        );
      } finally {
        setImporting(null);
      }
    },
    [selectedInstall, onSelect, fetchProjects],
  );

  const handleCreateEmpty = useCallback(async () => {
    if (!emptyName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const slug = emptyName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      const res = await fetch("/api/studio/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: emptyName.trim(), slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create project");
      void fetchProjects();
      setShowCreateEmpty(false);
      setEmptyName("");
      if (data.project?.id) {
        onSelect(data.project.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }, [emptyName, onSelect, fetchProjects]);

  const handleDelete = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await fetch("/api/studio/projects", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        setProjects((prev) => prev.filter((p) => p.id !== id));
      } catch {
        // non-fatal
      }
    },
    [],
  );

  const handleRescan = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      // Optimistically set scanning
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, scan_status: "scanning" } : p)),
      );
      try {
        await fetch(`/api/studio/projects/${id}/scan`, { method: "POST" });
        // Refresh after a short delay to pick up scan results
        setTimeout(() => void fetchProjects(), 3000);
      } catch {
        // non-fatal
      }
    },
    [fetchProjects],
  );

  const filtered = search.trim()
    ? projects.filter((p) =>
        `${p.github_full_name || p.name}`
          .toLowerCase()
          .includes(search.toLowerCase()),
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

      {/* Drawer */}
      <div className="fixed inset-y-0 left-0 z-100 flex w-full max-w-md flex-col border-r border-white/10 bg-[#0a0a0f] shadow-2xl sm:w-96">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <GitBranch size={16} className="text-cyan-400" />
            <h2 className="text-sm font-black text-white">Projects</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void fetchProjects()}
              aria-label="Refresh"
              className="rounded-md p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white"
            >
              <RefreshCw size={15} />
            </button>
            <button
              onClick={onClose}
              aria-label="Close projects"
              className="rounded-md p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {showImport ? (
          /* ─── GitHub Import View ─── */
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2">
              <button
                onClick={() => setShowImport(false)}
                className="text-xs text-neutral-400 transition hover:text-white"
              >
                ← Back
              </button>
              <span className="text-xs font-bold text-white">
                Import from GitHub
              </span>
            </div>

            {/* Installation selector */}
            {installations.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertCircle size={28} className="text-amber-400" />
                <p className="text-xs text-neutral-400">
                  No GitHub installations found. Install the LiTTree Lab app on
                  your GitHub account to import repositories.
                </p>
                <a
                  href="/api/github/install"
                  className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/20"
                >
                  <GitBranch size={14} />
                  Install GitHub App
                  <ExternalLink size={12} />
                </a>
              </div>
            ) : (
              <>
                <div className="px-4 py-2">
                  <select
                    value={selectedInstall ?? ""}
                    onChange={(e) =>
                      setSelectedInstall(Number(e.target.value))
                    }
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-cyan-500/30"
                  >
                    {installations.map((inst) => (
                      <option key={inst.id} value={inst.id}>
                        {inst.account || `Installation #${inst.id}`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Repo list */}
                <div className="flex-1 overflow-y-auto px-2 pb-4">
                  {loadingRepos ? (
                    <div className="flex items-center justify-center py-8 text-neutral-500">
                      <Loader2 size={20} className="animate-spin" />
                    </div>
                  ) : importError ? (
                    <div className="px-4 py-4 text-center text-xs text-rose-400">
                      {importError}
                    </div>
                  ) : repos.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <Folder size={28} className="mx-auto mb-2 text-neutral-600" />
                      <p className="text-xs text-neutral-500">
                        No repositories accessible to this installation.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {repos.map((repo) => {
                        const alreadyImported = projects.some(
                          (p) => p.github_repository_id === repo.id,
                        );
                        const isImporting = importing === repo.id.toString();
                        return (
                          <button
                            key={repo.id}
                            onClick={() => handleImportRepo(repo)}
                            disabled={!!importing || alreadyImported}
                            className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition disabled:opacity-40 ${
                              alreadyImported
                                ? "border border-emerald-500/20 bg-emerald-500/5"
                                : "border border-transparent hover:bg-white/5"
                            }`}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
                              {isImporting ? (
                                <Loader2 size={14} className="animate-spin text-cyan-400" />
                              ) : (
                                <GitBranch
                                  size={14}
                                  className={
                                    alreadyImported
                                      ? "text-emerald-400"
                                      : "text-neutral-400"
                                  }
                                />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-bold text-neutral-100">
                                {repo.fullName}
                              </div>
                              <div className="truncate text-[10px] text-neutral-500">
                                {repo.defaultBranch}
                                {repo.private && " · private"}
                                {alreadyImported && " · imported"}
                              </div>
                            </div>
                            {alreadyImported ? (
                              <span className="shrink-0 text-[10px] text-emerald-400">
                                <Check size={14} />
                              </span>
                            ) : (
                              <ArrowRight
                                size={14}
                                className="shrink-0 text-neutral-600 transition group-hover:text-cyan-400"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : showCreateEmpty ? (
          /* ─── Create Empty Project View ─── */
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2">
              <button
                onClick={() => setShowCreateEmpty(false)}
                className="text-xs text-neutral-400 transition hover:text-white"
              >
                ← Back
              </button>
              <span className="text-xs font-bold text-white">
                Create Empty Project
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-3 px-4 py-6">
              <label className="text-xs font-bold text-neutral-400">
                Project Name
              </label>
              <input
                type="text"
                value={emptyName}
                onChange={(e) => setEmptyName(e.target.value)}
                placeholder="my-awesome-project"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreateEmpty();
                }}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-cyan-500/30"
              />
              <p className="text-[10px] text-neutral-500">
                Empty projects are not GitHub-backed. You can add a GitHub
                repository later.
              </p>
              <button
                onClick={() => void handleCreateEmpty()}
                disabled={!emptyName.trim() || creating}
                className="flex items-center justify-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-40"
              >
                {creating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                Create Project
              </button>
            </div>
          </div>
        ) : (
          /* ─── Project List View ─── */
          <>
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

            {/* Action buttons */}
            <div className="flex gap-2 px-4 pb-2">
              <button
                onClick={() => setShowImport(true)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/15"
              >
                <GitBranch size={14} />
                Import GitHub Repository
              </button>
              <button
                onClick={() => setShowCreateEmpty(true)}
                className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-neutral-300 transition hover:bg-white/10"
              >
                <Plus size={14} />
                Empty
              </button>
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
                    {search
                      ? "No projects match your search."
                      : "No projects yet. Import a GitHub repository to get started."}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {filtered.map((project) => {
                    const isActive = activeProjectId === project.id;
                    const fullName =
                      project.github_full_name || project.name;
                    const branch =
                      project.github_branch ||
                      project.github_default_branch ||
                      "main";
                    const isGitHub = !!project.github_repository_id;

                    return (
                      <div
                        key={project.id}
                        className={`group rounded-lg border px-3 py-2.5 transition ${
                          isActive
                            ? "border-cyan-500/30 bg-cyan-500/5"
                            : "border-transparent hover:bg-white/5"
                        }`}
                      >
                        <button
                          onClick={() => onSelect(project.id)}
                          className="flex w-full items-center gap-3 text-left"
                        >
                          {/* Icon */}
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
                            {isGitHub ? (
                              <GitBranch size={15} className="text-cyan-400" />
                            ) : (
                              <Folder size={15} className="text-neutral-400" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-neutral-100">
                              {fullName}
                            </div>
                            <div className="flex items-center gap-2 truncate text-[10px] text-neutral-500">
                              {isGitHub && (
                                <span className="flex items-center gap-0.5">
                                  <GitBranch size={9} />
                                  {branch}
                                </span>
                              )}
                              <span>· synced {timeAgo(project.updated_at)}</span>
                            </div>
                          </div>

                          <ArrowRight
                            size={14}
                            className="shrink-0 text-neutral-600 transition group-hover:text-neutral-400"
                          />
                        </button>

                        {/* Metadata row — framework, package manager, scan status */}
                        <div className="mt-2 flex items-center gap-2 pl-12">
                          {project.framework && (
                            <span className="flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-bold text-neutral-300">
                              <Zap size={8} className="text-amber-400" />
                              {project.framework}
                            </span>
                          )}
                          {project.package_manager && (
                            <span className="flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-bold text-neutral-300">
                              <Package size={8} className="text-cyan-400" />
                              {project.package_manager}
                            </span>
                          )}
                          <ScanStatusBadge status={project.scan_status} />
                        </div>

                        {/* Action row — rescan, delete */}
                        <div className="mt-1.5 flex items-center gap-1 pl-12 opacity-0 transition group-hover:opacity-100">
                          {isGitHub && (
                            <button
                              onClick={(e) => handleRescan(project.id, e)}
                              disabled={project.scan_status === "scanning"}
                              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-neutral-500 transition hover:bg-white/10 hover:text-cyan-400 disabled:opacity-40"
                            >
                              <RefreshCw
                                size={9}
                                className={project.scan_status === "scanning" ? "animate-spin" : ""}
                              />
                              Rescan
                            </button>
                          )}
                          {project.github_full_name && (
                            <a
                              href={`https://github.com/${project.github_full_name}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-neutral-500 transition hover:bg-white/10 hover:text-neutral-300"
                            >
                              <ExternalLink size={9} />
                              GitHub
                            </a>
                          )}
                          <button
                            onClick={(e) => handleDelete(project.id, e)}
                            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-neutral-500 transition hover:bg-white/10 hover:text-rose-400"
                          >
                            <Trash2 size={9} />
                            Remove
                          </button>
                        </div>

                        {/* Scan error */}
                        {project.scan_status === "failed" && project.scan_error && (
                          <div className="mt-1.5 pl-12 text-[9px] text-rose-400/70">
                            {project.scan_error}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer — GitHub connection status */}
            <div className="border-t border-white/5 px-4 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Cloud
                    size={12}
                    className={
                      installations.length > 0
                        ? "text-emerald-400"
                        : "text-neutral-600"
                    }
                  />
                  <span className="text-[10px] font-bold text-neutral-400">
                    {installations.length > 0
                      ? `Connected · ${installations.length} installation${installations.length > 1 ? "s" : ""}`
                      : "Not connected"}
                  </span>
                </div>
                {installations.length === 0 && (
                  <a
                    href="/api/github/install"
                    className="text-[10px] font-bold text-cyan-400 transition hover:text-cyan-300"
                  >
                    Connect GitHub →
                  </a>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
