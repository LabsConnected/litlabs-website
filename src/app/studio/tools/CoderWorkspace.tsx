"use client";

/**
 * CoderWorkspace — canonical coder UI shell (Phase 1).
 *
 * This is the replacement for CanvasTool as the default `tool=code` surface.
 * Phase 1 is a SHELL ONLY: it reads from existing Project, files, preview,
 * Canvas, checkpoint, and conversation APIs and displays truthful state.
 * It does NOT call /api/litt/run, does NOT execute AI, and does NOT mutate
 * files. The composer is visible but non-functional — it shows a truthful
 * "not wired yet" state until Phase 2 connects it to the canonical run API.
 *
 * Layout (per Handbook Section 11 + rebuild directive Section 2):
 *   Desktop (≥1024px):
 *     - Top bar: Project | Branch | Run status | Model | Credits
 *     - Left rail: LiTT conversation + Plan/timeline tabs
 *     - Right pane: Files | Code | Preview | Review tabs
 *     - Bottom drawer: Canvas | Terminal (collapsible)
 *     - Persistent composer at bottom of left rail
 *   Mobile (<1024px):
 *     - Top bar: Project | Run status | Menu
 *     - Main: Conversation OR work view (toggle)
 *     - Persistent composer
 *     - Bottom sheet: Files | Code | Preview | Canvas | Terminal
 *
 * @see docs/litt/phase-1-2-plan.md
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "@/context/ThemeContext";

// ─── Types (local — matching existing API response shapes) ────────────────

interface StudioProject {
  id: string;
  name: string;
  slug: string;
  sourceType: string;
  framework: string | null;
  workspaceStatus: string;
  runtimeStatus: string;
  previewUrl: string | null;
  workspaceId: string | null;
  workspaceRoot: string | null;
}

interface ProjectListResponse {
  projects?: StudioProject[];
  legacyOnly?: StudioProject[];
  error?: string;
}

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

interface CanvasSummary {
  id: string;
  title: string;
  type: string;
  status: string;
  updatedAt: string;
}

interface CheckpointSummary {
  id: string;
  label: string;
  createdAt: string;
}

type LoadStatus = "idle" | "loading" | "ready" | "error";

// ─── Subcomponents ─────────────────────────────────────────────────────────

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-xs font-bold uppercase tracking-wider text-white/60">
        {title}
      </p>
      <p className="max-w-xs text-[11px] leading-relaxed text-white/40">
        {body}
      </p>
      {action}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-xs font-bold uppercase tracking-wider text-red-300">
        Error
      </p>
      <p className="max-w-xs text-[11px] leading-relaxed text-red-200/70">
        {message}
      </p>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      <p className="text-[11px] text-white/40">{label}</p>
    </div>
  );
}

// ─── Project bar ──────────────────────────────────────────────────────────

function ProjectBar({
  projects,
  projectId,
  onSelect,
  onRefresh,
  loading,
  T,
}: {
  projects: StudioProject[];
  projectId: string;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  loading: boolean;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const selected = projects.find((p) => p.id === projectId) ?? null;
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
      style={{ borderColor: `${T.borderColor}30` }}
    >
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50">
        Project
      </span>
      {loading ? (
        <span className="text-[11px] text-white/40">Loading…</span>
      ) : projects.length === 0 ? (
        <span className="text-[11px] text-white/40">No projects yet</span>
      ) : (
        <select
          value={projectId}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white outline-none"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.sourceType})
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={onRefresh}
        className="text-[10px] text-white/40 hover:text-white/70"
        aria-label="Refresh projects"
      >
        ↻
      </button>
      {selected && (
        <span className="ml-auto text-[10px] text-white/40">
          {selected.framework ?? "static"} · ws:{selected.workspaceStatus}
        </span>
      )}
    </div>
  );
}

// ─── Right pane tabs ───────────────────────────────────────────────────────

type RightTab = "files" | "code" | "preview" | "review";

function RightPane({
  projectId,
  project,
  T,
}: {
  projectId: string;
  project: StudioProject | null;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const [tab, setTab] = useState<RightTab>("files");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filesStatus, setFilesStatus] = useState<LoadStatus>("idle");
  const [filesError, setFilesError] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<LoadStatus>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Load files when project changes
  useEffect(() => {
    if (!projectId) {
      setFiles([]);
      setFilesStatus("idle");
      return;
    }
    let cancelled = false;
    setFilesStatus("loading");
    setFilesError(null);
    fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/files?path=.`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: { entries?: FileEntry[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setFiles(data.entries ?? []);
        setFilesStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFilesError(err instanceof Error ? err.message : "Failed to load files");
        setFilesStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load preview status when project changes
  useEffect(() => {
    if (!projectId) {
      setPreviewStatus("idle");
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    setPreviewStatus("loading");
    setPreviewError(null);
    fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/preview`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: { runtimeStatus?: string; previewUrl?: string | null; runtimeError?: string | null }) => {
        if (cancelled) return;
        setPreviewUrl(data.previewUrl ?? null);
        setPreviewStatus(data.runtimeStatus === "ready" ? "ready" : "idle");
        if (data.runtimeError) setPreviewError(data.runtimeError);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreviewError(err instanceof Error ? err.message : "Failed to load preview");
        setPreviewStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const tabs: { id: RightTab; label: string }[] = [
    { id: "files", label: "Files" },
    { id: "code", label: "Code" },
    { id: "preview", label: "Preview" },
    { id: "review", label: "Review" },
  ];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Tab bar */}
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
        style={{ borderColor: `${T.borderColor}30` }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
              tab === t.id
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {!projectId ? (
          <EmptyState
            title="No project selected"
            body="Select a project above, or create one from the Build tool. Files, code, preview, and review will appear here."
          />
        ) : tab === "files" ? (
          filesStatus === "loading" ? (
            <LoadingState label="Loading file tree…" />
          ) : filesStatus === "error" ? (
            <ErrorState message={filesError ?? "Failed to load files"} />
          ) : files.length === 0 ? (
            <EmptyState
              title="Empty workspace"
              body="The project workspace has no files yet, or the workspace is not prepared."
            />
          ) : (
            <ul className="py-1 text-[11px]">
              {files.map((f) => (
                <li
                  key={f.path}
                  className="flex items-center gap-2 px-3 py-0.5 hover:bg-white/5"
                >
                  <span className="text-white/40">
                    {f.type === "directory" ? "▸" : "·"}
                  </span>
                  <span className="text-white/70">{f.name}</span>
                  {f.size != null && (
                    <span className="ml-auto text-[9px] text-white/30">
                      {f.size} B
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : tab === "code" ? (
          <EmptyState
            title="Code viewer"
            body="Select a file from the Files tab to view its contents. File editing arrives in Phase 3 with structured workspace tools."
          />
        ) : tab === "preview" ? (
          previewStatus === "loading" ? (
            <LoadingState label="Loading preview status…" />
          ) : previewStatus === "error" ? (
            <ErrorState message={previewError ?? "Preview unavailable"} />
          ) : !previewUrl ? (
            <EmptyState
              title="No preview"
              body={
                project?.runtimeStatus === "ready"
                  ? "Runtime reports ready but no preview URL is set."
                  : "The project runtime is not running. Start it from the Build tool or terminal."
              }
            />
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-1">
                <span className="truncate text-[10px] text-white/50">
                  {previewUrl}
                </span>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-[10px] text-cyan-300 hover:underline"
                >
                  Open ↗
                </a>
              </div>
              <iframe
                src={previewUrl}
                className="min-h-0 flex-1 border-0 bg-white"
                title="Project preview"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            </div>
          )
        ) : tab === "review" ? (
          <EmptyState
            title="Visual review"
            body="Deterministic browser QA and multimodal design review arrive in Phase 6. No review has been run yet."
          />
        ) : null}
      </div>
    </div>
  );
}

// ─── Left rail: conversation + plan/timeline ──────────────────────────────

type LeftTab = "conversation" | "plan";

function LeftRail({
  projectId,
  T,
}: {
  projectId: string;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const [tab, setTab] = useState<LeftTab>("conversation");
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [canvasesStatus, setCanvasesStatus] = useState<LoadStatus>("idle");

  useEffect(() => {
    if (!projectId) {
      setCanvases([]);
      setCanvasesStatus("idle");
      return;
    }
    let cancelled = false;
    setCanvasesStatus("loading");
    fetch(`/api/canvases?projectId=${encodeURIComponent(projectId)}&status=active`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { canvases?: CanvasSummary[] }) => {
        if (cancelled) return;
        setCanvases(data.canvases ?? []);
        setCanvasesStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setCanvasesStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Tab bar */}
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
        style={{ borderColor: `${T.borderColor}30` }}
      >
        {(["conversation", "plan"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
              tab === t
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {t === "conversation" ? "LiTT" : "Plan / Timeline"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {tab === "conversation" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5">
              <span className="text-sm">LiTT</span>
            </div>
            <p className="text-xs font-bold text-white/60">
              Conversation ready
            </p>
            <p className="max-w-xs text-[11px] leading-relaxed text-white/40">
              The canonical LiTT run API arrives in Phase 2. Until then, this
              shell shows real project, file, preview, and canvas state. Type
              below — the composer will connect to{" "}
              <code className="text-white/50">/api/litt/run</code> once it
              exists.
            </p>
          </div>
        ) : tab === "plan" ? (
          <div className="flex h-full flex-col gap-2 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">
              Canvas artifacts
            </p>
            {canvasesStatus === "loading" ? (
              <LoadingState label="Loading canvases…" />
            ) : canvasesStatus === "error" ? (
              <ErrorState message="Failed to load canvases" />
            ) : canvases.length === 0 ? (
              <EmptyState
                title="No canvases"
                body="Canvas artifacts created by LiTT runs will appear here. No runs have been executed yet."
              />
            ) : (
              <ul className="space-y-1">
                {canvases.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5"
                  >
                    <p className="text-[11px] font-bold text-white/70">
                      {c.title}
                    </p>
                    <p className="text-[9px] text-white/40">
                      {c.type} · {c.status} · {new Date(c.updatedAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-auto pt-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                Plan
              </p>
              <EmptyState
                title="No active plan"
                body="Build plans created by LiTT will appear here once Phase 4 (plan mode) is implemented."
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Composer (visible, non-functional in Phase 1) ────────────────────────

function Composer({ T }: { T: ReturnType<typeof useTheme>["resolvedColors"] }) {
  const [value, setValue] = useState("");
  return (
    <div
      className="shrink-0 border-t px-3 py-2"
      style={{ borderColor: `${T.borderColor}30` }}
    >
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={1}
          placeholder="Describe what to build… (connects to /api/litt/run in Phase 2)"
          className="min-h-[36px] max-h-[120px] flex-1 resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[12px] text-white placeholder:text-white/30 outline-none focus:border-white/20"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              // Phase 1: no-op. Phase 2 wires this to /api/litt/run.
            }
          }}
        />
        <button
          type="button"
          disabled
          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-bold text-white/30"
          title="Enabled in Phase 2 when /api/litt/run is available"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ─── Bottom drawer: Canvas | Terminal ─────────────────────────────────────

type DrawerTab = "canvas" | "terminal";

function BottomDrawer({
  projectId,
  T,
}: {
  projectId: string;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DrawerTab>("canvas");
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [checkpointsStatus, setCheckpointsStatus] = useState<LoadStatus>("idle");

  useEffect(() => {
    if (!projectId) {
      setCheckpoints([]);
      setCheckpointsStatus("idle");
      return;
    }
    let cancelled = false;
    setCheckpointsStatus("loading");
    fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/checkpoints`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { checkpoints?: CheckpointSummary[] }) => {
        if (cancelled) return;
        setCheckpoints(data.checkpoints ?? []);
        setCheckpointsStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setCheckpointsStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div
      className="flex shrink-0 flex-col border-t"
      style={{
        borderColor: `${T.borderColor}30`,
        height: open ? "30%" : "auto",
        maxHeight: "40vh",
      }}
    >
      <div
        className="flex shrink-0 items-center gap-2 px-3 py-1.5"
        style={{ borderBottom: `1px solid ${T.borderColor}20` }}
      >
        <button
          type="button"
          onClick={() => setTab("canvas")}
          className={`text-[10px] font-bold uppercase tracking-wider ${
            tab === "canvas" ? "text-white" : "text-white/40"
          }`}
        >
          Canvas
        </button>
        <button
          type="button"
          onClick={() => setTab("terminal")}
          className={`text-[10px] font-bold uppercase tracking-wider ${
            tab === "terminal" ? "text-white" : "text-white/40"
          }`}
        >
          Terminal
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-[10px] text-white/40 hover:text-white/70"
          aria-label={open ? "Collapse drawer" : "Expand drawer"}
        >
          {open ? "▼" : "▲"}
        </button>
      </div>
      {open && (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {tab === "canvas" ? (
            checkpointsStatus === "loading" ? (
              <LoadingState label="Loading checkpoints…" />
            ) : checkpointsStatus === "error" ? (
              <ErrorState message="Failed to load checkpoints" />
            ) : checkpoints.length === 0 ? (
              <EmptyState
                title="No checkpoints"
                body="Checkpoints created before risky changes will appear here. Phase 4 wires checkpoint creation into the run flow."
              />
            ) : (
              <ul className="space-y-1">
                {checkpoints.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-1"
                  >
                    <p className="text-[11px] text-white/70">{c.label}</p>
                    <p className="text-[9px] text-white/40">
                      {new Date(c.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <EmptyState
              title="Terminal"
              body="Terminal execution with recorded exit codes arrives in Phase 3. The existing /api/litt/command route will be wrapped as a structured workspace tool."
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Mobile bottom sheet ──────────────────────────────────────────────────

type MobileSheetTab = "files" | "code" | "preview" | "canvas" | "terminal";

function MobileSheet({
  projectId,
  T,
}: {
  projectId: string;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<MobileSheetTab>("files");
  const tabs: { id: MobileSheetTab; label: string }[] = [
    { id: "files", label: "Files" },
    { id: "code", label: "Code" },
    { id: "preview", label: "Preview" },
    { id: "canvas", label: "Canvas" },
    { id: "terminal", label: "Terminal" },
  ];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-16 left-3 z-40 rounded-full border border-white/10 bg-black/80 px-3 py-1.5 text-[10px] font-bold text-white/70 backdrop-blur-xl md:hidden"
      >
        ▲ Work
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close work sheet"
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 flex h-[70dvh] flex-col rounded-t-2xl border-t md:hidden"
            style={{
              backgroundColor: "rgba(8,9,13,0.97)",
              borderColor: `${T.borderColor}30`,
            }}
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/20" />
            <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
              <div className="flex gap-1">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      tab === t.id
                        ? "bg-white/10 text-white"
                        : "text-white/40"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-white/40 hover:text-white/70"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {!projectId ? (
                <EmptyState
                  title="No project"
                  body="Select a project to view files, code, preview, canvas, and terminal."
                />
              ) : tab === "files" || tab === "code" || tab === "preview" ? (
                <EmptyState
                  title={tab === "files" ? "Files" : tab === "code" ? "Code" : "Preview"}
                  body="Use the desktop layout for full file/code/preview access. Mobile panes will be enriched in Phase 2+."
                />
              ) : tab === "canvas" ? (
                <EmptyState
                  title="Canvas"
                  body="Canvas artifacts from LiTT runs will appear here. No runs have been executed yet."
                />
              ) : (
                <EmptyState
                  title="Terminal"
                  body="Terminal execution arrives in Phase 3."
                />
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export default function CoderWorkspace() {
  const { resolvedColors: T } = useTheme();
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");

  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const response = await fetch("/api/studio-projects", { cache: "no-store" });
      const payload = (await response.json()) as ProjectListResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load projects");
      }
      const all = [...(payload.projects ?? []), ...(payload.legacyOnly ?? [])];
      setProjects(all);
      setProjectId((current) => current || all[0]?.id || "");
    } catch (loadError) {
      setProjectsError(
        loadError instanceof Error ? loadError.message : "Failed to load projects",
      );
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      {/* Top bar: Project | Run status | Model | Credits */}
      <ProjectBar
        projects={projects}
        projectId={projectId}
        onSelect={setProjectId}
        onRefresh={refreshProjects}
        loading={projectsLoading}
        T={T}
      />
      {projectsError && (
        <div
          className="shrink-0 border-b px-3 py-1 text-[10px] text-red-300"
          style={{ borderColor: `${T.borderColor}30` }}
        >
          {projectsError}
        </div>
      )}

      {/* Desktop layout: 2-col grid (left rail | right pane) */}
      <div className="grid min-h-0 min-w-0 flex-1 overflow-hidden md:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        {/* Left rail: conversation + plan/timeline + composer */}
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <LeftRail projectId={projectId} T={T} />
          <Composer T={T} />
        </div>

        {/* Right pane: Files | Code | Preview | Review */}
        <div
          className="hidden min-h-0 min-w-0 flex-col border-l md:flex"
          style={{ borderColor: `${T.borderColor}30` }}
        >
          <RightPane projectId={projectId} project={selectedProject} T={T} />
        </div>
      </div>

      {/* Bottom drawer: Canvas | Terminal (desktop only) */}
      <div className="hidden md:block">
        <BottomDrawer projectId={projectId} T={T} />
      </div>

      {/* Mobile work sheet */}
      <MobileSheet projectId={projectId} T={T} />
    </div>
  );
}
