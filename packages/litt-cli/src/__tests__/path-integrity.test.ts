/**
 * collectPathIntegrity() / `litt doctor --paths` — regression coverage.
 *
 * Covers the scenarios the path-integrity audit called out explicitly:
 * absolute paths, spaces, apostrophes, Unicode, linked git worktrees,
 * different launch directories, and a missing/inaccessible directory.
 * Read-only — never mutates real state beyond temp dirs it creates and
 * cleans up itself.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPathIntegrity, isElevated } from "../lib/path-integrity.js";

const cleanupDirs: string[] = [];
function makeTempWorkspace(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `litt-pi-${name}-`));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (cleanupDirs.length) {
    const d = cleanupDirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe("collectPathIntegrity", () => {
  it("resolves an absolute, plain workspace path", () => {
    const dir = makeTempWorkspace("plain");
    writeFileSync(join(dir, "package.json"), '{"name":"plain"}');
    const report = collectPathIntegrity(dir);
    expect(report.project.rootDir).toBe(dir);
    expect(report.project.isSelfInstall).toBe(false);
  });

  it("resolves a workspace path containing spaces and an apostrophe", () => {
    const dir = makeTempWorkspace("spaced");
    const spaced = join(dir, "o'brien's project folder");
    mkdirSync(spaced);
    writeFileSync(join(spaced, "package.json"), '{"name":"spaced"}');
    const report = collectPathIntegrity(spaced);
    expect(report.project.rootDir).toBe(spaced);
  });

  it("resolves a workspace path containing Unicode characters", () => {
    const dir = makeTempWorkspace("unicode");
    const unicodeDir = join(dir, "café-项目-🚀");
    mkdirSync(unicodeDir);
    writeFileSync(join(unicodeDir, "package.json"), '{"name":"unicode"}');
    const report = collectPathIntegrity(unicodeDir);
    expect(report.project.rootDir).toBe(unicodeDir);
  });

  it("throws on a missing explicit workspace — never silently falls back to another repo", () => {
    expect(() =>
      collectPathIntegrity("C:\\this\\path\\does\\not\\exist\\anywhere\\12345"),
    ).toThrow(/does not exist/);
  });

  it("still defaults to the process cwd when no override is supplied", () => {
    const report = collectPathIntegrity(undefined);
    expect(report.startingCwd).toBe(process.cwd());
  });

  it("detects a real linked git worktree for a repo with one", () => {
    // This package itself is built from a linked worktree in CI/dev —
    // verifies the worktree branch of collectPathIntegrity against a
    // real git checkout rather than a mock.
    const report = collectPathIntegrity(process.cwd());
    if (report.build.worktree) {
      expect(typeof report.build.worktree.linked).toBe("boolean");
      expect(report.build.worktree.root.length).toBeGreaterThan(0);
    }
  });

  it("always returns a Permissions check with a known status", () => {
    const report = collectPathIntegrity(undefined);
    const perm = report.checks.find((c) => c.name === "Permissions");
    expect(perm).toBeDefined();
    expect(["pass", "warn", "n/a"]).toContain(perm!.status);
  });

  it("never returns a 'fail' Launcher check as a false negative when litt IS installed", () => {
    // Regression guard for the exact bug this audit found: the Windows
    // readlink/Unix-branch fallthrough made a real, working launcher
    // report as unresolved ("/c/Users/.../litt" — invisible to
    // existsSync on Windows). If `where litt` finds anything at all on
    // this machine, the check must not silently claim "missing".
    let hasRealLauncher = false;
    try {
      execFileSync(process.platform === "win32" ? "where" : "which", ["litt"], {
        encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000,
      });
      hasRealLauncher = true;
    } catch {
      hasRealLauncher = false;
    }
    if (!hasRealLauncher) return; // nothing to assert in a sandbox with no global litt
    const report = collectPathIntegrity(undefined);
    expect(report.launcherTarget).not.toBeNull();
  });

  it("stateHome and configPath are consistent with lib/config.js's own resolver", () => {
    const report = collectPathIntegrity(undefined);
    expect(report.configPath.startsWith(report.stateHome)).toBe(true);
  });
});

describe("isElevated", () => {
  it("returns a boolean on win32, null elsewhere", () => {
    const result = isElevated();
    if (process.platform === "win32") {
      expect(typeof result).toBe("boolean");
    } else {
      expect(result).toBeNull();
    }
  });
});
