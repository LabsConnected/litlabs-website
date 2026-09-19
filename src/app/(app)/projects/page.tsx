"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import { useTheme } from "@/context/ThemeContext";
import {
  ArrowRight,
  AlertTriangle,
  Bot,
  Code2,
  FileText,
  FolderKanban,
  GitPullRequest,
  Image,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
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
    description: "Build reusable Missions by connecting LiTT, tools, approvals, and outputs.",
    href: "/studio?tool=workflows",
    icon: Bot,
  },
  {
    label: "Review artifacts",
    description: "Find images, previews, and saved outputs in one place.",
    href: "/library/files",
    icon: Image,
  },
];

type Project = {
  id: string;
  name: string;
  sourceType: "github" | "blank" | "template";
  githubFullName: string | null;
  githubBranch: string | null;
  workspaceStatus: string;
  runtimeStatus: string;
  updatedAt: string;
};

function projectStatus(project: Project): { label: string; color: string } {
  if (["failed", "error"].includes(project.workspaceStatus) || project.runtimeStatus === "failed") {
    return { label: "Needs attention", color: "#f87171" };
  }
  if (["provisioning", "preparing"].includes(project.workspaceStatus) || project.runtimeStatus === "starting") {
    return { label: "Preparing", color: "#fbbf24" };
  }
  if (project.workspaceStatus === "ready" && project.runtimeStatus === "ready") {
    return { label: "Preview ready", color: "#34d399" };
  }
  if (project.workspaceStatus === "ready") {
    return { label: "Ready", color: "#60a5fa" };
  }
  return { label: "Setup needed", color: "#a78bfa" };
}

