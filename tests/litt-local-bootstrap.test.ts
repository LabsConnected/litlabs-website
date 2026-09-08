/**
 * Regression: a brand-new git worktree has no node_modules (no tsx
 * binary) and no built dist/ output for the workspace packages
 * litt-cli imports at runtime (@litt/models, @litt/agent-core).
 *
 * Before this fix, `litt-local` failed through these one at a time:
 *   1. "spawn tsx ENOENT"                          (no node_modules)
 *   2. "Cannot find @litt/models/dist/index.js"     (after manual install)
 *   3. "Cannot find @litt/agent-core/dist/index.js" (after manual build of
 *                                                     just @litt/models)
 *
 * The verified manual fix was:
 *   pnpm install --frozen-lockfile
 *   pnpm --filter '@litlabs/litt-cli...' build
 *
 * scripts/termux/bin/litt-local now runs this automatically on
 * startup via litt_local_bootstrap(), but only when something is
 * actually missing or stale — an already-bootstrapped worktree must
 * not pay any install/build cost.
 *
 * These tests exercise the bootstrap functions directly via bash
 * subprocesses against fake worktree directory trees (no real pnpm
 * install/build, no real network) — sourcing the script only defines
 * the functions (see the BASH_SOURCE/$0 guard at the bottom of the
 * script), it does not launch LiTT.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const litTLocalPath = path.join(repoRoot, "scripts/termux/bin/litt-local");

const BUILD_PACKAGES = ["litt-models", "litt-agent-core"];

/** Scaffolds a fake worktree with only the pieces litt-local inspects. */
function makeFakeWorktree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litt-fake-worktree-"));
  for (const pkg of BUILD_PACKAGES) {
    fs.mkdirSync(path.join(root, "packages", pkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "packages", pkg, "src", "index.ts"), "export {};\n");
  }
  return root;
}

function markInstalled(root: string): void {
  const binDir = path.join(root, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });
  const tsx = path.join(binDir, "tsx");
  fs.writeFileSync(tsx, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(tsx, 0o755);
}

function markBuilt(root: string): void {
  for (const pkg of BUILD_PACKAGES) {
    const distDir = path.join(root, "packages", pkg, "dist");
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, "index.js"), "module.exports = {};\n");
  }
}

/** A fake `pnpm` on PATH that records every invocation and exits with a
 * fixed code, so tests never run a real install/build. `install` and
 * `build` sub-invocations also apply the fake worktree's "installed" /
 * "built" side effects, so a full bootstrap() run through both steps
 * behaves like the real thing. */
function makeFakePnpm(binDir: string, logFile: string, opts: { exitCode?: number } = {}): void {
  fs.mkdirSync(binDir, { recursive: true });
  const exitCode = opts.exitCode ?? 0;
  const script = `#!/bin/sh
echo "$@" >> "${logFile}"
exit ${exitCode}
`;
  const pnpmPath = path.join(binDir, "pnpm");
  fs.writeFileSync(pnpmPath, script);
  fs.chmodSync(pnpmPath, 0o755);
}

