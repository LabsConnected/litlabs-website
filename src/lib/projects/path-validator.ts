import "server-only";

/**
 * Shared server-only workspace path validator.
 *
 * Rejects:
 *   - absolute paths (POSIX and Windows)
 *   - Windows drive-letter paths (C:\, D:\, etc.)
 *   - UNC paths (\\server\share)
 *   - null bytes
 *   - .. segments (after normalization)
 *   - . as a mutation target (root)
 *   - empty mutation paths
 *   - root deletion
 *   - control characters (0x00-0x1F, 0x7F)
 *   - excessive path length (> 512 chars)
 *   - excessive write size (> 10 MB)
 *
 * This validator does NOT rely on terminal-server protection.
 * It normalizes into path segments and validates each segment.
 */

const MAX_PATH_LENGTH = 512;
const MAX_WRITE_BYTES = 10 * 1024 * 1024; // 10 MB

export type PathValidationCode =
  | "EMPTY_PATH"
  | "ABSOLUTE_PATH"
  | "DRIVE_LETTER"
  | "UNC_PATH"
  | "NULL_BYTE"
  | "TRAVERSAL"
  | "ROOT_DELETE"
  | "CONTROL_CHAR"
  | "PATH_TOO_LONG"
  | "WRITE_TOO_LARGE"
  | "EMPTY_SEGMENT";

export class PathValidationError extends Error {
  code: PathValidationCode;
  constructor(code: PathValidationCode, message: string) {
    super(message);
    this.code = code;
    this.name = "PathValidationError";
  }
}

/**
 * Validate a file path for a workspace operation.
 *
 * @param inputPath - the raw path from the client
 * @param options - operation-specific options
 * @returns the normalized relative path (using forward slashes)
 * @throws PathValidationError if the path is invalid
 */
export function validateWorkspacePath(
  inputPath: string,
  options: { isDelete?: boolean; contentLength?: number } = {},
): string {
  const { isDelete = false, contentLength } = options;

  // 1. Empty path
  if (!inputPath || inputPath.trim() === "") {
    throw new PathValidationError("EMPTY_PATH", "Path is required");
  }

  // 2. Path length
  if (inputPath.length > MAX_PATH_LENGTH) {
    throw new PathValidationError("PATH_TOO_LONG", `Path exceeds ${MAX_PATH_LENGTH} characters`);
  }

  // 3. Null bytes
  if (inputPath.includes("\0")) {
    throw new PathValidationError("NULL_BYTE", "Path contains null bytes");
  }

  // 4. Control characters (0x00-0x1F except tab/newline in content, 0x7F)
  // We check the path itself, not content
  for (let i = 0; i < inputPath.length; i++) {
    const code = inputPath.charCodeAt(i);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
      throw new PathValidationError("CONTROL_CHAR", "Path contains control characters");
    }
  }

  // 5. Windows drive-letter paths (C:\, D:\, etc.)
  if (/^[a-zA-Z]:[\\/]/.test(inputPath)) {
    throw new PathValidationError("DRIVE_LETTER", "Absolute drive paths are not allowed");
  }

  // 6. UNC paths (\\server\share, //server/share)
  if (/^(\\\\|\/\/)/.test(inputPath)) {
    throw new PathValidationError("UNC_PATH", "UNC paths are not allowed");
  }

  // 7. POSIX absolute paths
  if (inputPath.startsWith("/")) {
    throw new PathValidationError("ABSOLUTE_PATH", "Absolute paths are not allowed");
  }

  // 8. Normalize separators: convert backslashes to forward slashes
  const normalized = inputPath.replace(/\\/g, "/");

  // 9. Special case: "." or "./" is valid for reads (root listing)
  //    but invalid for deletes (root deletion)
  if (normalized === "." || normalized === "./") {
    if (isDelete) {
      throw new PathValidationError("ROOT_DELETE", "Cannot delete workspace root");
    }
    return ".";
  }

  // 10. Split into segments and validate each
  //     Filter out empty segments and "." (current directory) segments
  const segments = normalized.split("/").filter((s) => s !== "" && s !== ".");

  if (segments.length === 0) {
    throw new PathValidationError("EMPTY_SEGMENT", "Path has no valid segments");
  }

  // 10. Check for .. traversal in any segment
  for (const segment of segments) {
    if (segment === "..") {
      throw new PathValidationError("TRAVERSAL", "Parent directory traversal is not allowed");
    }
    // Also check for encoded traversal attempts (both full-segment and embedded)
    // Decode URL-encoded segment to catch %2e%2e, %2f, %5c patterns
    const decoded = tryDecodeSegment(segment);
    if (decoded === ".." || decoded.includes("../") || decoded.includes("..\\")) {
      throw new PathValidationError("TRAVERSAL", "Encoded traversal is not allowed");
    }
    // Raw pattern check for undecodable encoded traversal
    if (/%2e%2e/i.test(segment) || /\.\.%2f/i.test(segment) || /\.\.%5c/i.test(segment)) {
      throw new PathValidationError("TRAVERSAL", "Encoded traversal is not allowed");
    }
  }

  // 11. Root deletion check
  if (isDelete && (normalized === "." || normalized === "./" || segments.length === 0)) {
    throw new PathValidationError("ROOT_DELETE", "Cannot delete workspace root");
  }

  // 12. Deleting current directory
  if (isDelete && normalized === ".") {
    throw new PathValidationError("ROOT_DELETE", "Cannot delete current directory");
  }

  // 13. Write size limit
  if (contentLength !== undefined && contentLength > MAX_WRITE_BYTES) {
    throw new PathValidationError(
      "WRITE_TOO_LARGE",
      `Write exceeds ${MAX_WRITE_BYTES} byte limit`,
    );
  }

  // Return the normalized relative path
  return segments.join("/");
}

/**
 * Check if a path is valid without throwing.
 */
export function isValidWorkspacePath(
  inputPath: string,
  options?: { isDelete?: boolean; contentLength?: number },
): boolean {
  try {
    validateWorkspacePath(inputPath, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the HTTP status code for a path validation error.
 */
export function pathErrorStatus(code: PathValidationCode): number {
  switch (code) {
    case "EMPTY_PATH":
    case "EMPTY_SEGMENT":
      return 400;
    case "ABSOLUTE_PATH":
    case "DRIVE_LETTER":
    case "UNC_PATH":
    case "NULL_BYTE":
    case "TRAVERSAL":
    case "ROOT_DELETE":
    case "CONTROL_CHAR":
      return 403;
    case "PATH_TOO_LONG":
    case "WRITE_TOO_LARGE":
      return 413;
    default:
      return 400;
  }
}

/**
 * Try to URL-decode a path segment.
 * Returns the original segment if decoding fails.
 */
function tryDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
