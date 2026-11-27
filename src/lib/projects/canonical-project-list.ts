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
  /** Present only on legacy-table rows; canonical rows take precedence on duplicate ids. */
  isLegacyOnly?: boolean;
  sourceType?: string;
  githubFullName?: string | null;
  githubBranch?: string | null;
  workspaceStatus?: string;
  runtimeStatus?: string;
  updatedAt?: string;
  workspaceError?: string | null;
  runtimeError?: string | null;
};

export type StudioProjectsPayload<T extends { id: string } = CanonicalListProject> = {
  projects?: T[];
  legacyOnly?: T[];
};

/**
 * Merge canonical and legacy rows, preserving the canonical copy when an
 * id appears in both lists. The marker lets UI callers with narrower
 * backend contracts hide actions unavailable for legacy-only records.
 */
export function mergeCanonicalProjectList<T extends { id: string } = CanonicalListProject>(
  data: StudioProjectsPayload<T> | null | undefined,
): Array<T & { isLegacyOnly?: boolean }> {
  if (!data || typeof data !== "object") return [];
  const canonical = Array.isArray(data.projects) ? data.projects : [];
  const legacy = Array.isArray(data.legacyOnly) ? data.legacyOnly : [];
  const seen = new Set<string>();
  const out: Array<T & { isLegacyOnly?: boolean }> = [];

  const append = (rows: T[], isLegacyOnly: boolean) => {
    for (const project of rows) {
      if (!project || typeof project.id !== "string" || !project.id) continue;
      if (seen.has(project.id)) continue;
      seen.add(project.id);
      out.push(isLegacyOnly ? { ...project, isLegacyOnly: true } : project);
    }
  };

  append(canonical, false);
  append(legacy, true);
  return out;
}

export function studioProjectHref(projectId: string): string {
  return `/studio?project=${encodeURIComponent(projectId)}`;
}
