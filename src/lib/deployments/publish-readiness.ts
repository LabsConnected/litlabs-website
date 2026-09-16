/**
 * Publish-readiness checks — UI-side early warnings for the static-only
 * publish pipeline.
 *
 * `validateArtifact` (user-deployment.ts) rejects non-static or oversized
 * artifacts *after* the whole approve flow. These checks mirror its rules
 * using only workspace metadata (no file contents), so the builder UI can
 * warn before the user starts the deploy approval flow.
 *
 * This module is pure (no I/O) and safe to unit test. It must NOT change
 * deploy-service.ts — the deploy pipeline is another worker's area.
 */

import {
  DEPLOYMENT_LIMITS,
  contentTypeFor,
  isSafeArtifactPath,
} from "./user-deployment";

export type PublishReadinessCode =
  | "missing-index"
  | "too-many-files"
  | "framework-app"
  | "build-output-present"
  | "media-heavy";

export interface PublishReadinessWarning {
  code: PublishReadinessCode;
  message: string;
}

/**
 * What the readiness endpoint observed in the workspace.
 * All paths are workspace-relative, forward-slash separated.
 */
export interface WorkspaceInventory {
  /** Publishable relative paths (after exclusion rules). */
  files: string[];
  /** True when an index.html exists at the workspace root. */
  hasIndexHtml: boolean;
  /** Detected framework (e.g. "Next.js"), or null. */
  framework: string | null;
  /** Build-output directory names found at the root (e.g. ".next"). */
  buildOutputDirs: string[];
  /** Number of image/video/audio files among publishable files. */
  mediaFileCount: number;
  /** True when the workspace walk hit its entry cap (counts are lower bounds). */
  truncated: boolean;
}

/**
 * Directories the deploy pipeline never publishes.
 * MUST mirror EXCLUDED_NAMES in deploy-service.ts — that file is the
 * authority; this list only exists so the UI can predict its outcome.
 */
export const PUBLISH_EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".vercel",
  ".turbo",
  "coverage",
  ".cache",
]);

const MEDIA_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "ico",
  "mp4", "webm", "mov", "m4v",
  "mp3", "wav", "ogg", "m4a",
]);

const FRAMEWORK_DEPS: Array<{ dep: string; name: string }> = [
  { dep: "next", name: "Next.js" },
  { dep: "nuxt", name: "Nuxt" },
  { dep: "@nuxt/kit", name: "Nuxt" },
  { dep: "gatsby", name: "Gatsby" },
  { dep: "astro", name: "Astro" },
  { dep: "@remix-run/react", name: "Remix" },
  { dep: "vite", name: "Vite" },
  { dep: "react", name: "React" },
  { dep: "react-dom", name: "React" },
];

/** Mirrors the deploy pipeline's file filter (collectStaticArtifact). */
export function isPublishablePath(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((s) => PUBLISH_EXCLUDED_DIRS.has(s))) return false;
  if (!isSafeArtifactPath(path)) return false;
  if (contentTypeFor(path) === "application/octet-stream") return false;
  return true;
}

export function isMediaPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_EXTENSIONS.has(ext);
}

/**
 * Detect a JS framework from package.json dependency names.
 * Returns the display name of the first match, or null.
 */
export function detectFramework(depNames: string[] | null | undefined): string | null {
  if (!depNames || depNames.length === 0) return null;
  const lower = new Set(depNames.map((d) => d.toLowerCase()));
  for (const { dep, name } of FRAMEWORK_DEPS) {
    if (lower.has(dep)) return name;
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Build the early warnings for a workspace inventory.
 * Pure — unit test this, not the endpoint.
 */
export function checkPublishReadiness(inv: WorkspaceInventory): PublishReadinessWarning[] {
  const warnings: PublishReadinessWarning[] = [];
  const { maxFiles, maxTotalBytes } = DEPLOYMENT_LIMITS;

  if (!inv.hasIndexHtml) {
    warnings.push({
      code: "missing-index",
      message:
        "No index.html at the workspace root — publish requires one, so deploying now would fail validation.",
    });
  }

  if (inv.files.length > maxFiles || (inv.truncated && inv.files.length >= maxFiles)) {
    const count = inv.truncated ? `${maxFiles}+` : `${inv.files.length}`;
    warnings.push({
      code: "too-many-files",
      message: `This project has ${count} publishable files, but publish caps at ${maxFiles}. Trim files before deploying.`,
    });
  }

  if (inv.framework) {
    warnings.push({
      code: "framework-app",
      message:
        `This looks like a ${inv.framework} app. Publish serves static files only — ` +
        `framework build output is never published. Export a static site (with an index.html at the root) before deploying.`,
    });
  } else if (inv.buildOutputDirs.length > 0) {
    warnings.push({
      code: "build-output-present",
      message:
        `Found build output directories (${inv.buildOutputDirs.join(", ")}) — these are never published. ` +
        `If the site only exists as framework build output, publish will fail; export static files instead.`,
    });
  }

  if (inv.mediaFileCount >= 20) {
    warnings.push({
      code: "media-heavy",
      message:
        `${inv.mediaFileCount} media files detected — publish caps total size at ${formatBytes(maxTotalBytes)}. ` +
        `Large media may fail validation; compress or trim first.`,
    });
  }

  return warnings;
}
