"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  AlertCircle,
  Check,
  ChevronDown,
  GitBranch,
  GitPullRequest,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

type Installation = {
  installationId: number;
  setupAction: string | null;
  updatedAt: string;
};

type Repository = {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
};

type Branch = {
  name: string;
  protected: boolean;
  commitSha: string | null;
};

type Project = {
  id: string;
  owner: string;
  repository: string;
  workingBranch: string;
  selectedBranch: string | null;
  status: string;
  connectionStatus: string;
  connectionError: string | null;
  installationId: number;
  repositoryId: number;
  repositoryFullName: string | null;
  repositoryPrivate: boolean | null;
};

export default function GitHubProjectConnection() {
  const { resolvedColors: T, tokens } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();

  const [installations, setInstallations] = useState<Installation[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedInstallation, setSelectedInstallation] = useState<number | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchConnectionState = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    try {
      const res = await fetch("/api/github/connection-state");
      if (!res.ok) throw new Error("Failed to load connection state");
      const data = await res.json();
      setInstallations(data.installations || []);
      setProjects(data.projects || []);
      if (data.installations?.length === 1) {
        setSelectedInstallation(data.installations[0].installationId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    fetchConnectionState();
  }, [fetchConnectionState]);

  // Fetch repositories when an installation is selected
  useEffect(() => {
    if (!selectedInstallation) {
      setRepositories([]);
      return;
    }
    setLoadingRepos(true);
    setError(null);
    fetch(
      `/api/github/repositories?installation_id=${selectedInstallation}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load repositories");
        }
        return res.json();
      })
      .then((data) => setRepositories(data.repositories || []))
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setLoadingRepos(false));
  }, [selectedInstallation]);

  // Fetch branches when a repo is selected
  useEffect(() => {
    if (!selectedRepo || !selectedInstallation) {
      setBranches([]);
      return;
    }
    setLoadingBranches(true);
    setError(null);
    fetch(
      `/api/github/branches?installation_id=${selectedInstallation}&owner=${selectedRepo.owner}&repo=${selectedRepo.name}`,
    )
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load branches");
        }
        return res.json();
      })
      .then((data) => {
        setBranches(data.branches || []);
        setSelectedBranch(selectedRepo.defaultBranch || (data.branches?.[0]?.name ?? ""));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setLoadingBranches(false));
  }, [selectedRepo, selectedInstallation]);

  const createProject = async () => {
    if (!selectedRepo || !selectedInstallation || !selectedBranch) return;
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          github_installation_id: selectedInstallation,
          repository_id: selectedRepo.id,
          owner: selectedRepo.owner,
          repository: selectedRepo.name,
          default_branch: selectedRepo.defaultBranch,
          working_branch: selectedBranch,
          repository_full_name: selectedRepo.fullName,
          repository_html_url: selectedRepo.htmlUrl,
          repository_private: selectedRepo.private,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create project");
      }
      const data = await res.json();
      setProjects((prev) => [data.project, ...prev]);
      setSuccess(`Project ${selectedRepo.fullName} connected on branch ${selectedBranch}`);
      setSelectedRepo(null);
      setSelectedBranch("");
      setBranches([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async (projectId: string) => {
    if (!window.confirm("Remove this project? The GitHub installation will remain.")) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete project");
      }
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  if (!isLoaded || loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs" style={{ color: tokens.textMuted }}>
        <Loader2 size={14} className="animate-spin" /> Loading GitHub connection…
      </div>
    );
  }

  if (installations.length === 0) {
    return (
      <div className="rounded-2xl border p-6 text-center" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
        <GitPullRequest size={28} className="mx-auto mb-3" style={{ color: tokens.primary }} />
        <div className="mb-1 font-black text-sm" style={{ color: tokens.text }}>No GitHub installation</div>
        <p className="mb-4 text-xs leading-relaxed" style={{ color: tokens.textMuted }}>
          Install the LiTTree-LabStudios GitHub App to connect repositories.
        </p>
        <button
          onClick={() => (window.location.href = "/api/github/install")}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black"
          style={{ backgroundColor: tokens.primary, color: tokens.background }}
        >
          <Plus size={12} /> Install GitHub App
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
          <Check size={14} /> {success}
          <button onClick={() => setSuccess(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      {/* Existing projects */}
      {projects.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: tokens.textMuted }}>
            Connected projects
          </div>
          {projects.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-xl border p-3"
              style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
            >
              <div className="flex items-center gap-3">
                <GitBranch size={14} style={{ color: tokens.primary }} />
                <div>
                  <div className="text-xs font-bold" style={{ color: tokens.text }}>
                    {p.repositoryFullName || `${p.owner}/${p.repository}`}
                  </div>
                  <div className="flex items-center gap-2 text-[10px]" style={{ color: tokens.textMuted }}>
                    <span>{p.selectedBranch || p.workingBranch}</span>
                    <span
                      className="rounded-full px-1.5 py-0.5 font-bold"
                      style={{
                        backgroundColor:
                          p.connectionStatus === "connected" ? "#22c55e20" :
                          p.connectionStatus === "error" ? "#ef444420" :
                          `${tokens.primary}15`,
                        color:
                          p.connectionStatus === "connected" ? "#22c55e" :
                          p.connectionStatus === "error" ? "#ef4444" :
                          tokens.primary,
                      }}
                    >
                      {p.connectionStatus}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => deleteProject(p.id)}
                className="rounded-lg p-1.5 text-xs opacity-60 transition hover:opacity-100"
                style={{ color: tokens.textMuted }}
                title="Remove project"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* New project creation */}
      <div className="rounded-2xl border p-4" style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}>
        <div className="mb-3 text-[10px] font-black uppercase tracking-widest" style={{ color: tokens.textMuted }}>
          Connect a repository
        </div>

        {/* Step 1: Select installation */}
        {installations.length > 1 && (
          <div className="mb-3">
            <label className="mb-1 block text-[10px] font-bold" style={{ color: tokens.textMuted }}>GitHub account</label>
            <select
              value={selectedInstallation ?? ""}
              onChange={(e) => {
                setSelectedInstallation(Number(e.target.value));
                setSelectedRepo(null);
              }}
              className="w-full rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: T.borderColor, backgroundColor: tokens.background, color: tokens.text }}
            >
              <option value="">Select account…</option>
              {installations.map((i) => (
                <option key={i.installationId} value={i.installationId}>
                  Installation #{i.installationId}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Step 2: Select repository */}
        {selectedInstallation && (
          <div className="mb-3">
            <label className="mb-1 block text-[10px] font-bold" style={{ color: tokens.textMuted }}>Repository</label>
            {loadingRepos ? (
              <div className="flex items-center gap-2 text-xs" style={{ color: tokens.textMuted }}>
                <Loader2 size={12} className="animate-spin" /> Loading repositories…
              </div>
            ) : repositories.length === 0 ? (
              <div className="text-xs" style={{ color: tokens.textMuted }}>No repositories found. Grant access in GitHub settings.</div>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {repositories.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRepo(r)}
                    className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs transition"
                    style={{
                      borderColor: selectedRepo?.id === r.id ? tokens.primary : T.borderColor,
                      backgroundColor: selectedRepo?.id === r.id ? `${tokens.primary}10` : "transparent",
                      color: tokens.text,
                    }}
                  >
                    <span className="font-bold">{r.fullName}</span>
                    <span className="text-[10px] opacity-60">{r.defaultBranch}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Select branch */}
        {selectedRepo && (
          <div className="mb-4">
            <label className="mb-1 block text-[10px] font-bold" style={{ color: tokens.textMuted }}>Branch</label>
            {loadingBranches ? (
              <div className="flex items-center gap-2 text-xs" style={{ color: tokens.textMuted }}>
                <Loader2 size={12} className="animate-spin" /> Loading branches…
              </div>
            ) : (
              <div className="relative">
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  className="w-full appearance-none rounded-lg border px-3 py-2 pr-8 text-xs"
                  style={{ borderColor: T.borderColor, backgroundColor: tokens.background, color: tokens.text }}
                >
                  {branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}{b.protected ? " (protected)" : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" style={{ color: tokens.textMuted }} />
              </div>
            )}
          </div>
        )}

        {/* Create button */}
        {selectedRepo && selectedBranch && (
          <button
            onClick={createProject}
            disabled={creating}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black transition hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: tokens.primary, color: tokens.background }}
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Connect {selectedRepo.fullName}
          </button>
        )}
      </div>

      {/* Refresh */}
      <button
        onClick={() => {
          setLoading(true);
          fetchConnectionState();
        }}
        className="flex items-center gap-1.5 text-[10px] font-bold"
        style={{ color: tokens.textMuted }}
      >
        <RefreshCw size={10} /> Refresh
      </button>
    </div>
  );
}
