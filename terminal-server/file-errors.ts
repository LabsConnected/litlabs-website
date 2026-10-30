/**
 * file-errors.ts — shared error → HTTP mapping for the file endpoints.
 *
 * Extracted from server.ts so the mapping is unit-testable without booting
 * the whole server. Behavior is identical to the inline versions:
 *   - exact path-validation messages → 400
 *   - "Forbidden" → 403, "Workspace not found" / "Path not found" → 404
 *   - ENOENT (code or message) → 404 with a clean, path-free message
 *   - everything else → 500
 */

export function isPathValidationError(msg: string): boolean {
  return (
    msg === "Invalid path" ||
    msg === "Path too long" ||
    msg === "Absolute or parent paths are not allowed" ||
    msg === "Path escapes workspace root" ||
    msg === "Symlink escapes workspace root"
  );
}

/** Map file-endpoint errors to HTTP status codes. */
export function fileErrorStatus(msg: string): number {
  if (msg === "Forbidden") return 403;
  if (msg === "Workspace not found" || msg === "Path not found") return 404;
  if (isPathValidationError(msg)) return 400;
  return 500;
}

/**
 * Build the {status,error} a file endpoint returns for `err`.
 * ENOENT is a routine missing-file/directory — 404 with a clean message,
 * never a 500 and never the raw stat path.
 */
export function fileErrorResponse(
  err: unknown,
  fallback: string,
  notFound = "File not found",
): { status: number; error: string } {
  const msg = err instanceof Error ? err.message : fallback;
  if (
    (err as { code?: string } | null)?.code === "ENOENT" ||
    msg.startsWith("ENOENT")
  ) {
    return { status: 404, error: notFound };
  }
  return { status: fileErrorStatus(msg), error: msg };
}
