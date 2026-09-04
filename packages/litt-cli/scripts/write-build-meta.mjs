/**
 * write-build-meta.mjs — P0-9: Stale Build Detection.
 *
 * Post-build step: records the source git SHA + version into
 * dist/.build-meta.json so the CLI can detect stale builds.
 *
 * Called by: pnpm build (after tsc)
 */

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const distDir = join(pkgRoot, "dist");

// Read version from package.json
let version = "unknown";
try {
  const pkgJson = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
  version = pkgJson.version ?? "unknown";
} catch { /* ignore */ }

// Get the source git SHA
let sourceSha = "unknown";
try {
  sourceSha = execSync("git rev-parse HEAD", {
    cwd: pkgRoot,
    encoding: "utf8",
    timeout: 5000,
  }).trim();
} catch { /* not a git repo or git missing */ }

// Write the build metadata
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

const meta = {
  sourceSha,
  builtAt: new Date().toISOString(),
  version,
  nodeVersion: process.version,
};

writeFileSync(join(distDir, ".build-meta.json"), JSON.stringify(meta, null, 2), "utf8");
console.log(`[build-meta] sourceSha: ${sourceSha.slice(0, 8)}  version: ${version}  → dist/.build-meta.json`);
