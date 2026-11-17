"use client";

import { useMemo, useState, useEffect } from "react";
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
  ClipboardCheck,
  Lock,
  Search,
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

/**
 * Project status presentation (Kimi wiring item 13). The /api/projects
 * rows carry a free-form workspace `status` string; the pill maps it
 * to a SPECIFIC label (finish spec: no vague states) — ready/online →
 * "Ready", failed/error → "Workspace failed", provisioning family →
 * "Preparing…", anything else shows the status itself, capitalized,
 * rather than a made-up synonym. The same mapping drives the status
 * filter chips and the failed-first sort.
 */
type ProjectStatusKind = "ready" | "failed" | "working" | "other";

function projectStatusKind(status: string): ProjectStatusKind {
  const s = (status ?? "").toLowerCase();
  if (s === "ready" || s === "online") return "ready";
  if (s === "failed" || s === "error") return "failed";
  if (["provisioning", "preparing", "pending", "creating"].includes(s)) return "working";
  return "other";
}

function projectStatusLabel(status: string): string {
  switch (projectStatusKind(status)) {
    case "ready":
      return "Ready";
    case "failed":
      return "Workspace failed";
    case "working":
      return "Preparing…";
    default:
      return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown";
  }
}

export default function ProjectsPageClient() {
  const { resolvedColors: T, tokens } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // List controls (Kimi wiring item 13): search / sort / status
  // filter, all over the full list /api/projects returns (the API
  // returns every project unpaginated, so client filtering is exact).
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "status">("recent");
  const [statusFilter, setStatusFilter] = useState<"all" | ProjectStatusKind>("all");

  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      if (statusFilter !== "all" && projectStatusKind(p.status) !== statusFilter) return false;
      if (q && !`${p.owner}/${p.repository}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sort === "name") {
      return [...filtered].sort((a, b) =>
        `${a.owner}/${a.repository}`.localeCompare(`${b.owner}/${b.repository}`),
      );
    }
    if (sort === "status") {
      const rank: Record<ProjectStatusKind, number> = { failed: 0, working: 1, ready: 2, other: 3 };
      return [...filtered].sort(
        (a, b) => rank[projectStatusKind(a.status)] - rank[projectStatusKind(b.status)],
      );
    }
    return filtered; // "recent" = the API's own updated_at-desc order
  }, [projects, query, sort, statusFilter]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setLoading(false);  
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
            href="/studio/github"
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
            {projects.length > 0 && (
              <div className="flex flex-col gap-2 pb-1" data-testid="projects-controls">
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className="flex min-h-[44px] flex-1 items-center gap-2 rounded-xl border px-3 sm:max-w-xs"
                    style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
                  >
                    <Search size={14} style={{ color: tokens.textMuted }} aria-hidden />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search projects…"
                      aria-label="Search projects"
                      data-testid="projects-search"
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                      style={{ color: tokens.text }}
                    />
                  </label>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as typeof sort)}
                    aria-label="Sort projects"
                    data-testid="projects-sort"
                    className="min-h-[44px] rounded-xl border px-2 text-xs font-bold"
                    style={{ borderColor: T.borderColor, backgroundColor: T.boxBg, color: tokens.text }}
                  >
                    <option value="recent">Recently updated</option>
                    <option value="name">Name A–Z</option>
                    <option value="status">Status (failed first)</option>
                  </select>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
                  {(
                    [
                      ["all", "All"],
                      ["ready", "Ready"],
                      ["failed", "Failed"],
                      ["working", "Preparing"],
                      ["other", "Other"],
                    ] as ["all" | ProjectStatusKind, string][]
                  ).map(([kind, label]) => {
                    const count =
                      kind === "all"
                        ? projects.length
                        : projects.filter((p) => projectStatusKind(p.status) === kind).length;
                    if (kind !== "all" && count === 0) return null;
                    const active = statusFilter === kind;
                    return (
                      <button
                        key={kind}
                        type="button"
                        data-testid={`projects-filter-${kind}`}
                        aria-pressed={active}
                        onClick={() => setStatusFilter(kind)}
                        className="rounded-full border px-3 py-1.5 text-[11px] font-bold"
                        style={
                          active
                            ? { backgroundColor: tokens.primary, borderColor: tokens.primary, color: tokens.background }
                            : { borderColor: T.borderColor, color: tokens.textMuted }
                        }
                      >
                        {label} · {count}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
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
                  href="/studio/github"
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black"
                  style={{
                    backgroundColor: tokens.primary,
                    color: tokens.background,
                  }}
                >
                  <GitPullRequest size={14} /> Connect GitHub
                </Link>
                <Link
                  href="/studio#dashboard-guided-start"
                  className="mt-2 inline-flex items-center gap-2 text-xs font-bold"
                  style={{ color: tokens.primary }}
                >
                  Or start with an idea first →
                </Link>
              </div>
            ) : visibleProjects.length === 0 ? (
              <div
                className="rounded-2xl border p-8 text-center"
                style={{ backgroundColor: T.boxBg, borderColor: T.borderColor }}
                data-testid="projects-no-match"
              >
                <div className="mb-1 font-black text-sm" style={{ color: tokens.text }}>
                  No projects match
                </div>
                <p className="text-xs mb-4 leading-relaxed" style={{ color: tokens.textMuted }}>
                  Nothing here fits the current search and filters.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setStatusFilter("all");
                  }}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-sm font-black"
                  style={{ backgroundColor: tokens.primary, color: tokens.background }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              visibleProjects.map((p) => (
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
                              projectStatusKind(p.status) === "ready"
                                ? "#22c55e20"
                                : projectStatusKind(p.status) === "failed"
                                  ? "#ef444420"
                                  : projectStatusKind(p.status) === "working"
                                    ? "#e3b34120"
                                    : `${tokens.primary}15`,
                            color:
                              projectStatusKind(p.status) === "ready"
                                ? "#22c55e"
                                : projectStatusKind(p.status) === "failed"
                                  ? "#ef4444"
                                  : projectStatusKind(p.status) === "working"
                                    ? "#e3b341"
                                    : tokens.primary,
                          }}
                        >
                          {projectStatusLabel(p.status)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {projectStatusKind(p.status) === "failed" && (
                      // Failed → Studio Checks deep link (item 13):
                      // lands in the Studio for this project with the
                      // Checks panel summoned (?tool=checks is handled
                      // by CommandStudio's deep-link effect).
                      <Link
                        href={`/studio?project=${encodeURIComponent(String(p.id))}&tool=checks`}
                        data-testid={`project-view-checks-${p.id}`}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all hover:opacity-80"
                        style={{ borderColor: "#ef444440", color: "#ef4444", backgroundColor: "#ef444408" }}
                      >
                        <ClipboardCheck size={11} /> View checks
                      </Link>
                    )}
                    <Link
                      href={`/projects?id=${p.id}`}
                      className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all hover:opacity-80"
                      style={{ borderColor: T.borderColor, color: tokens.text }}
                    >
                      <ExternalLink size={11} /> Open Mission Control
                    </Link>
                  </div>
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
