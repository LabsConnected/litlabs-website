"use client";

import { useEffect, useState } from "react";
import {
  GitBranch as GitHubIcon,
  Mail,
  Truck,
  Bug,
  Database,
  Container,
  Cloud,
  Server,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ExternalLink,
  AlertCircle,
} from "lucide-react";

type PluginStatus = "disconnected" | "connected" | "loading" | "error";

interface PluginDef {
  id: string;
  label: string;
  icon: typeof GitHubIcon;
  status: PluginStatus;
  description: string;
  connectUrl?: string;
  error?: string;
}

interface GitHubRepo {
  id: number;
  fullName: string;
  name: string;
  owner?: string;
  defaultBranch?: string;
  private: boolean;
  htmlUrl: string;
}

interface GitHubInstallation {
  id: number;
  account: string | null;
  repositorySelection: string;
  repositoriesUrl: string;
}

export default function PluginPanel({ onClose }: { onClose?: () => void }) {
  const [plugins, setPlugins] = useState<PluginDef[]>([
    {
      id: "github",
      label: "GitHub",
      icon: GitHubIcon,
      status: "loading",
      description: "Repos, issues, PRs, and commits.",
      connectUrl: "/api/github/install",
    },
    {
      id: "gmail",
      label: "Gmail",
      icon: Mail,
      status: "disconnected",
      description: "Read and search email.",
    },
    {
      id: "vercel",
      label: "Vercel",
      icon: Truck,
      status: "disconnected",
      description: "Deployments and domains.",
    },
    {
      id: "linear",
      label: "Linear",
      icon: CheckCircle2,
      status: "disconnected",
      description: "Issues and cycles.",
    },
    {
      id: "sentry",
      label: "Sentry",
      icon: Bug,
      status: "disconnected",
      description: "Error tracking and alerts.",
    },
    {
      id: "supabase",
      label: "Supabase",
      icon: Database,
      status: "disconnected",
      description: "Database and auth.",
    },
    {
      id: "docker",
      label: "Docker",
      icon: Container,
      status: "disconnected",
      description: "Containers and images.",
    },
    {
      id: "k8s",
      label: "Kubernetes",
      icon: Cloud,
      status: "disconnected",
      description: "Clusters and workloads.",
    },
    {
      id: "aws",
      label: "AWS",
      icon: Server,
      status: "disconnected",
      description: "Cloud resources.",
    },
  ]);

  const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedInstallation, setSelectedInstallation] = useState<
    number | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/github/installations");
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as {
          installations: GitHubInstallation[];
        };
        if (cancelled) return;
        setInstallations(data.installations || []);
        setPlugins((prev) =>
          prev.map((p) =>
            p.id === "github"
              ? {
                  ...p,
                  status: data.installations?.length
                    ? "connected"
                    : "disconnected",
                  error: undefined,
                }
              : p,
          ),
        );
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "GitHub error";
        setPlugins((prev) =>
          prev.map((p) =>
            p.id === "github" ? { ...p, status: "error", error: message } : p,
          ),
        );
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedInstallation) {
      setRepos([]);
      return;
    }
    let cancelled = false;
    async function loadRepos() {
      try {
        const res = await fetch(
          `/api/github/repositories?installation_id=${selectedInstallation}`,
        );
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { repositories: GitHubRepo[] };
        if (cancelled) return;
        setRepos(data.repositories || []);
      } catch {
        if (cancelled) return;
        setRepos([]);
      }
    }
    void loadRepos();
    return () => {
      cancelled = true;
    };
  }, [selectedInstallation]);

  const githubPlugin = plugins.find((p) => p.id === "github");
  const isConnected = githubPlugin?.status === "connected";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-white/5 bg-[#05050a]/80">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/5 px-4">
        <span className="text-xs font-black uppercase tracking-[0.18em] text-neutral-400">
          Plugin Registry
        </span>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close plugin panel"
            className="text-[10px] text-neutral-500 transition hover:text-neutral-300"
          >
            Close
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4 text-[10px] leading-relaxed text-neutral-500">
          Connect live services so LiTT can read your project state, open
          issues, deploy, and act on your behalf.
        </div>

        <div className="space-y-2">
          {plugins.map((plugin) => {
            const Icon = plugin.icon;
            const active = plugin.id === "github" && isConnected;
            return (
              <div
                key={plugin.id}
                className={`rounded-xl border p-3 transition ${
                  active
                    ? "border-cyan-500/20 bg-cyan-500/5"
                    : "border-white/5 bg-white/2"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      active ? "bg-cyan-500/10" : "bg-white/5"
                    }`}
                  >
                    <Icon
                      size={16}
                      className={active ? "text-cyan-300" : "text-neutral-400"}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-neutral-200">
                        {plugin.label}
                      </span>
                      {plugin.status === "loading" && (
                        <Loader2
                          size={12}
                          className="animate-spin text-neutral-500"
                        />
                      )}
                      {plugin.status === "connected" && (
                        <CheckCircle2 size={12} className="text-emerald-400" />
                      )}
                      {plugin.status === "error" && (
                        <AlertCircle size={12} className="text-rose-400" />
                      )}
                      {plugin.status === "disconnected" && (
                        <XCircle size={12} className="text-neutral-600" />
                      )}
                    </div>
                    <div className="text-[9px] text-neutral-500">
                      {plugin.description}
                    </div>
                    {plugin.error && (
                      <div className="mt-1 text-[9px] text-rose-400">
                        {plugin.error}
                      </div>
                    )}
                  </div>
                  {plugin.id === "github" ? (
                    isConnected ? (
                      <span className="text-[9px] font-bold text-emerald-400">
                        Connected
                      </span>
                    ) : (
                      <a
                        href={plugin.connectUrl || "#"}
                        className="flex shrink-0 items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[9px] text-neutral-300 transition hover:bg-white/10"
                      >
                        Connect <ChevronRight size={10} />
                      </a>
                    )
                  ) : (
                    <span className="text-[9px] text-neutral-600">Soon</span>
                  )}
                </div>

                {plugin.id === "github" && isConnected && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    {installations.length > 1 ? (
                      <div className="mb-2 flex flex-wrap gap-1">
                        {installations.map((inst) => (
                          <button
                            key={inst.id}
                            onClick={() => setSelectedInstallation(inst.id)}
                            className={`rounded-md px-2 py-1 text-[9px] transition ${
                              selectedInstallation === inst.id
                                ? "bg-cyan-500/10 text-cyan-300"
                                : "bg-white/3 text-neutral-400 hover:text-neutral-300"
                            }`}
                          >
                            {inst.account || `Install ${inst.id}`}
                          </button>
                        ))}
                      </div>
                    ) : installations.length === 1 ? (
                      <div className="mb-2 text-[9px] text-neutral-400">
                        Install: {installations[0].account}
                      </div>
                    ) : null}

                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {repos.length === 0 ? (
                        <div className="text-[9px] text-neutral-600">
                          {selectedInstallation
                            ? "No repositories accessible for this installation."
                            : "Select an installation to view repositories."}
                        </div>
                      ) : (
                        repos.map((repo) => (
                          <a
                            key={repo.id}
                            href={repo.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-between rounded-md bg-white/2 px-2 py-1 text-[9px] text-neutral-300 transition hover:bg-white/5"
                          >
                            <span className="truncate">{repo.fullName}</span>
                            <ExternalLink
                              size={10}
                              className="shrink-0 text-neutral-500"
                            />
                          </a>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
