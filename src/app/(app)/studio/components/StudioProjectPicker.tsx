"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Folder, GitBranch, Plus, Upload } from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";

interface ProjectOption {
  id: string;
  name: string;
  sourceType?: string;
  githubBranch?: string | null;
}

export default function StudioProjectPicker({
  projectId,
  projectName,
  onSelect,
  onStartBlank,
  onConnectRepo,
}: {
  projectId: string | null;
  projectName: string | null;
  onSelect: (projectId: string) => void;
  onStartBlank?: () => void;
  onConnectRepo?: () => void;
}) {
  const { getToken } = useClerkAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || projects.length > 0) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const token = await getToken?.();
        const response = await fetch("/api/studio-projects", { cache: "no-store", credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const payload = await response.json().catch(() => null) as { projects?: ProjectOption[]; legacyOnly?: ProjectOption[]; error?: string } | null;
        if (!response.ok) throw new Error(payload?.error ?? `Failed to load projects (${response.status})`);
        if (!cancelled) setProjects([...(payload?.projects ?? []), ...(payload?.legacyOnly ?? [])]);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load projects");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getToken, open, projects.length]);

  return (
    <div className="relative hidden sm:block">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-w-[120px] max-w-[240px] items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[12px] font-bold transition hover:bg-white/5" style={{ borderColor: "var(--studio-border)", color: "var(--text-secondary)", backgroundColor: "var(--studio-surface)" }} aria-expanded={open} aria-haspopup="listbox" title="Switch active project">
        <Folder size={13} className="shrink-0" style={{ color: "var(--litt-primary)" }} />
        <span className="min-w-0 flex-1 truncate">{projectName ?? "Select project"}</span>
        <ChevronDown size={11} className="shrink-0" style={{ color: "var(--text-muted)" }} />
      </button>
      {open && <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border p-1.5 shadow-2xl" style={{ borderColor: "var(--studio-border-strong)", backgroundColor: "var(--studio-elevated)" }} role="listbox" aria-label="Projects">
        {loading ? (
          <div className="px-2.5 py-3 text-[12px]" style={{ color: "var(--text-muted)" }}>Loading projects…</div>
        ) : error ? (
          <div className="px-2.5 py-3 text-[12px]" style={{ color: "#fca5a5" }}>{error}</div>
        ) : projects.length === 0 ? (
          <div className="py-1.5">
            <div className="px-2.5 py-2 text-[12px] font-bold" style={{ color: "var(--text-secondary)" }}>No projects yet</div>
            <div className="mt-1 space-y-0.5">
              {onConnectRepo && (
                <button type="button" onClick={() => { onConnectRepo(); setOpen(false); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition hover:bg-white/8" style={{ color: "var(--text-secondary)" }}>
                  <GitBranch size={13} className="shrink-0" style={{ color: "var(--litt-primary)" }} />
                  <span className="flex-1 text-[12px] font-bold">Connect GitHub</span>
                </button>
              )}
              {onStartBlank && (
                <button type="button" onClick={() => { onStartBlank(); setOpen(false); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition hover:bg-white/8" style={{ color: "var(--text-secondary)" }}>
                  <Plus size={13} className="shrink-0" style={{ color: "var(--litt-primary)" }} />
                  <span className="flex-1 text-[12px] font-bold">Start blank project</span>
                </button>
              )}
              <button type="button" disabled className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left opacity-50" style={{ color: "var(--text-muted)" }}>
                <Upload size={13} className="shrink-0" />
                <span className="flex-1 text-[12px] font-bold">Upload project (soon)</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {projects.map((project) => (
              <button key={project.id} type="button" role="option" aria-selected={project.id === projectId} onClick={() => { onSelect(project.id); setOpen(false); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition hover:bg-white/8" style={{ color: project.id === projectId ? "var(--litt-primary)" : "var(--text-secondary)" }}>
                <Folder size={13} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold">{project.name}</span>
                <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>{project.sourceType ?? "project"}</span>
              </button>
            ))}
            {(onStartBlank || onConnectRepo) && (
              <div className="mt-1 border-t pt-1" style={{ borderColor: "var(--studio-border)" }}>
                {onConnectRepo && (
                  <button type="button" onClick={() => { onConnectRepo(); setOpen(false); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition hover:bg-white/8" style={{ color: "var(--text-secondary)" }}>
                    <GitBranch size={13} className="shrink-0" style={{ color: "var(--litt-primary)" }} />
                    <span className="flex-1 text-[12px] font-bold">Connect GitHub</span>
                  </button>
                )}
                {onStartBlank && (
                  <button type="button" onClick={() => { onStartBlank(); setOpen(false); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition hover:bg-white/8" style={{ color: "var(--text-secondary)" }}>
                    <Plus size={13} className="shrink-0" style={{ color: "var(--litt-primary)" }} />
                    <span className="flex-1 text-[12px] font-bold">Start blank project</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>}
    </div>
  );
}
