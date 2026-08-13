import path from "node:path";
import type { ProjectInfo } from "./types.js";

/**
 * Resolve whether the current directory maps to a known LiTTree project.
 *
 * For now this is best-effort: we infer from the folder name and git remote.
 * The server is the source of truth for project membership — we only use
 * this for UX hints (showing the project name in the REPL header).
 */
export function resolveProject(cwd: string, gitRemote?: string): ProjectInfo {
  const folderName = path.basename(cwd);

  const repository = gitRemote ? extractRepoName(gitRemote) : folderName;

  return {
    projectId: null,
    projectName: repository || folderName,
    repository,
    branch: null,
  };
}

function extractRepoName(remote: string): string | null {
  let cleaned = remote.trim();
  if (cleaned.endsWith(".git")) cleaned = cleaned.slice(0, -4);

  // URL form: https://github.com/owner/repo or ssh://git@github.com/owner/repo
  const schemeMatch = cleaned.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^/]*)\/(.+)$/);
  if (schemeMatch && schemeMatch[1]) {
    const segments = schemeMatch[1].split("/").filter(Boolean);
    if (segments.length >= 2) return segments.slice(0, 2).join("/");
  }

  // scp-style: git@github.com:owner/repo
  const scpMatch = cleaned.match(/^[^@]+@[^:]+:(.+)$/);
  if (scpMatch && scpMatch[1]) {
    const segments = scpMatch[1].split("/").filter(Boolean);
    if (segments.length >= 2) return segments.slice(0, 2).join("/");
  }

  // Plain path fallback
  const segments = cleaned.split("/").filter(Boolean);
  if (segments.length >= 2) return segments.slice(-2).join("/");
  return null;
}