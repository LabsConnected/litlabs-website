/**
 * User-project deployment — pure domain rules.
 *
 * This is the deployment of the USER'S generated project (an Ember Roast
 * landing site, say), which is a different thing from every existing
 * "deploy" in this repo:
 *
 *   /api/deploy/trigger   → redeploys LiTT's OWN Railway service, admin-only
 *   `deployments` table   → LiTT's own CI/CD pipeline tracking (branch/SHA)
 *   `project.ship` (CLI)  → git shipping: branch, commit, push, PR
 *   preview proxy         → a live dev process behind LiTT's auth
 *
 * None of those produce a public URL for a user's project, so this module
 * and its service layer add that capability.
 *
 * Deployment and preview are INDEPENDENT. There is deliberately no mapping
 * from preview state to deployment state: a ready preview means a dev
 * process answered behind auth, which says nothing about whether anything
 * was published. Keeping the two apart is what stops "preview ready" from
 * being reported as "deployed live".
 *
 * No I/O here — validation, path safety, content types and state
 * transitions only, so every rule is unit-testable without a provider.
 */

/** Deployment lifecycle. `ready` requires a verified public URL. */
export type DeploymentStatus =
  | "not_started"
  | "building"
  | "deploying"
  | "ready"
  | "failed";

/**
 * Preview lifecycle — a SEPARATE field from DeploymentStatus.
 * `unreachable` is preview-specific: the process exists but does not answer.
 */
export type PreviewStatus =
  | "not_started"
  | "starting"
  | "ready"
  | "unreachable"
  | "failed";

/** One file in a deployable artifact. */
export interface ArtifactFile {
  path: string;
  content: string;
}

/**
 * Hard caps. A V1 deployment is a small static site; these bounds keep a
 * runaway workspace from turning a deploy into a denial-of-service against
 * our own storage.
 */
export const DEPLOYMENT_LIMITS = {
  maxFiles: 200,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxPathLength: 400,
} as const;

/** Extensions a static deployment may serve, with their content types. */
const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  webmanifest: "application/manifest+json",
};

/**
 * Content type for a path.
 *
 * Unknown extensions fall back to application/octet-stream — never
 * text/html, which would turn an arbitrary file into a script-execution
 * vector on the deployment's own origin.
 */
export function contentTypeFor(path: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  if (!match) return "application/octet-stream";
  return CONTENT_TYPES[match[1].toLowerCase()] ?? "application/octet-stream";
}

/**
 * Whether a path may appear in an artifact.
 *
 * Rejects traversal, absolute paths, backslashes, control characters and
 * dotfiles. Dotfiles are excluded outright: `.env`, `.git/config` and
 * `.npmrc` in a workspace hold credentials, and a deployment is public.
 */
export function isSafeArtifactPath(path: string): boolean {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > DEPLOYMENT_LIMITS.maxPathLength) return false;

  // Control characters (incl. NUL and newlines) and backslashes.
  if (/[\u0000-\u001F\u007F\\]/.test(path)) return false;

  // Absolute paths, UNC paths and Windows drive letters.
  if (path.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(path)) return false;

  const segments = path.split("/");
  for (const segment of segments) {
    // No empty segments (blocks "a//b"), no "." or ".." anywhere.
    if (segment.length === 0) return false;
    if (segment === "." || segment === "..") return false;
    // No dotfiles at any depth.
    if (segment.startsWith(".")) return false;
  }
  return true;
}

export type ArtifactValidation =
  | { ok: true; files: ArtifactFile[]; totalBytes: number }
  | { ok: false; error: string };

/**
 * Validate a collected artifact before anything is persisted or published.
 *
 * Requires an index.html entrypoint: without one there is nothing to serve
 * at the deployment root, and reporting such a deploy as "live" would be
 * another false completion.
 */
