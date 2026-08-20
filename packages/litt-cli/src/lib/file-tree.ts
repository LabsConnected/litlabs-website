/**
 * FileTree — project file discovery for the @ context picker and /files.
 *
 * Iterative walk (no recursion depth issues), skips heavyweight/vendored
 * dirs, caps at a sane count so picker filtering stays instant. Returns
 * forward-slash relative paths for display + resolution.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".turbo", "dist", "build", "out",
  "coverage", ".cache", ".vercel", ".parcel-cache", ".svelte-kit",
  ".wrangler", ".terraform", "vendor", ".venv", "venv", "__pycache__",
  ".idea", ".vscode", ".DS_Store", "target", ".pnpm-store", ".pnpm",
]);

const MAX_FILES = 5000;

function isSkippedDir(name: string): boolean {
  return SKIP_DIRS.has(name);
}

/** Discover project files (relative paths, forward slashes). */
export function discoverFiles(root: string, cap = MAX_FILES): string[] {
  const out: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0 && out.length < cap) {
    const dir = stack.pop()!;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (out.length >= cap) break;
      const abs = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (!isSkippedDir(name)) stack.push(abs);
        continue;
      }
      // Skip hidden files (except a few useful ones).
      if (name.startsWith(".") && name !== ".env.example" && name !== ".gitignore" && name !== ".npmrc") continue;
      const rel = relative(root, abs).split(sep).join("/");
      if (rel.length > 0) out.push(rel);
    }
  }

  return out;
}