function runFn(fn: string, args: string[], env: NodeJS.ProcessEnv): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      "bash",
      ["-c", `source "${litTLocalPath}" && ${fn} "$@"`, "_", ...args],
      { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("litt-local bootstrap — detection", () => {
  let root: string;

  beforeEach(() => {
    root = makeFakeWorktree();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("needs_install: true on a fresh worktree (no node_modules)", () => {
    const res = runFn("litt_local_needs_install", [root], process.env);
    expect(res.status).toBe(0); // shell "true" == exit 0
  });

  it("needs_install: true when node_modules exists but tsx binary is missing", () => {
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    const res = runFn("litt_local_needs_install", [root], process.env);
    expect(res.status).toBe(0);
  });

  it("needs_install: false once tsx is installed", () => {
    markInstalled(root);
    const res = runFn("litt_local_needs_install", [root], process.env);
    expect(res.status).toBe(1);
  });

  it("needs_build: true when dist/index.js is missing for a required package", () => {
    const res = runFn("litt_local_needs_build", [root], process.env);
    expect(res.status).toBe(0);
  });

  it("needs_build: false once all required packages are built", () => {
    markBuilt(root);
    const res = runFn("litt_local_needs_build", [root], process.env);
    expect(res.status).toBe(1);
  });

  it("needs_build: true when dist is older than src (stale build)", () => {
    markBuilt(root);
    // Touch a src file into the future relative to dist/index.js.
    const staleSrc = path.join(root, "packages", "litt-models", "src", "index.ts");
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(staleSrc, future, future);
    const res = runFn("litt_local_needs_build", [root], process.env);
    expect(res.status).toBe(0);
  });

  it("needs_build: false when only one of two required packages is checked and both are built", () => {
    markBuilt(root);
    const res = runFn("litt_local_needs_build", [root], process.env);
    expect(res.status).toBe(1);
  });
});

describe("litt-local bootstrap — end-to-end scenarios", () => {
  let root: string;
  let pnpmBinDir: string;
  let logFile: string;

  beforeEach(() => {
    root = makeFakeWorktree();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "litt-fake-pnpm-"));
    pnpmBinDir = path.join(scratch, "bin");
    logFile = path.join(scratch, "pnpm.log");
    fs.writeFileSync(logFile, "");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.dirname(pnpmBinDir), { recursive: true, force: true });
  });

  function envWithFakePnpm(): NodeJS.ProcessEnv {
    return { ...process.env, PATH: `${pnpmBinDir}:${process.env.PATH}` };
  }

  it("fresh worktree: runs install then build, in order", () => {
    // Fake pnpm "installs" tsx and "builds" dist on its respective
    // sub-command so the second bootstrap phase sees real progress.
    fs.mkdirSync(pnpmBinDir, { recursive: true });
    const script = `#!/bin/sh
echo "$@" >> "${logFile}"
if [ "$1" = "install" ]; then
  mkdir -p "${root}/node_modules/.bin"
  printf '#!/bin/sh\\nexit 0\\n' > "${root}/node_modules/.bin/tsx"
  chmod +x "${root}/node_modules/.bin/tsx"
elif [ "$1" = "--filter" ]; then
  ${BUILD_PACKAGES.map((pkg) => `mkdir -p "${root}/packages/${pkg}/dist" && echo x > "${root}/packages/${pkg}/dist/index.js"`).join("\n  ")}
fi
exit 0
`;
    fs.writeFileSync(path.join(pnpmBinDir, "pnpm"), script);
    fs.chmodSync(path.join(pnpmBinDir, "pnpm"), 0o755);

    const res = runFn("litt_local_bootstrap", [root], envWithFakePnpm());

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Fresh worktree detected — installing dependencies");
    expect(res.stdout).toContain("Building LiTT workspace dependencies");

    const log = fs.readFileSync(logFile, "utf8").trim().split("\n");
    expect(log[0]).toBe("install --frozen-lockfile");
    expect(log[1]).toBe("--filter @litlabs/litt-cli... build");

    // Bootstrap actually left the worktree ready.
    expect(fs.existsSync(path.join(root, "node_modules/.bin/tsx"))).toBe(true);
    for (const pkg of BUILD_PACKAGES) {
      expect(fs.existsSync(path.join(root, "packages", pkg, "dist/index.js"))).toBe(true);
    }
  });

  it("dependencies installed but dist missing: build runs, install is skipped", () => {
    markInstalled(root);
    makeFakePnpm(pnpmBinDir, logFile);

    const res = runFn("litt_local_bootstrap", [root], envWithFakePnpm());

    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain("installing dependencies");
    expect(res.stdout).toContain("Building LiTT workspace dependencies");

    const log = fs.readFileSync(logFile, "utf8").trim();
    expect(log).toBe("--filter @litlabs/litt-cli... build");
  });

  it("fully bootstrapped worktree: skips install and build entirely, stays silent and fast", () => {
    markInstalled(root);
    markBuilt(root);
    makeFakePnpm(pnpmBinDir, logFile);

    const res = runFn("litt_local_bootstrap", [root], envWithFakePnpm());

    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");

    const log = fs.readFileSync(logFile, "utf8").trim();
    expect(log).toBe(""); // pnpm was never invoked
  });

  it("failed install propagates a clear failure and never reaches build", () => {
    makeFakePnpm(pnpmBinDir, logFile, { exitCode: 1 });

    const res = runFn("litt_local_bootstrap", [root], envWithFakePnpm());

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Dependency install failed");
    expect(res.stderr).toContain("pnpm install --frozen-lockfile");

    const log = fs.readFileSync(logFile, "utf8").trim().split("\n");
    expect(log).toEqual(["install --frozen-lockfile"]); // build never ran
  });

  it("failed build propagates a clear failure", () => {
    markInstalled(root);
    makeFakePnpm(pnpmBinDir, logFile, { exitCode: 1 });

    const res = runFn("litt_local_bootstrap", [root], envWithFakePnpm());

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Workspace build failed");
    expect(res.stderr).toContain("'@litlabs/litt-cli...' build");
  });
});

describe("litt-local — sourcing the script never launches it", () => {
  it("sourcing defines functions without running litt_local_main (no termux.env, no curl, no exec)", () => {
    // If sourcing auto-ran litt_local_main, this would fail trying to
    // source $HOME/.config/litt/termux.env under a HOME that doesn't
    // have LiTT config, or hang on a real curl call.
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "litt-fake-home-"));
    try {
      const res = execFileSync(
        "bash",
        ["-c", `source "${litTLocalPath}" && type litt_local_bootstrap >/dev/null 2>&1 && echo SOURCED_OK`],
        { env: { ...process.env, HOME: fakeHome }, encoding: "utf8" },
      );
      expect(res.trim()).toBe("SOURCED_OK");
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
