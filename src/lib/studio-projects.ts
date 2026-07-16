import type { StudioFile } from "@/app/studio/studio-context";

export type StudioProject = {
  id: string;
  name: string;
  files: StudioFile[];
  activeFile: string;
  updatedAt: number;
  createdAt: number;
};

const LS_KEY = "litlabs-studio-projects";
const LS_ACTIVE = "litlabs-studio-active-project";

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function listProjectsLocal(): StudioProject[] {
  if (typeof window === "undefined") return [];
  return safeParse<StudioProject[]>(localStorage.getItem(LS_KEY), [])
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getActiveProjectIdLocal(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LS_ACTIVE);
}

export function setActiveProjectIdLocal(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(LS_ACTIVE, id);
  else localStorage.removeItem(LS_ACTIVE);
}

export function saveProjectLocal(project: StudioProject): StudioProject {
  if (typeof window === "undefined") return project;
  const all = listProjectsLocal().filter((p) => p.id !== project.id);
  const next = { ...project, updatedAt: Date.now() };
  all.unshift(next);
  // cap stored projects to keep localStorage healthy
  const capped = all.slice(0, 50);
  localStorage.setItem(LS_KEY, JSON.stringify(capped));
  return next;
}

export function deleteProjectLocal(id: string): void {
  if (typeof window === "undefined") return;
  const all = listProjectsLocal().filter((p) => p.id !== id);
  localStorage.setItem(LS_KEY, JSON.stringify(all));
  if (getActiveProjectIdLocal() === id) setActiveProjectIdLocal(null);
}

export function loadProjectLocal(id: string): StudioProject | null {
  return listProjectsLocal().find((p) => p.id === id) ?? null;
}

export function newProject(name = "Untitled Project", files?: StudioFile[]): StudioProject {
  const now = Date.now();
  return {
    id: uid(),
    name,
    files: files ?? [],
    activeFile: files && files.length > 0 ? files[0].name : "",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * NOTE: Remote sync via /api/studio/projects has been replaced by the
 * GitHub-backed studio_projects table. The old push/pull functions are
 * removed because the API now uses a different schema (uuid id, GitHub
 * fields, scan_summary). CodeTool uses local-first storage only.
 * GitHub-backed projects are managed via ProjectDrawer + /api/studio/projects.
 */
