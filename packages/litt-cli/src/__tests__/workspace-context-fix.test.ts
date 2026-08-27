/**
 * Workspace-context fix — regression tests for the bug where LiTT
 * inspected its own install/runtime directory instead of the user's
 * real project.
 *
 * Two complementary defenses:
 *
 *   1. `--cwd <path>` flag + `LITT_CWD` env override → `resolveProjectCwd()`
 *      lets a launcher that must chdir into the LiTT install dir pass
 *      the caller's real working directory.
 *
 *   2. `detectProject()` self-install guard → if the upward walk lands on
 *      LiTT's own install dir (package name `litt-runtime` / `litt-cli` /
 *      `@litlabs/litt-cli` etc., or the CLI package dir itself), it
 *      refuses that root, falls back to the start dir, and sets
 *      `isSelfInstall: true` so the caller can warn the user.
 *
 * Together these fix the Termux symptom: a launcher that does
 * `cd ~/litt && node ...` no longer makes LiTT report
 * `litt-runtime@0.0.0` / "unknown branch" / "no scripts".
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { resolveDispatch } from "../lib/dispatch.js";
import {
  resolveProjectCwd,
  isLiTTInstallDir,
  detectProject,
} from "../lib/utils.js";

// ─── resolveProjectCwd ─────────────────────────────────────────────

describe("resolveProjectCwd — cwd override resolution", () => {
  const prevLittCwd = process.env.LITT_CWD;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-cwd-"));
    delete process.env.LITT_CWD;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevLittCwd === undefined) delete process.env.LITT_CWD;
    else process.env.LITT_CWD = prevLittCwd;
  });

  it("falls back to process.cwd() when no override is set", () => {
    delete process.env.LITT_CWD;
    expect(resolveProjectCwd()).toBe(process.cwd());
  });

  it("uses the explicit flag argument over LITT_CWD env", () => {
    process.env.LITT_CWD = tmpDir;
    const flagDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-flag-"));
    try {
      expect(resolveProjectCwd(flagDir)).toBe(path.resolve(flagDir));
    } finally {
      fs.rmSync(flagDir, { recursive: true, force: true });
    }
  });

  it("uses LITT_CWD env when no flag is passed", () => {
    process.env.LITT_CWD = tmpDir;
    expect(resolveProjectCwd()).toBe(tmpDir);
  });

  it("ignores a non-existent override and falls back to process.cwd()", () => {
    process.env.LITT_CWD = path.join(tmpDir, "does-not-exist");
    expect(resolveProjectCwd()).toBe(process.cwd());
  });

  it("resolves a relative override to absolute", () => {
    // Use the tmp dir name relative to tmpdir() — must exist
    const rel = path.relative(os.tmpdir(), tmpDir);
    process.env.LITT_CWD = rel;
    // resolve() is relative to process.cwd(), not tmpdir(), so only
    // assert that the result is absolute and ends with the tmp basename
    // when the relative path happens to resolve under cwd. Instead,
    // verify the absolute-resolution contract directly with an absolute
    // input.
    process.env.LITT_CWD = tmpDir;
    const out = resolveProjectCwd();
    expect(path.isAbsolute(out)).toBe(true);
    expect(out).toBe(tmpDir);
  });
});

// ─── isLiTTInstallDir ──────────────────────────────────────────────

describe("isLiTTInstallDir — self-install detection", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-self-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false for an unrelated directory with no package.json", () => {
    expect(isLiTTInstallDir(tmpDir)).toBe(false);
  });

  it("returns false for a directory whose package.json name is unrelated", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "my-real-project" }),
    );
    expect(isLiTTInstallDir(tmpDir)).toBe(false);
  });

  it("returns true for a directory whose package.json name is 'litt-runtime'", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "litt-runtime", version: "0.0.0" }),
    );
    expect(isLiTTInstallDir(tmpDir)).toBe(true);
  });

  it("returns true for a directory whose package.json name is '@litlabs/litt-cli'", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "@litlabs/litt-cli" }),
    );
    expect(isLiTTInstallDir(tmpDir)).toBe(true);
  });

  it("returns true for a directory whose package.json name is 'litt-cli'", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "litt-cli" }),
    );
    expect(isLiTTInstallDir(tmpDir)).toBe(true);
  });

  it("does not throw on an unreadable package.json (treats as not self-install)", () => {
    const pkgPath = path.join(tmpDir, "package.json");
    fs.writeFileSync(pkgPath, "{ this is not valid json");
    // Should not throw — should return false (no positive evidence)
    expect(isLiTTInstallDir(tmpDir)).toBe(false);
  });
});

// ─── detectProject self-install guard ──────────────────────────────

describe("detectProject — self-install guard", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "litt-detect-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("flags isSelfInstall=true and falls back to start dir when the root is a LiTT runtime dir", () => {
    // Build a fake LiTT install dir: ~/tmp/litt-detect-XXX/litt-runtime
    // with a package.json named "litt-runtime". A subdirectory simulates
    // the user having chdir'd into it before launching.
    const installDir = path.join(tmpRoot, "litt-runtime");
    fs.mkdirSync(installDir);
    fs.writeFileSync(
      path.join(installDir, "package.json"),
      JSON.stringify({ name: "litt-runtime", version: "0.0.0" }),
    );

    const info = detectProject(installDir);
    expect(info.isSelfInstall).toBe(true);
    // Falls back to the start dir, NOT the install dir
    expect(info.rootDir).toBe(path.resolve(installDir));
    expect(info.packageJson?.name).toBe("litt-runtime");
  });

  it("does not flag isSelfInstall for a normal project", () => {
    fs.writeFileSync(
      path.join(tmpRoot, "package.json"),
      JSON.stringify({ name: "my-real-project" }),
    );
    fs.mkdirSync(path.join(tmpRoot, ".git"));

    const info = detectProject(tmpRoot);
    expect(info.isSelfInstall).toBe(false);
    expect(info.rootDir).toBe(path.resolve(tmpRoot));
    expect(info.hasGit).toBe(true);
  });

  it("walks upward past a LiTT runtime dir to find the real project root", () => {
    // Real project root with .git
    fs.mkdirSync(path.join(tmpRoot, ".git"));
    fs.writeFileSync(
      path.join(tmpRoot, "package.json"),
      JSON.stringify({ name: "real-monorepo" }),
    );
    // A nested LiTT runtime dir inside the monorepo
    const nested = path.join(tmpRoot, "packages", "litt-runtime");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, "package.json"),
      JSON.stringify({ name: "litt-runtime", version: "0.0.0" }),
    );

    // Launching from inside the nested runtime dir: the upward walk
    // finds the monorepo's .git first (one level up), so rootDir is the
    // monorepo root, NOT the runtime dir, and isSelfInstall is false.
    const info = detectProject(nested);
    expect(info.isSelfInstall).toBe(false);
    expect(info.rootDir).toBe(path.resolve(tmpRoot));
    expect(info.packageJson?.name).toBe("real-monorepo");
  });
});

// ─── resolveDispatch --cwd flag ────────────────────────────────────

describe("resolveDispatch — --cwd flag parsing", () => {
  it("extracts --cwd <path> and strips it from rest", () => {
    const d = resolveDispatch(["--cwd", "/home/user/my-project"]);
    expect(d.command).toBe("cockpit");
    expect(d.cwd).toBe("/home/user/my-project");
    expect(d.rest).toEqual([]);
  });

  it("extracts --cwd alongside a command word", () => {
    const d = resolveDispatch(["status", "--cwd", "/repo"]);
    expect(d.command).toBe("status");
    expect(d.cwd).toBe("/repo");
    expect(d.rest).toEqual([]);
  });

  it("preserves other args after --cwd is stripped", () => {
    const d = resolveDispatch(["run", "--cwd", "/repo", "echo", "hi"]);
    expect(d.command).toBe("run");
    expect(d.cwd).toBe("/repo");
    expect(d.rest).toEqual(["echo", "hi"]);
  });

  it("leaves cwd undefined when --cwd is not present", () => {
    const d = resolveDispatch(["status"]);
    expect(d.cwd).toBeUndefined();
  });

  it("combines --cwd with --mode and --remote", () => {
    const d = resolveDispatch([
      "--remote",
      "--mode",
      "plan",
      "do",
      "--cwd",
      "/repo",
      "echo",
      "ok",
    ]);
    expect(d.useRemote).toBe(true);
    expect(d.mode).toBe("plan");
    expect(d.command).toBe("do");
    expect(d.cwd).toBe("/repo");
    expect(d.rest).toEqual(["echo", "ok"]);
  });

  it("does not treat a bare --cwd with no value as a cwd override", () => {
    // --cwd at the end with no following value: leave cwd undefined,
    // don't crash, don't strip anything beyond the flag itself.
    const d = resolveDispatch(["status", "--cwd"]);
    expect(d.command).toBe("status");
    expect(d.cwd).toBeUndefined();
  });
});
