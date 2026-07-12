"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import {
  GitPullRequest,
  ExternalLink,
  Plus,
  Loader2,
  Folder,
  GitBranch,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";

export default function ProjectsPageClient() {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  interface Project {
    id: string;
    owner: string;
    repository: string;
    working_branch: string;
    status: string;
  }
  interface Installation {
    id: number;
    account: string | null;
  }
  const [projects, setProjects] = useState<Project[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/github/installations").then((r) => r.json()),
    ])
      .then(([projectsData, installationsData]) => {
        setProjects(projectsData.projects || []);
        setInstallations(installationsData.installations || []);
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Failed to load projects",
        );
      })
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: T.bgColor }}
      >
        <div className="text-center">
          <div className="text-2xl mb-2 animate-pulse">🚀</div>
          <div>Loading projects...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <PageShell title="Sign In">
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
          <p className="text-sm opacity-60">
            Please sign in to manage projects.
          </p>
          <Link
            href="/sign-in?redirect_url=/projects"
            className="px-4 py-2 rounded-lg text-sm font-bold"
            style={{ backgroundColor: "#6366f1", color: "#fff" }}
          >
            Sign In
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Projects"
      subtitle="GitHub-backed development workspaces"
      icon="🚀"
    >
      <div className="px-4 sm:px-6 pt-4">
        <div
          className="rounded-3xl border p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          style={{
            background:
              "linear-gradient(135deg, rgba(34,211,238,0.12), rgba(59,130,246,0.08))",
            borderColor: `${T.borderColor}30`,
          }}
        >
          <div>
            <div
              className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] mb-1"
              style={{ color: T.accentColor }}
            >
              <GitPullRequest size={12} /> GitHub connection
            </div>
            <p className="text-sm opacity-75 max-w-2xl">
              Connect a GitHub repository to create a real, isolated workspace.
              LiTT uses a GitHub App so you choose exactly which repos to
              access.
            </p>
          </div>
          <a
            href="/api/github/install"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            <Plus size={14} /> Connect GitHub
          </a>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm opacity-60">Loading workspaces...</span>
          </div>
        ) : error ? (
          <div
            className="rounded-2xl border p-4 flex items-center gap-3"
            style={{ borderColor: "#ef444440", backgroundColor: "#ef444410" }}
          >
            <AlertCircle size={18} style={{ color: "#ef4444" }} />
            <span className="text-sm">{error}</span>
          </div>
        ) : (
          <div className="space-y-4">
            {projects.length === 0 ? (
              <div
                className="rounded-2xl border p-8 text-center"
                style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
              >
                <div className="text-4xl mb-3">🚀</div>
                <p className="font-bold mb-1" style={{ color: T.headerColor }}>
                  No projects yet
                </p>
                <p className="text-sm opacity-60 mb-4">
                  Connect a GitHub repository to start building in a real
                  workspace.
                </p>
                <a
                  href="/api/github/install"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold"
                  style={{ backgroundColor: T.accentColor, color: T.bgColor }}
                >
                  <GitPullRequest size={14} /> Connect GitHub
                </a>
              </div>
            ) : (
              projects.map((p) => (
                <div
                  key={String(p.id)}
                  className="rounded-2xl border p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  style={{
                    backgroundColor: T.boxBg,
                    borderColor: T.borderColor,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: T.accentColor + "20" }}
                    >
                      <Folder size={18} style={{ color: T.accentColor }} />
                    </div>
                    <div>
                      <div
                        className="font-bold text-sm"
                        style={{ color: T.headerColor }}
                      >
                        {p.owner}/{p.repository}
                      </div>
                      <div className="text-[10px] opacity-60 flex items-center gap-2">
                        <GitBranch size={10} /> {p.working_branch} • {p.status}
                      </div>
                    </div>
                  </div>
                  <Link
                    href={`/projects/${p.id}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border"
                    style={{ borderColor: T.borderColor, color: T.textColor }}
                  >
                    <ExternalLink size={12} /> Open Mission Control
                  </Link>
                </div>
              ))
            )}

            {installations.length > 0 && (
              <div className="mt-8">
                <div className="text-xs font-black uppercase tracking-widest opacity-60 mb-3">
                  Connected GitHub accounts
                </div>
                <div className="flex flex-wrap gap-2">
                  {installations.map((i) => (
                    <div
                      key={String(i.id)}
                      className="px-3 py-1.5 rounded-lg border text-xs font-bold"
                      style={{ borderColor: T.borderColor, color: T.textColor }}
                    >
                      <GitBranch size={10} className="inline mr-1.5" />
                      {i.account ?? `Installation ${i.id}`}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}
