"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Folder, Plus, Trash2 } from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { isManagedSourceType } from "@/lib/projects/project-source";

interface ProjectOption {
  id: string;
  name: string;
  sourceType?: string;
  githubBranch?: string | null;
  /**
   * Legacy-table projects merge into the same list, but the DELETE endpoint
   * only removes canonical studio_projects rows — the trash affordance is
   * hidden for legacy entries rather than offering a button that 404s.
   */
  legacy?: boolean;
}

export default function StudioProjectPicker({
  projectId,
  projectName,
  onSelect,
  onCreateProject,
  onDeleteProject,
}: {
  projectId: string | null;
  projectName: string | null;
  onSelect: (projectId: string) => void;
  onCreateProject?: () => void;
  /**
   * Fired only after the server confirms the deletion. The parent clears
   * the active project when it matches the deleted id.
   */
  onDeleteProject?: (projectId: string) => void;
}) {
  const { getToken } = useClerkAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

  const toggleOpen = () => {
    if (!open) {
      // Capture the trigger rect on open so the portaled menu can anchor
      // to the button. The menu is rendered via portal (below) because the
      // studio header scrolls horizontally on mobile (overflow-x: auto),
      // which clips any absolutely-positioned dropdown inside it.
      setTriggerRect(triggerRef.current?.getBoundingClientRect() ?? null);
    }
    setOpen((value) => !value);
  };

  // Dismiss the open menu on Escape, scroll, or resize — the anchored rect
  // goes stale otherwise, and mobile users must never be trapped.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open ]);

  useEffect(() => {
    if (!open || projects.length > 0) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const token = await getToken?.();
        const response = await fetch("/api/studio-projects", {
          cache: "no-store",
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          // A hung project list must not wedge the picker in "Loading" forever.
          signal: AbortSignal.timeout(15000),
        });
        const payload = await response.json().catch(() => null) as { projects?: ProjectOption[]; legacyOnly?: ProjectOption[]; error?: string } | null;
        if (!response.ok) throw new Error(payload?.error ?? `Failed to load projects (${response.status})`);
        if (!cancelled) setProjects([
          ...(payload?.projects ?? []).map((p) => ({ ...p, legacy: false })),
          ...(payload?.legacyOnly ?? []).map((p) => ({ ...p, legacy: true })),
        ]);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load projects");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getToken, open, projects.length]);

  /**
   * Delete a project through the canonical endpoint. The row is removed
   * from the list only after the server confirms success — the UI never
   * reports a deletion that did not happen.
   */
  const handleDeleteProject = async (project: ProjectOption) => {
    setDeletingId(project.id);
    setDeleteError(null);
    try {
      const token = await getToken?.();
      const response = await fetch(
        `/api/studio-projects/${encodeURIComponent(project.id)}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: AbortSignal.timeout(15000),
        },
      );
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? `Delete failed (${response.status})`);
      }
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      setConfirmDeleteId(null);
      onDeleteProject?.(project.id);
    } catch (deleteErr) {
      setDeleteError(deleteErr instanceof Error ? deleteErr.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-w-0 shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        className="flex w-full min-w-0 max-w-[200px] items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[12px] font-bold transition hover:bg-white/5 sm:max-w-[240px]"
        style={{ borderColor: "var(--studio-border)", color: "var(--text-secondary)", backgroundColor: "var(--studio-surface)" }}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Switch active project"
      >
        <Folder size={13} className="shrink-0" style={{ color: "var(--litt-primary)" }} />
        <span className="min-w-0 flex-1 truncate">{projectName ?? "Select project"}</span>
        <ChevronDown size={11} className="shrink-0" style={{ color: "var(--text-muted)" }} />
      </button>
      {open && (
        <>
          {/* Outside-click dismiss — the dropdown must not trap mobile users. */}
          <button
            type="button"
            aria-label="Close project list"
            className="fixed inset-0 z-40 cursor-default"
            style={{ background: "transparent" }}
            onClick={() => setOpen(false)}
          />
          {createPortal(
            <ProjectPickerMenu
              rect={triggerRect}
              loading={loading}
              error={error}
              projects={projects}
              projectId={projectId}
              confirmDeleteId={confirmDeleteId}
              deletingId={deletingId}
              deleteError={deleteError}
              onSelect={(id) => { onSelect(id); setOpen(false); }}
              onRequestDelete={(project) => { setConfirmDeleteId(project.id); setDeleteError(null); }}
              onCancelDelete={() => { setConfirmDeleteId(null); setDeleteError(null); }}
              onConfirmDelete={(project) => { void handleDeleteProject(project); }}
              onCreateProject={onCreateProject ? () => { setOpen(false); onCreateProject(); } : undefined}
            />,
            document.body,
          )}
        </>
      )}
    </div>
  );
}

/**
 * The project list menu, rendered via portal with fixed positioning.
 *
 * It must NOT be an absolutely-positioned child of the trigger: the studio
 * header scrolls horizontally on mobile (overflow-x: auto), and any overflow
 * other than visible on an ancestor clips absolute descendants — which is
 * why the dropdown was invisible on phones. Anchored to the trigger rect and
 * clamped to the viewport; dismissed on Escape/scroll/resize by the parent.
 */
function ProjectPickerMenu({
  rect,
  loading,
  error,
  projects,
  projectId,
  confirmDeleteId,
  deletingId,
  deleteError,
  onSelect,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onCreateProject,
}: {
  rect: DOMRect | null;
  loading: boolean;
  error: string | null;
  projects: ProjectOption[];
  projectId: string | null;
  confirmDeleteId: string | null;
  deletingId: string | null;
  deleteError: string | null;
  onSelect: (projectId: string) => void;
  onRequestDelete: (project: ProjectOption) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (project: ProjectOption) => void;
  onCreateProject?: () => void;
}) {
  const menuWidth = 256;
  const left = rect
    ? Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8))
    : 8;
  const top = rect
    ? Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 348))
    : 8;
  return (
    <div
      className="fixed z-[200] max-h-[min(60vh,320px)] w-[min(90vw,256px)] overflow-y-auto rounded-xl border p-1.5 shadow-2xl"
      style={{
        left,
        top,
        borderColor: "var(--studio-border-strong)",
        backgroundColor: "var(--studio-elevated)",
      }}
      role="listbox"
      aria-label="Projects"
      data-testid="project-picker-menu"
    >
      {loading ? (
        <div className="px-2.5 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}>Loading projects…</div>
      ) : error ? (
        <div className="px-2.5 py-3 text-[12px]" style={{ color: "#fca5a5" }}>{error}</div>
      ) : projects.length === 0 ? (
        <div className="px-2.5 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}>No projects available.</div>
      ) : (
        projects.map((project) => (
          confirmDeleteId === project.id ? (
            <div
              key={project.id}
              className="rounded-lg border p-2.5"
              style={{ borderColor: "#ef444440", backgroundColor: "#ef444408" }}
              role="alertdialog"
              aria-label={`Confirm deletion of ${project.name}`}
            >
              <div className="text-[12px] font-black" style={{ color: "var(--text-primary)" }}>
                Delete &ldquo;{project.name}&rdquo;?
              </div>
              <div className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                This permanently deletes the project and its files. This can&rsquo;t be undone.
              </div>
              {deleteError && deletingId === null && (
                <div className="mt-1.5 text-[11px] font-bold" style={{ color: "#fca5a5" }}>
                  {deleteError}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCancelDelete}
                  disabled={deletingId === project.id}
                  className="rounded-lg border px-2.5 py-1 text-[11px] font-bold transition hover:bg-white/8 disabled:opacity-50"
                  style={{ borderColor: "var(--studio-border)", color: "var(--text-secondary)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => onConfirmDelete(project)}
                  disabled={deletingId === project.id}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-black text-white transition hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: "#dc2626" }}
                >
                  {deletingId === project.id ? "Deleting…" : "Delete project"}
                </button>
              </div>
            </div>
          ) : (
            <div
              key={project.id}
              role="option"
              aria-selected={project.id === projectId}
              className="group flex w-full items-center gap-1 rounded-lg transition hover:bg-white/8"
            >
              <button
                type="button"
                onClick={() => onSelect(project.id)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left"
                style={{ color: project.id === projectId ? "var(--litt-primary)" : "var(--text-secondary)" }}
              >
                <Folder size={13} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold">{project.name}</span>
                <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>{isManagedSourceType(project.sourceType ?? null) ? "LiTT Managed" : "GitHub"}</span>
              </button>
              {!project.legacy && (
                <button
                  type="button"
                  onClick={() => onRequestDelete(project)}
                  aria-label={`Delete project ${project.name}`}
                  title={`Delete project ${project.name}`}
                  className="mr-1 shrink-0 rounded-md p-1.5 opacity-60 transition hover:bg-white/10 hover:opacity-100 focus-visible:opacity-100"
                  style={{ color: "#fca5a5" }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )
        ))
      )}
      {onCreateProject && !loading && !error && (
        <>
          <div className="mx-1 my-1 h-px" style={{ backgroundColor: "var(--studio-border)" }} />
          <button
            type="button"
            onClick={onCreateProject}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition hover:bg-white/8"
            style={{ color: "var(--litt-primary)" }}
          >
            <Plus size={13} className="shrink-0" />
            <span className="text-[12px] font-bold">New project</span>
          </button>
        </>
      )}
    </div>
  );
}
