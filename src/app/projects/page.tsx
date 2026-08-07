"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import { useTheme } from "@/context/ThemeContext";
import {
  ArrowRight,
  Bot,
  Code2,
  ExternalLink,
  FileText,
  FolderKanban,
  GitBranch,
  Image,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";

const QUICK_ACTIONS = [
  {
    label: "Continue in Studio",
    description: "Chat with LiTT, create media, and run a focused mission.",
    href: "/studio",
    icon: Sparkles,
  },
  {
    label: "Open code workspace",
    description: "Inspect files, scan code, and prepare a verified change.",
    href: "/code",
    icon: Code2,
  },
  {
    label: "Mission Forge",
    description: "Build reusable Missions by connecting LiTT, Spark, tools, approvals, and outputs.",
    href: "/studio?tool=workflows",
    icon: Bot,
  },
  {
    label: "Review artifacts",
    description: "Find images, previews, and saved outputs in one place.",
    href: "/gallery",
    icon: Image,
  },
];

type Project = {
  id: string;
  name: string;
  repository?: string | null;
  status?: string | null;
  updated_at?: string | null;
};

export default function ProjectsPage() {
  const { resolvedColors: T } = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fetchProjects = useMemo(() => {
    const controller = new AbortController();
    return async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/projects", { signal: controller.signal, cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to load projects");
        setProjects(Array.isArray(data.projects) ? data.projects : []);
      } catch (err) {
        const name = (err as { name?: string })?.name;
        if (name !== "AbortError") setError((err as Error)?.message || "Failed to load projects");
      } finally {
        setLoading(false);
      }
    };
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      const name = (p.name || p.repository || "").toLowerCase();
      const repo = (p.repository || "").toLowerCase();
      return name.includes(q) || repo.includes(q);
    });
  }, [projects, query]);

  return (
    <PageShell
      title="Projects"
      subtitle="Your home base for repositories, creations, agents, and active work."
      icon={<FolderKanban size={24} />}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <section
          className="overflow-hidden rounded-3xl border"
          style={{
            background: `linear-gradient(135deg, ${T.accentColor}18, ${T.boxBg}d9 48%, ${T.bgColor})`,
            borderColor: `${T.accentColor}45`,
          }}
        >
          <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div
                className="mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
                style={{
                  borderColor: `${T.accentColor}45`,
                  color: T.accentColor,
                  backgroundColor: `${T.accentColor}10`,
                }}
              >
                <GitBranch size={12} /> Canonical project
              </div>
              <h2 className="text-2xl font-black sm:text-3xl" style={{ color: T.headerColor }}>
                LiTTree LabStudios
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: T.textMuted }}>
                Build LiTTree from inside LiTTree with project context kept visible. Work should happen on a task branch, then move through diff, checks, preview, and review before deployment.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold">
                <span className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: `${T.borderColor}45`, color: T.textMuted }}>
                  LabsConnected/litlabs-website
                </span>
                <span className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: `${T.borderColor}45`, color: T.textMuted }}>
                  Base branch: main
                </span>
                <a
                  href="https://github.com/LabsConnected/litlabs-website"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 hover:opacity-80"
                  style={{ borderColor: `${T.borderColor}45`, color: T.textMuted }}
                >
                  Repository <ExternalLink size={11} />
                </a>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
              <Link
                href="/studio"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-black"
                style={{ backgroundColor: T.accentColor, color: T.bgColor }}
              >
                <Play size={16} /> Continue building
              </Link>
              <Link
                href="/settings?tab=workspace"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-bold"
                style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}
              >
                <Settings size={16} /> Project setup
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: T.accentColor }}>
                Continue working
              </p>
              <h2 className="mt-1 text-xl font-black" style={{ color: T.headerColor }}>
                Pick up without hunting through menus
              </h2>
            </div>
            <Link href="/studio" className="hidden items-center gap-1 text-xs font-bold sm:inline-flex" style={{ color: T.accentColor }}>
              New Run <Plus size={14} />
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className="group flex min-h-28 items-start gap-4 rounded-2xl border p-4 transition-transform hover:-translate-y-0.5"
                  style={{ backgroundColor: `${T.boxBg}b8`, borderColor: `${T.borderColor}45` }}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${T.accentColor}14`, color: T.accentColor }}>
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black" style={{ color: T.headerColor }}>{action.label}</span>
                    <span className="mt-1 block text-xs leading-relaxed" style={{ color: T.textMuted }}>{action.description}</span>
                  </span>
                  <ArrowRight size={16} className="mt-1 shrink-0 opacity-35 transition-transform group-hover:translate-x-1 group-hover:opacity-100" />
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: T.accentColor }}>
                Your projects
              </p>
              <h2 className="mt-1 text-xl font-black" style={{ color: T.headerColor }}>
                {filtered.length} {filtered.length === 1 ? "project" : "projects"}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search projects..."
                  className="h-9 w-64 rounded-xl border bg-black/20 pl-9 pr-3 text-xs outline-none focus:border-cyan-300/40"
                  style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}
                />
              </div>
              <button
                type="button"
                onClick={fetchProjects}
                className="inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-bold"
                style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}
              >
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-sm opacity-70">Loading projects…</div>
          ) : error ? (
            <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm opacity-70">
              {query ? "No projects match your search." : "No projects yet. Connect a repo in Project setup to get started."}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((project) => (
                <Link
                  key={project.id}
                  href={`/studio?project=${encodeURIComponent(project.id)}`}
                  className="group flex flex-col gap-2 rounded-2xl border p-4 transition-transform hover:-translate-y-0.5"
                  style={{ backgroundColor: `${T.boxBg}b8`, borderColor: `${T.borderColor}45` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black" style={{ color: T.headerColor }}>
                        {project.name || "Untitled project"}
                      </div>
                      <div className="mt-1 truncate text-[11px] opacity-70" style={{ color: T.textMuted }}>
                        {project.repository || "No repository linked"}
                      </div>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase"
                      style={{
                        backgroundColor: `${T.accentColor}18`,
                        color: T.accentColor,
                        border: `1px solid ${T.accentColor}30`,
                      }}
                    >
                      {project.status || "offline"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] opacity-60" style={{ color: T.textMuted }}>
                    <span>{project.updated_at ? new Date(project.updated_at).toLocaleString() : "Not updated"}</span>
                    <span className="inline-flex items-center gap-1 font-bold opacity-0 transition-opacity group-hover:opacity-100" style={{ color: T.accentColor }}>
                      Open <ArrowRight size={12} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8 grid gap-3 md:grid-cols-3">
          {[
            { label: "Files", detail: "Browse project and uploaded files", href: "/library/files", icon: FileText },
            { label: "Runs", detail: "Start a traceable Studio mission", href: "/studio", icon: Play },
            { label: "New project", detail: "Project import is the next connection step", href: "/settings?tab=workspace", icon: Plus },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.label} href={item.href} className="rounded-2xl border p-4 hover:opacity-85" style={{ borderColor: `${T.borderColor}40`, backgroundColor: `${T.boxBg}75` }}>
                <Icon size={18} style={{ color: T.accentColor }} />
                <div className="mt-3 text-sm font-black" style={{ color: T.headerColor }}>{item.label}</div>
                <div className="mt-1 text-xs" style={{ color: T.textMuted }}>{item.detail}</div>
              </Link>
            );
          })}
        </section>
      </div>
    </PageShell>
  );
}

