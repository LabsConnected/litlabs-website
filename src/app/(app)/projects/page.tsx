"use client";

/**
 * /projects — redesigned layout foundation (Projects redesign
 * Phase 2, Decisions A–D, Larry 2026-11-13):
 *
 *   - Frame: the shared LiTTAppShell (sidebar + content region),
 *     replacing PageShell for this page (Decision D).
 *   - Skin: the page renders in the user's normal theme via
 *     useTheme() — the platform's standard light presentation (the
 *     default LiTT Signature light look), the same as every other
 *     page. Decision A originally scoped this page to the Neon
 *     Grove dark pack; Larry's all-light ruling (2026-11-13,
 *     ~11:59 ET) superseded that: no page forces dark. The Neon
 *     Grove pack stays registered in ThemeContext as a
 *     user-selectable theme only.
 *   - Sidebar: real categories only — All Projects, Recent,
 *     Templates (Decision C). No Favorites/Shared/Archived/Storage:
 *     they have no backend and are deferred follow-ups.
 *   - Cards: ProjectCard renders the full payload the API already
 *     returns, with a branded placeholder where the preview image
 *     would go (no data source exists), and the honest project
 *     states from describeProjectState — including "Repo workspace
 *     unavailable" with NO retry (Decision B).
 *
 * Everything behavioral is preserved from the pre-redesign page:
 * the idempotent create flow (blank + template via the same
 * submission-key protocol), search, retry-setup gating, per-card
 * delete, select mode with the Duplicates heuristic and bulk
 * delete, the confirm dialog, and the GitHub installations fetch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LiTTAppShell from "@/components/app-shell/LiTTAppShell";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { createManagedStudioProject, takeSubmissionKey, type CreateSubmission } from "@/lib/projects/create-project-request";
import type { ProjectTemplateId } from "@/lib/projects/types";
import ProjectNameDialog from "@/app/(app)/studio/components/ProjectNameDialog";
import {
  AlertTriangle,
  FolderKanban,
  GitPullRequest,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  sortProjectsRecentFirst,
  readLastOpenedProject,
  recordLastOpenedProject,
} from "@/lib/projects/project-state";
import ProjectsSidebar, {
  RECENT_WINDOW_MS,
  type ProjectsCategory,
} from "./_components/ProjectsSidebar";
import ProjectCard, { type ProjectCardData } from "./_components/ProjectCard";
import TemplatePicker, {
  PROJECT_TEMPLATE_CATALOG,
  type ProjectTemplateCatalogEntry,
} from "./_components/TemplatePicker";
import ProjectSkeleton from "./_components/ProjectSkeleton";

type Project = ProjectCardData;

type Installation = {
  id: number;
  account: string | null;
};

export default function ProjectsPage() {
  // All-light ruling (Larry, 2026-11-13): this page follows the
  // user's normal theme — the standard light look — like every
  // other page. No pack scoping.
  const { resolvedColors: T } = useTheme();
  const router = useRouter();
  const { getToken } = useClerkAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<ProjectsCategory>("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  // Template chosen in the picker; null = the plain New project flow
  // (blank-static, exactly as before).
  const [createTemplate, setCreateTemplate] = useState<ProjectTemplateCatalogEntry | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Submission key bound to the input fingerprint: an identical retry
  // reuses it, an edit/cancel/reopen mints a fresh one.
  const createSubmissionRef = useRef<CreateSubmission | null>(null);
  const [query, setQuery] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [lastOpenedId, setLastOpenedId] = useState<string | null>(null);
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
      setProjects(sortProjectsRecentFirst([...canonical, ...legacy]));
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

  useEffect(() => {
    setLastOpenedId(readLastOpenedProject());
  }, []);

  useEffect(() => {
    // GitHub installations drive the "connected accounts" chips; failure
    // is non-fatal — the projects list is what matters.
    fetch("/api/github/installations")
      .then((r) => r.json().catch(() => ({})))
      .then((data) => setInstallations(data.installations || []))
      .catch(() => setInstallations([]));
  }, []);

  const handleOpenProject = useCallback((id: string) => {
    recordLastOpenedProject(id);
    setLastOpenedId(id);
  }, []);

  const openCreateDialog = useCallback((template: ProjectTemplateCatalogEntry | null) => {
    setCreateError(null);
    setCreateTemplate(template);
    setCreateDialogOpen(true);
  }, []);

  const handleCreateProject = useCallback(
    async (name: string) => {
      if (creatingProject) return;
      setCreatingProject(true);
      setCreateError(null);
      const templateId: ProjectTemplateId = createTemplate?.id ?? "blank-static";
      // The key is bound to this exact submission (template + name):
      // retrying an identical submission reuses it, an edited name or
      // a different template is a new submission.
      createSubmissionRef.current = takeSubmissionKey(
        createSubmissionRef.current,
        `${templateId}:${name.trim()}`,
      );
      try {
        const project = await createManagedStudioProject({
          name,
          templateId,
          getToken,
          idempotencyKey: createSubmissionRef.current.key,
        });
        // Close the dialog immediately so a pending navigation cannot
        // accept a second submission; the busy flag stays set until this
        // submission fully resolves.
        setCreateDialogOpen(false);
        setCreateTemplate(null);
        router.push(`/studio?project=${encodeURIComponent(project.id)}`);
        setCreatingProject(false);
        createSubmissionRef.current = null;
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Couldn't create your project. Try again.");
        setCreatingProject(false);
      }
    },
    [creatingProject, createTemplate, getToken, router],
  );

  const retrySetup = useCallback(
    async (projectId: string) => {
      setRetryingId(projectId);
      setNotice(null);
      try {
        const res = await fetch(
          `/api/studio-projects/${encodeURIComponent(projectId)}/workspace/prepare`,
          { method: "POST" },
        );
        if (!res.ok) throw new Error("retry failed");
        await fetchProjects();
        setNotice("Setup restarted — this usually takes a minute or two.");
      } catch {
        setNotice("Couldn’t restart setup. Try again in a moment.");
      } finally {
        setRetryingId(null);
      }
    },
    [fetchProjects],
  );

  const recentProjects = useMemo(() => {
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    return projects.filter((p) => {
      const ts = Date.parse(p.updatedAt);
      return !Number.isNaN(ts) && ts >= cutoff;
    });
  }, [projects]);

  const categoryProjects = category === "recent" ? recentProjects : projects;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categoryProjects;
    return categoryProjects.filter((p) => {
      const name = p.name.toLowerCase();
      const repo = (p.githubFullName || "").toLowerCase();
      return name.includes(q) || repo.includes(q);
    });
  }, [categoryProjects, query]);

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

  const header = (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-black sm:text-3xl" style={{ color: T.headerColor }}>
          Projects
        </h1>
        <p className="mt-1 text-sm" style={{ color: T.textMuted }}>
          Your home base for repositories, creations, agents, and active work.
        </p>
      </div>
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
            <button
              type="button"
              onClick={() => openCreateDialog(null)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-black"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              <Plus size={16} /> New project
            </button>
            <Link
              href="/studio"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-bold"
              style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}
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
    </>
  );

  return (
    <LiTTAppShell
      colors={T}
      sidebarLabel="Browse"
      header={header}
      sidebar={
        <ProjectsSidebar
          colors={T}
          category={category}
          onSelectCategory={setCategory}
          counts={{
            all: projects.length,
            recent: recentProjects.length,
            templates: PROJECT_TEMPLATE_CATALOG.length,
          }}
          installations={installations}
        />
      }
    >
      {category === "templates" ? (
        <section className="mt-8">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: T.accentColor }}>
              Start from a template
            </p>
            <h2 className="mt-1 text-xl font-black" style={{ color: T.headerColor }}>
              Templates
            </h2>
          </div>
          <TemplatePicker colors={T} onUseTemplate={(template) => openCreateDialog(template)} />
        </section>
      ) : (
        <section className="mt-8">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: T.accentColor }}>
                Your projects
              </p>
              <h2 className="mt-1 text-xl font-black" style={{ color: T.headerColor }}>
                {filtered.length} {filtered.length === 1 ? "project" : "projects"}
                {category === "recent" ? " · updated in the last 30 days" : ""}
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
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-red-400/40 px-3 text-xs font-black text-red-600 disabled:opacity-40"
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
            <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-bold" style={{ color: T.textColor }} role="status">
              {notice}
            </div>
          )}

          {loading ? (
            <ProjectSkeleton />
          ) : error ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-5 text-sm" style={{ color: T.textColor }} role="alert">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <div><strong>Projects unavailable</strong><p className="mt-1" style={{ color: T.textMuted }}>{error}</p></div>
              </div>
              <button type="button" onClick={() => void fetchProjects()} className="min-h-11 rounded-xl border border-red-200/25 px-4 font-bold hover:bg-red-50/10">
                Try again
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm" style={{ borderColor: `${T.borderColor}55`, color: T.textMuted }}>
              <FolderKanban size={28} className="mx-auto mb-3 opacity-70" />
              <p>
                {query
                  ? "No projects match your search."
                  : category === "recent"
                    ? "No projects updated in the last 30 days."
                    : "No projects yet. Start with a blank project or connect a repository."}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {query ? (
                  <button type="button" onClick={() => setQuery("")} className="min-h-11 rounded-xl border px-4 font-bold" style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}>Clear search</button>
                ) : category === "recent" ? (
                  <button type="button" onClick={() => setCategory("all")} className="min-h-11 rounded-xl border px-4 font-bold" style={{ borderColor: `${T.borderColor}55`, color: T.textColor }}>View all projects</button>
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
              {filtered.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  colors={T}
                  selectMode={selectMode}
                  isSelected={selected.has(project.id)}
                  isResumable={!selectMode && lastOpenedId === project.id}
                  retrying={retryingId === project.id}
                  onToggleSelect={toggleSelect}
                  onOpen={handleOpenProject}
                  onRetry={(id) => void retrySetup(id)}
                  onDelete={(p) => setConfirmTargets([p])}
                />
              ))}
            </div>
          )}
        </section>
      )}

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
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-500/15 text-red-500">
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

      <ProjectNameDialog
        open={createDialogOpen}
        busy={creatingProject}
        error={createError}
        onCancel={() => { if (!creatingProject) { createSubmissionRef.current = null; setCreateTemplate(null); setCreateDialogOpen(false); } }}
        onSubmit={(name) => { void handleCreateProject(name); }}
      />
    </LiTTAppShell>
  );
}
