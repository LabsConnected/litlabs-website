/**
 * Shared parse of GET /api/studio-projects.
 *
 * Dashboard, Profile, and /projects must show the same rows. The API
 * returns `{ projects, legacyOnly }`; callers that only read `projects`
 * silently drop legacy-only work, and callers that never hit this
 * endpoint (mission-control) drop first-run studio projects.
 */

export const STUDIO_PROJECTS_API = "/api/studio-projects";

export type CanonicalListProject = {
  id: string;
  name: string;
  sourceType?: string;
  githubFullName?: string | null;
  githubBranch?: string | null;
  workspaceStatus?: string;
  runtimeStatus?: string;
  updatedAt?: string;
  workspaceError?: string | null;
  runtimeError?: string | null;
};

export type StudioProjectsPayload = {
  projects?: CanonicalListProject[];
  legacyOnly?: CanonicalListProject[];
};

export function mergeCanonicalProjectList(
  data: StudioProjectsPayload | null | undefined,
): CanonicalListProject[] {
  if (!data || typeof data !== "object") return [];
  const canonical = Array.isArray(data.projects) ? data.projects : [];
  const legacy = Array.isArray(data.legacyOnly) ? data.legacyOnly : [];
  const seen = new Set<string>();
  const out: CanonicalListProject[] = [];
  for (const project of [...canonical, ...legacy]) {
    if (!project || typeof project.id !== "string" || !project.id) continue;
    if (seen.has(project.id)) continue;
    seen.add(project.id);
    out.push(project);
  }
  return out;
}

export function studioProjectHref(projectId: string): string {
  return `/studio?project=${encodeURIComponent(projectId)}`;
}