export function validateArtifact(files: ArtifactFile[]): ArtifactValidation {
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, error: "Deployment artifact contains no files." };
  }
  if (files.length > DEPLOYMENT_LIMITS.maxFiles) {
    return {
      ok: false,
      error: `Deployment artifact has too many files (${files.length} > ${DEPLOYMENT_LIMITS.maxFiles}).`,
    };
  }

  const seen = new Set<string>();
  let totalBytes = 0;

  for (const file of files) {
    if (!isSafeArtifactPath(file.path)) {
      return { ok: false, error: `Unsafe artifact path rejected: "${file.path}".` };
    }
    if (seen.has(file.path)) {
      return { ok: false, error: `Duplicate artifact path: "${file.path}".` };
    }
    seen.add(file.path);

    const bytes = Buffer.byteLength(file.content ?? "", "utf8");
    if (bytes > DEPLOYMENT_LIMITS.maxFileBytes) {
      return {
        ok: false,
        error: `File "${file.path}" is too large (${bytes} > ${DEPLOYMENT_LIMITS.maxFileBytes} bytes).`,
      };
    }
    totalBytes += bytes;
  }

  if (totalBytes > DEPLOYMENT_LIMITS.maxTotalBytes) {
    return {
      ok: false,
      error: `Deployment artifact is too large (${totalBytes} > ${DEPLOYMENT_LIMITS.maxTotalBytes} bytes).`,
    };
  }
  if (!seen.has("index.html")) {
    return { ok: false, error: "Deployment artifact must contain an index.html entrypoint." };
  }

  return { ok: true, files, totalBytes };
}

/** Allowed deployment transitions. `ready` is only reachable from `deploying`. */
const DEPLOYMENT_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  not_started: ["building", "failed"],
  building: ["deploying", "failed"],
  deploying: ["ready", "failed"],
  ready: [],
  failed: [],
};

export function isDeploymentTerminal(status: DeploymentStatus): boolean {
  return status === "ready" || status === "failed";
}

/**
 * Whether a deployment may move between two states.
 *
 * `ready` cannot be reached from `not_started` or `building`: a deployment
 * that never went through `deploying` did not deploy, and marking it ready
 * would be the same class of lie as the work log claiming a completed step
 * for a conversational reply.
 */
export function isDeploymentTransitionValid(
  from: DeploymentStatus,
  to: DeploymentStatus,
): boolean {
  return DEPLOYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Resolve a public request path to an artifact path.
 *
 * Returns null when the request escapes the deployment. Decoding happens
 * first so percent-encoded traversal ("..%2f..") is caught too.
 */
export function deploymentPublicPath(_deploymentId: string, requestPath: string): string | null {
  let decoded = requestPath ?? "";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  // Strip a single leading slash, then treat "" as the site root.
  const trimmed = decoded.replace(/^\/+/, "");
  if (trimmed === "") return "index.html";
  if (!isSafeArtifactPath(trimmed)) return null;
  return trimmed;
}

/** A failure safe to hand to the model and the client. */
export interface DescribedFailure {
  errorClass: string;
  message: string;
  retryable: boolean;
}

/** Patterns whose matches must never reach a model, a client, or a log. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{8,}/gi,
  /\b(?:token|secret|password|api[-_]?key|authorization)\s*[=:]\s*\S+/gi,
  /\bBearer\s+\S+/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

/** Remove anything credential-shaped from a message. */
function redact(message: string): string {
  let safe = message;
  for (const pattern of SECRET_PATTERNS) {
    safe = safe.replace(pattern, "[redacted]");
  }
  return safe;
}

/**
 * Classify a deployment failure into something safe and truthful.
 *
 * Never returns provider credentials, and never claims a deployment
 * succeeded or is retryable when it is not.
 */
export function describeDeploymentFailure(error: unknown): DescribedFailure {
  const raw = error instanceof Error ? error.message : String(error);
  const safe = redact(raw);

  // Validation and authorization failures will fail again identically.
  if (/required|must contain|unsafe|duplicate|too large|too many|not found|forbidden|mismatch/i.test(raw)) {
    return {
      errorClass: /forbidden|not found|mismatch/i.test(raw) ? "authorization" : "validation",
      message: safe,
      retryable: false,
    };
  }
  // Transport/provider problems may succeed on a retry.
  if (/fetch failed|ECONNREFUSED|ETIMEDOUT|socket hang up|network|timeout|502|503|504/i.test(raw)) {
    return { errorClass: "transport", message: safe, retryable: true };
  }
  return { errorClass: "unknown", message: safe, retryable: false };
}
