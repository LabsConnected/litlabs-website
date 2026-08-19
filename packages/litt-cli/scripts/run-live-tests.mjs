/**
 * Cross-platform launcher for live acceptance tests.
 *
 * Sets LITT_RUN_LIVE_TESTS=1 and runs Vitest against the live-* test files.
 * Works on Windows PowerShell/cmd and Linux/WSL without cross-env.
 *
 * Does NOT set or print OPENROUTER_API_KEY — the tests read it themselves.
 *
 * Network-isolation guarantee: this launcher resolves the locally-installed
 * Vitest binary directly (no `npx`, no `pnpm exec`). It will NEVER download
 * a package — if Vitest is not installed, it fails immediately. This keeps
 * the "Can download packages: NO" property unambiguous across the entire
 * live-test path, matching the TypeScript compiler path.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

process.env.LITT_RUN_LIVE_TESTS = "1";

// Resolve the locally-installed Vitest binary.
// Priority:
//   1. <pkgRoot>/node_modules/vitest/vitest.mjs  (direct JS entry — no shell needed)
//   2. <pkgRoot>/node_modules/vitest/dist/cli.js  (fallback JS entry)
//   3. <pkgRoot>/node_modules/.bin/vitest  (Windows: vitest.CMD; Unix: bare shim)
//
// We do NOT use `npx` or `pnpm exec` — those can potentially fetch a
// missing executable depending on environment/config. This launcher
// must never download anything.
//
// The direct JS entry (via `node <path>`) is preferred because it needs
// no shell wrapper. The .bin shims are a fallback (Windows .CMD shims
// require shell: true to spawn, which is a local process spawn, not a
// download — but the direct JS entry avoids even that ambiguity).
function resolveVitestBinary() {
  // Direct JS entry (works on all platforms via `node`) — preferred
  const directMjs = path.join(pkgRoot, "node_modules", "vitest", "vitest.mjs");
  if (fs.existsSync(directMjs)) return { cmd: process.execPath, args: [directMjs], isShell: false };

  const directCli = path.join(pkgRoot, "node_modules", "vitest", "dist", "cli.js");
  if (fs.existsSync(directCli)) return { cmd: process.execPath, args: [directCli], isShell: false };

  // Fallback: .bin shims
  const binDir = path.join(pkgRoot, "node_modules", ".bin");

  // Windows: .CMD shims require shell: true to spawn
  if (process.platform === "win32") {
    const cmdShim = path.join(binDir, "vitest.CMD");
    if (fs.existsSync(cmdShim)) return { cmd: cmdShim, args: [], isShell: true };
    const psShim = path.join(binDir, "vitest.ps1");
    if (fs.existsSync(psShim)) return { cmd: psShim, args: [], isShell: true };
  }

  // Unix-like: the bare shim
  const bareShim = path.join(binDir, "vitest");
  if (fs.existsSync(bareShim)) return { cmd: bareShim, args: [], isShell: false };

  return null;
}

const resolved = resolveVitestBinary();
if (!resolved) {
  console.error(
    "[run-live-tests] Vitest is not installed locally. " +
    "Run `pnpm install` first. This launcher will NOT download packages."
  );
  process.exit(1);
}

const child = spawn(
  resolved.cmd,
  [...resolved.args, "run", "src/__tests__/live-"],
  {
    cwd: pkgRoot,
    stdio: "inherit",
    env: process.env,
    shell: resolved.isShell,
  },
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