export default function ProjectsPage() {
  const { resolvedColors: T } = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Project deletion (multi-select + confirm). Deletion itself is performed
  // by the existing DELETE /api/studio-projects/[projectId] endpoint, which
  // verifies ownership; related rows cascade in the database.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmTargets, setConfirmTargets] = useState<Project[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchProjects = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/studio-projects", { signal, cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Projects are unavailable right now.");
      const canonical = Array.isArray(data.projects) ? data.projects : [];
      const legacy = Array.isArray(data.legacyOnly) ? data.legacyOnly : [];
      setProjects([...canonical, ...legacy]);
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setError("We couldn’t load your projects. Your work is safe—try again in a moment.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchProjects(controller.signal);
    return () => controller.abort();
  }, [fetchProjects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      const name = p.name.toLowerCase();
      const repo = (p.githubFullName || "").toLowerCase();
      return name.includes(q) || repo.includes(q);
    });
  }, [projects, query]);

  // Heuristic for acceptance-test duplicates: a timestamp suffix like
  // "Ember Roast V1 Acceptance 08-17-25". Used only to pre-select
  // candidates for bulk delete — the user always confirms.
  const isTestDuplicate = useCallback((p: Project) => {
    return /acceptance/i.test(p.name) && /\d{2}-\d{2}-\d{2}/.test(p.name);
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const runDelete = useCallback(async (targets: Project[]) => {
    setDeleting(true);
    setNotice(null);
    const results = await Promise.allSettled(
      targets.map(async (p) => {
        const res = await fetch(`/api/studio-projects/${encodeURIComponent(p.id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`delete failed for ${p.name || p.id}`);
      }),
    );
    const okCount = results.filter((r) => r.status === "fulfilled").length;
    const failCount = results.length - okCount;
    setDeleting(false);
    setConfirmTargets(null);
    exitSelectMode();
    await fetchProjects();
    setNotice(
      failCount === 0
        ? `Deleted ${okCount} project${okCount === 1 ? "" : "s"}.`
        : `Deleted ${okCount} of ${results.length} projects — ${failCount} failed. Try again for the rest.`,
    );
  }, [exitSelectMode, fetchProjects]);

  return (
    <PageShell
      title="Projects"
      subtitle="Your home base for repositories, creations, agents, and active work."
      icon={<FolderKanban size={24} />}
    >
      <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8">
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
                <FolderKanban size={12} /> Project workspace
              </div>
              <h2 className="text-2xl font-black sm:text-3xl" style={{ color: T.headerColor }}>
                Pick up a project or start something new
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: T.textMuted }}>
                LiTT keeps each project&apos;s files, workspace, preview, and conversation together so you can return without rebuilding the context.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
              <Link
                href="/studio"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-black"
                style={{ backgroundColor: T.accentColor, color: T.bgColor }}
              >
                <Play size={16} /> Start in Studio
              </Link>
              <Link
                href="/studio/github"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-bold"
                style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}
              >
                <GitPullRequest size={16} /> Connect a repository
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
                  className="h-9 w-64 rounded-xl border bg-black/20 pl-9 pr-3 text-xs outline-none focus:border-accent/40"
                  style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}
                />
              </div>
              <button
                type="button"
                onClick={() => void fetchProjects()}
                className="inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-bold"
                style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}
              >
                <RefreshCw size={14} /> Refresh
              </button>
              {!selectMode ? (
                <button
                  type="button"
                  onClick={() => { setSelectMode(true); setNotice(null); }}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-bold"
                  style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}
                >
                  Select
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(filtered.map((p) => p.id)))}
                    className="inline-flex h-9 items-center rounded-xl border px-3 text-xs font-bold"
                    style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(filtered.filter(isTestDuplicate).map((p) => p.id)))}
                    className="inline-flex h-9 items-center rounded-xl border px-3 text-xs font-bold"
                    style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}
                    title="Select acceptance-test duplicates (timestamped names)"
                  >
                    Duplicates
                  </button>
                  <button
                    type="button"
                    disabled={selected.size === 0}
                    onClick={() => setConfirmTargets(filtered.filter((p) => selected.has(p.id)))}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-red-400/40 px-3 text-xs font-black text-red-300 disabled:opacity-40"
                  >
                    <Trash2 size={14} /> Delete{selected.size > 0 ? ` (${selected.size})` : ""}
                  </button>
                  <button
                    type="button"
                    onClick={exitSelectMode}
                    aria-label="Done selecting"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border"
                    style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}
                  >
                    <X size={14} />
                  </button>
                </>
              )}
            </div>
          </div>

          {notice && (
            <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-bold text-emerald-100" role="status">
              {notice}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20 text-sm opacity-70" role="status">Loading projects…</div>
          ) : error ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-5 text-sm text-red-100" role="alert">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <div><strong>Projects unavailable</strong><p className="mt-1 text-red-100/75">{error}</p></div>
              </div>
              <button type="button" onClick={() => void fetchProjects()} className="min-h-11 rounded-xl border border-red-200/25 px-4 font-bold hover:bg-red-50/10">
                Try again
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm" style={{ borderColor: `${T.borderColor}55`, color: T.textMuted }}>
              <FolderKanban size={28} className="mx-auto mb-3 opacity-70" />
              <p>{query ? "No projects match your search." : "No projects yet. Start with a blank project or connect a repository."}</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {query ? (
                  <button type="button" onClick={() => setQuery("")} className="min-h-11 rounded-xl border px-4 font-bold" style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}>Clear search</button>
                ) : (
                  <>
                    <Link href="/studio" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 font-black" style={{ backgroundColor: T.accentColor, color: T.bgColor }}><Sparkles size={15} /> Start a project</Link>
                    <Link href="/studio/github" className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2.5 font-bold" style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}><GitPullRequest size={15} /> Connect GitHub</Link>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((project) => {
                const status = projectStatus(project);
                const isSelected = selected.has(project.id);
                return (
                  <Link
                    key={project.id}
                    href={selectMode ? "#" : `/studio?project=${encodeURIComponent(project.id)}`}
                    onClick={selectMode ? (e) => { e.preventDefault(); toggleSelect(project.id); } : undefined}
                    aria-pressed={selectMode ? isSelected : undefined}
                    className={`group relative flex flex-col gap-3 rounded-2xl border p-4 transition-transform hover:-translate-y-0.5 ${selectMode && isSelected ? "ring-2 ring-accent/60" : ""}`}
                    style={{ backgroundColor: `${T.boxBg}b8`, borderColor: `${T.borderColor}45` }}
                  >
                    {selectMode && (
                      <span
                        aria-hidden="true"
                        className="absolute left-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-lg border text-transparent"
                        style={{
                          borderColor: `${T.borderColor}88`,
                          backgroundColor: isSelected ? T.accentColor : "transparent",
                          color: isSelected ? T.bgColor : "transparent",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>
                      </span>
                    )}
                    <div className={`flex items-start justify-between gap-3 ${selectMode ? "pl-8" : ""}`}>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black" style={{ color: T.headerColor }}>{project.name || "Untitled project"}</div>
                        <div className="mt-1 truncate text-[11px]" style={{ color: T.textMuted }}>
                          {project.githubFullName || (project.sourceType === "blank" ? "LiTT project" : "Template project")}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase" style={{ backgroundColor: `${status.color}18`, color: status.color, border: `1px solid ${status.color}35` }}>{status.label}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-[11px]" style={{ color: T.textMuted }}>
                      <span className="truncate">{project.githubBranch ? `Branch: ${project.githubBranch}` : `Updated ${new Date(project.updatedAt).toLocaleDateString()}`}</span>
                      {selectMode ? (
                        <span className="inline-flex shrink-0 items-center gap-1 font-bold" style={{ color: T.accentColor }}>
                          {isSelected ? "Selected" : "Tap to select"}
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            aria-label={`Delete ${project.name || "Untitled project"}`}
                            title="Delete project"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmTargets([project]); }}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-400/30 text-red-300/80 opacity-70 transition-opacity hover:opacity-100"
                          >
                            <Trash2 size={14} />
                          </button>
                          <span className="inline-flex items-center gap-1 font-bold" style={{ color: T.accentColor }}>Open <ArrowRight size={12} /></span>
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-8 grid gap-3 md:grid-cols-3">
          {[
            { label: "Files", detail: "Browse project and uploaded files", href: "/library/files", icon: FileText },
            { label: "Runs", detail: "Start a traceable Studio mission", href: "/studio", icon: Play },
            { label: "New project", detail: "Start with a blank project or describe what to build", href: "/studio", icon: Plus },
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

      {confirmTargets && (
        <div
          className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 p-4 sm:items-center"
          onClick={() => { if (!deleting) setConfirmTargets(null); }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-projects-title"
            aria-describedby="delete-projects-desc"
            className="w-full max-w-md rounded-3xl border p-6"
            style={{ backgroundColor: T.boxBg, borderColor: `${T.borderColor}55` }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Escape" && !deleting) setConfirmTargets(null); }}
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-500/15 text-red-300">
                <Trash2 size={18} />
              </span>
              <h2 id="delete-projects-title" className="text-base font-black" style={{ color: T.headerColor }}>
                Delete {confirmTargets.length} project{confirmTargets.length === 1 ? "" : "s"}?
              </h2>
            </div>
            <p id="delete-projects-desc" className="mt-3 text-sm" style={{ color: T.textMuted }}>
              This permanently removes {confirmTargets.length === 1 ? "this project" : "these projects"} and can’t be undone.
            </p>
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm font-bold" style={{ color: T.textColor }}>
              {confirmTargets.slice(0, 6).map((p) => (
                <li key={p.id} className="truncate">• {p.name || "Untitled project"}</li>
              ))}
              {confirmTargets.length > 6 && <li style={{ color: T.textMuted }}>…and {confirmTargets.length - 6} more</li>}
            </ul>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                autoFocus
                disabled={deleting}
                onClick={() => setConfirmTargets(null)}
                className="min-h-11 flex-1 rounded-xl border px-4 font-bold disabled:opacity-50"
                style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}
              >
                Keep
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void runDelete(confirmTargets)}
                className="min-h-11 flex-1 rounded-xl bg-red-500 px-4 font-black text-white disabled:opacity-50"
              >
                {deleting ? "Deleting…" : `Delete ${confirmTargets.length === 1 ? "project" : `${confirmTargets.length} projects`}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
