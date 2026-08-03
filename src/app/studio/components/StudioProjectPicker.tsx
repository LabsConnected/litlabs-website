"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Folder } from "lucide-react";
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
}: {
  projectId: string | null;
  projectName: string | null;
  onSelect: (projectId: string) => void;
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
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex max-w-[220px] items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold transition hover:bg-white/5" style={{ borderColor: "var(--studio-border)", color: "var(--text-secondary)", backgroundColor: "var(--studio-surface)" }} aria-expanded={open} aria-haspopup="listbox" title="Switch active project">
        <Folder size={12} className="shrink-0" style={{ color: "var(--litt-primary)" }} />
        <span className="max-w-[150px] truncate">{projectName ?? "Select project"}</span>
        <ChevronDown size={10} className="shrink-0" style={{ color: "var(--text-muted)" }} />
      </button>
      {open && <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border p-1.5 shadow-2xl" style={{ borderColor: "var(--studio-border-strong)", backgroundColor: "var(--studio-elevated)" }} role="listbox" aria-label="Projects">
        {loading ? <div className="px-2.5 py-3 text-[10px]" style={{ color: "var(--text-muted)" }}>Loading projects…</div> : error ? <div className="px-2.5 py-3 text-[10px]" style={{ color: "#fca5a5" }}>{error}</div> : projects.length === 0 ? <div className="px-2.5 py-3 text-[10px]" style={{ color: "var(--text-muted)" }}>No projects available.</div> : projects.map((project) => <button key={project.id} type="button" role="option" aria-selected={project.id === projectId} onClick={() => { onSelect(project.id); setOpen(false); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left transition hover:bg-white/8" style={{ color: project.id === projectId ? "var(--litt-primary)" : "var(--text-secondary)" }}><Folder size={12} className="shrink-0" /><span className="min-w-0 flex-1 truncate text-[10px] font-bold">{project.name}</span><span className="shrink-0 text-[8px] uppercase" style={{ color: "var(--text-muted)" }}>{project.sourceType ?? "project"}</span></button>)}
      </div>}
    </div>
  );
}
