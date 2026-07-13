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
  Lock,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

type Project = {
  id: string;
  owner: string;
  repository: string;
  working_branch: string;
  status: string;
};

type Installation = {
  id: number;
  account: string | null;
};

export default function ProjectsPageClient() {
  const { resolvedColors: T, tokens } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setLoading(false); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    const safeJson = async (r: Response) => {
      const text = await r.text();
      try {
        return JSON.parse(text);
      } catch {
        return {
          error: text.slice(0, 200) || `Unexpected response (${r.status})`,
        };
      }
    };
    Promise.all([
      fetch("/api/projects")
        .then(safeJson)
        .catch(() => ({ projects: [] })),
      fetch("/api/github/installations")
        .then(safeJson)
        .catch(() => ({ installations: [] })),
    ])
      .then(([projectsData, installationsData]) => {
        setProjects(projectsData.projects || []);
        setInstallations(installationsData.installations || []);
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load projects",
        ),
      )
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) {
    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden"
        style={{ backgroundColor: tokens.background }}
      >
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[80px] opacity-20"
            style={{ backgroundColor: tokens.primary }}
          />
        </div>
        <div className="relative flex flex-col items-center gap-3">
          <Loader2
            size={24}
            className="animate-spin"
            style={{ color: tokens.primary }}
          />
          <span
            className="text-xs font-black uppercase tracking-widest"
            style={{ color: tokens.textMuted }}
          >
            Loading projects
          </span>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
        style={{ backgroundColor: tokens.background }}
      >
        <div
          className="relative max-w-sm w-full rounded-2xl border p-8 text-center"
          style={{
            backgroundColor: tokens.surface,
            borderColor: `${tokens.primary}20`,
          }}
        >
          <div
            className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{
              backgroundColor: `${tokens.primary}12`,
              boxShadow: `0 0 24px ${tokens.primary}20`,
            }}
          >
            <Lock size={24} style={{ color: tokens.primary }} />
          </div>
          <div
            className="mb-1 text-base font-black"
            style={{ color: tokens.text }}
          >
            Sign in to manage projects
          </div>
          <div
            className="mb-5 text-xs leading-relaxed"
            style={{ color: tokens.textMuted }}
          >
            Connect GitHub repositories and manage your development workspaces.
          </div>
          <Link
            href="/sign-in?redirect_url=/projects"
            className="flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-black text-black"
            style={{
              backgroundColor: tokens.primary,
              boxShadow: `0 0 16px ${tokens.primary}30`,
            }}
          >
            <Sparkles size={14} /> Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Projects"
      subtitle="GitHub-backed development workspaces"
      icon="🚀"
    >
      {/* GitHub connect banner */}
      <div className="px-4 sm:px-6 pt-4">
        <div
          className="rounded-2xl border p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          style={{
            background: `linear-gradient(135deg, ${tokens.primary}12, ${tokens.primary}06)`,
            borderColor: `${tokens.primary}25`,
          }}
        >
          <div>
            <div
              className="flex items-center gap-2 text-xs font-black uppercase tracking-widest mb-1"
              style={{ color: tokens.primary }}
            >
              <GitPullRequest size={12} /> GitHub connection
            </div>
            <p
              className="text-sm leading-relaxed max-w-2xl"
              style={{ color: tokens.textMuted }}
            >
              Connect a GitHub repository to create a real, isolated workspace.
              LiTT uses a GitHub App — you choose exactly which repos to access.
            </p>
          </div>
          <Link
            href="/settings?tab=integrations"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition-all hover:opacity-90"
            style={{
              backgroundColor: tokens.primary,
              color: tokens.background,
              boxShadow: `0 0 16px ${tokens.primary}30`,
            }}
          >
            <Plus size={14} /> Connect GitHub
          </Link>
        </div>
      </div>

      {/* Projects list */}
      <div className="px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12">
            <Loader2
              size={18}
              className="animate-spin"
              style={{ color: tokens.primary }}
            />
            <span className="text-sm" style={{ color: tokens.textMuted }}>
              Loading workspaces…
            </span>
          </div>
        ) : error ? (
          <div
            className="rounded-2xl border p-4 flex items-center gap-3"
            style={{ borderColor: "#ef444430", backgroundColor: "#ef444408" }}
          >
            <AlertCircle size={18} style={{ color: "#ef4444" }} />
            <span className="text-sm" style={{ color: tokens.text }}>
              {error}
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.length === 0 ? (
              <div
                className="rounded-2xl border p-10 text-center"
                style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
              >
                <div
                  className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: `${tokens.primary}10` }}
                >
                  <Folder size={24} style={{ color: tokens.primary }} />
                </div>
                <div
                  className="mb-1 font-black text-sm"
                  style={{ color: tokens.text }}
                >
                  No projects yet
                </div>
                <p
                  className="text-xs mb-5 max-w-xs mx-auto leading-relaxed"
                  style={{ color: tokens.textMuted }}
                >
                  Connect a GitHub repository to start building in a real,
                  isolated workspace.
                </p>
                <Link
                  href="/settings?tab=integrations"
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black"
                  style={{
                    backgroundColor: tokens.primary,
                    color: tokens.background,
                  }}
                >
                  <GitPullRequest size={14} /> Connect GitHub
                </Link>
              </div>
            ) : (
              projects.map((p) => (
                <div
                  key={String(p.id)}
                  className="rounded-2xl border p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:border-opacity-60"
                  style={{
                    backgroundColor: T.boxBg,
                    borderColor: T.borderColor,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-xl flex shrink-0 items-center justify-center"
                      style={{
                        backgroundColor: `${tokens.primary}15`,
                        boxShadow: `0 0 12px ${tokens.primary}15`,
                      }}
                    >
                      <Folder size={17} style={{ color: tokens.primary }} />
                    </div>
                    <div>
                      <div
                        className="font-black text-sm"
                        style={{ color: tokens.text }}
                      >
                        {p.owner}/{p.repository}
                      </div>
                      <div
                        className="flex items-center gap-2 text-[10px] mt-0.5"
                        style={{ color: tokens.textMuted }}
                      >
                        <GitBranch size={10} />
                        <span>{p.working_branch}</span>
                        <span>·</span>
                        <span
                          className="rounded-full px-1.5 py-0.5 font-bold"
                          style={{
                            backgroundColor:
                              p.status === "ready" || p.status === "online"
                                ? "#22c55e20"
                                : p.status === "failed"
                                  ? "#ef444420"
                                  : `${tokens.primary}15`,
                            color:
                              p.status === "ready" || p.status === "online"
                                ? "#22c55e"
                                : p.status === "failed"
                                  ? "#ef4444"
                                  : tokens.primary,
                          }}
                        >
                          {p.status}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Link
                    href={`/projects?id=${p.id}`}
                    className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all hover:opacity-80"
                    style={{ borderColor: T.borderColor, color: tokens.text }}
                  >
                    <ExternalLink size={11} /> Open Mission Control
                  </Link>
                </div>
              ))
            )}

            {/* Connected GitHub accounts */}
            {installations.length > 0 && (
              <div className="mt-8">
                <div
                  className="text-[10px] font-black uppercase tracking-widest mb-3"
                  style={{ color: tokens.textMuted }}
                >
                  Connected GitHub accounts
                </div>
                <div className="flex flex-wrap gap-2">
                  {installations.map((i) => (
                    <div
                      key={String(i.id)}
                      className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold"
                      style={{
                        borderColor: `${tokens.primary}25`,
                        color: tokens.text,
                        backgroundColor: `${tokens.primary}08`,
                      }}
                    >
                      <GitBranch size={10} style={{ color: tokens.primary }} />
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
