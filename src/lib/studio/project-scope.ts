/** Shared client/server scope predicates for project-owned Studio records. */

export interface ProjectScopedRecord {
  projectId?: string | null;
}
/**
 * Project surfaces must only render records explicitly owned by that project.
 * Unbound records belong in a separately-labelled account-wide Library, never
 * in a project's working surface.
 */
export function filterProjectScopedRecords<T extends ProjectScopedRecord>(
  records: readonly T[],
  projectId: string | null | undefined,
): T[] {
  if (!projectId) return [];
  return records.filter((record) => record.projectId === projectId);
}
