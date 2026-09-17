/**
 * Workspace paths are deliberately relative to the managed workspace root.
 * Rejecting absolute and parent paths here keeps every tool entry point on
 * the same fail-closed contract as terminal-server.
 */
export function normalizeWorkspaceRelativePath(
  value: unknown,
  options: { defaultToRoot?: boolean } = {},
): { path: string } | { error: string } {
  if (typeof value !== "string") {
    if (options.defaultToRoot) return { path: "." };
    return { error: "path is required" };
  }

  const raw = value.trim();
  if (!raw && options.defaultToRoot) return { path: "." };
  if (!raw) return { error: "path must not be empty" };

  const normalized = raw.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")) {
    return { error: `absolute paths are not allowed: ${JSON.stringify(value)}` };
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    return { error: `parent paths are not allowed: ${JSON.stringify(value)}` };
  }

  const result = segments.filter((segment) => segment !== "").join("/");
  return { path: result || "." };
}

export function workspacePathError(value: unknown, field = "path"): string | null {
  const result = normalizeWorkspaceRelativePath(value);
  return "error" in result ? `${field} must be workspace-relative: ${result.error}` : null;
}
