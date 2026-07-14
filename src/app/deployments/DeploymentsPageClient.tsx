"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import PageShell from "@/components/PageShell";
import {
  Rocket,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertTriangle,
  GitBranch,
  Loader2,
  Folder,
  Lock,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

type Project = {
  id: string;
  owner: string;
  repository: string;
  working_branch: string;
  default_branch: string;
  status: string;
  updated_at?: string;
};

function statusIcon(status: string) {
  if (status === "ready" || status === "online")
    return <CheckCircle2 size={18} style={{ color: "#22c55e" }} />;
  if (status === "building" || status === "starting")
    return (
      <Clock size={18} className="animate-pulse" style={{ color: "#f59e0b" }} />
    );
  if (status === "failed")
    return <AlertTriangle size={18} style={{ color: "#ef4444" }} />;
  return <Clock size={18} style={{ color: "#6b7280" }} />;
}

export default function DeploymentsPageClient() {
  const { resolvedColors: T, tokens } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setLoading(false);  
      return;
    }
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data) => setProjects(data.projects || []))
      .catch((e) =>
        setError(typeof e === "string" ? e : "Failed to load deployments"),
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
            Loading deployments
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
            Sign in to view deployments
          </div>
          <div className="mb-5 text-xs" style={{ color: tokens.textMuted }}>
            Track your project builds and live deploys.
          </div>
          <Link
            href="/sign-in?redirect_url=/deployments"
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
      title="Deployments"
      subtitle="Project builds and live deployment status"
      icon="🚀"
    >
      {/* Header banner */}
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
              <Rocket size={12} /> Deployment tracker
            </div>
            <p
              className="text-sm leading-relaxed max-w-2xl"
              style={{ color: tokens.textMuted }}
            >
              Per-project deploy status is pulled from your connected
              repositories. Connect a GitHub project to see live build and
              deploy status here.
            </p>
          </div>
          <Link
            href="/projects"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition-all hover:opacity-90"
            style={{
              backgroundColor: tokens.primary,
              color: tokens.background,
              boxShadow: `0 0 16px ${tokens.primary}30`,
            }}
          >
            <Folder size={14} /> Manage projects
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12">
            <Loader2
              size={18}
              className="animate-spin"
              style={{ color: tokens.primary }}
            />
            <span className="text-sm" style={{ color: tokens.textMuted }}>
              Loading projects…
            </span>
          </div>
        ) : error ? (
          <div
            className="rounded-2xl border p-4 flex items-center gap-3"
            style={{ borderColor: "#ef444430", backgroundColor: "#ef444408" }}
          >
            <AlertTriangle size={18} style={{ color: "#ef4444" }} />
            <span className="text-sm" style={{ color: tokens.text }}>
              {error}
            </span>
          </div>
        ) : projects.length === 0 ? (
          <div
            className="rounded-2xl border p-10 text-center"
            style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
          >
            <div
              className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: `${tokens.primary}10` }}
            >
              <Rocket size={24} style={{ color: tokens.primary }} />
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
              Connect a GitHub repository to start tracking deployments,
              previews, and production releases.
            </p>
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black"
              style={{
                backgroundColor: tokens.primary,
                color: tokens.background,
              }}
            >
              <GitBranch size={14} /> Connect a repo
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="group rounded-2xl border p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:border-opacity-60"
                style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
              >
                <div className="flex items-center gap-3">
                  <div className="shrink-0">{statusIcon(p.status)}</div>
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
                <div className="flex items-center gap-2">
                  <Link
                    href={`/projects?id=${p.id}`}
                    className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all hover:opacity-80"
                    style={{ borderColor: T.borderColor, color: tokens.text }}
                  >
                    <ExternalLink size={11} /> Mission Control
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
