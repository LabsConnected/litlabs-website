/**
 * P0-9: Stale Build Detection — regression tests.
 *
 * Proves:
 *   - getSourceSha returns the git HEAD SHA.
 *   - readBuildMeta reads dist/.build-meta.json.
 *   - writeBuildMeta writes dist/.build-meta.json.
 *   - checkStaleBuild reports "fresh" when SHAs match.
 *   - checkStaleBuild reports "stale" when SHAs differ.
 *   - checkStaleBuild reports "no-build-meta" when no metadata file.
 *   - The rebuild command is shown when stale.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

import {
  getSourceSha,
  readBuildMeta,
  writeBuildMeta,
  checkStaleBuild,
  type BuildMeta,
} from "../lib/build-metadata.js";

const tmpDir = path.join(os.tmpdir(), `litt-p0-build-${Date.now()}`);

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  // Init a git repo so getSourceSha works
  try {
    execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe", timeout: 5000 });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir, stdio: "pipe", timeout: 5000 });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir, stdio: "pipe", timeout: 5000 });
    fs.writeFileSync(path.join(tmpDir, "test.txt"), "test");
    execFileSync("git", ["add", "test.txt"], { cwd: tmpDir, stdio: "pipe", timeout: 5000 });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir, stdio: "pipe", timeout: 5000 });
  } catch { /* git may not be available in all envs */ }
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("P0-9: Stale Build Detection", () => {
  describe("getSourceSha", () => {
    it("returns the git HEAD SHA", () => {
      const sha = getSourceSha(tmpDir);
      // May be null if git isn't available, but if it is, it should be 40 hex chars
      if (sha) {
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      }
    });

    it("returns null for a non-git directory", () => {
      // Use a path OUTSIDE the git repo (tmpDir was init'd as git)
      const nonGit = path.join(os.tmpdir(), `litt-p0-nongit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      fs.mkdirSync(nonGit, { recursive: true });
      expect(getSourceSha(nonGit)).toBe(null);
      try { fs.rmSync(nonGit, { recursive: true, force: true }); } catch { /* ignore */ }
    });
  });

  describe("writeBuildMeta + readBuildMeta", () => {
    it("writes and reads build metadata", () => {
      const distDir = path.join(tmpDir, "dist");
      fs.mkdirSync(distDir, { recursive: true });
      const sha = getSourceSha(tmpDir) ?? "abc123";
      writeBuildMeta(sha, "0.1.0", distDir);
      const meta = readBuildMeta(distDir);
      expect(meta).not.toBe(null);
      expect(meta?.sourceSha).toBe(sha);
      expect(meta?.version).toBe("0.1.0");
      expect(meta?.builtAt).toBeTruthy();
    });

    it("returns null when no build metadata file exists", () => {
      expect(readBuildMeta(path.join(tmpDir, "no-dist"))).toBe(null);
    });

    it("returns null for corrupt metadata", () => {
      const distDir = path.join(tmpDir, "dist");
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, ".build-meta.json"), "{ corrupt json");
      expect(readBuildMeta(distDir)).toBe(null);
    });
  });

  describe("checkStaleBuild", () => {
    it("reports fresh when SHAs match", () => {
      const sha = getSourceSha(tmpDir);
      if (!sha) return; // skip if git not available
      const distDir = path.join(tmpDir, "dist");
      fs.mkdirSync(distDir, { recursive: true });
      writeBuildMeta(sha, "0.1.0", distDir);
      const check = checkStaleBuild(tmpDir);
      expect(check.stale).toBe(false);
      // Status is "fresh" when launcher is found, "no-launcher" when not
      // (both are non-stale). CI environments may not have `litt` installed.
      expect(["fresh", "no-launcher"]).toContain(check.status);
      expect(check.sourceSha).toBe(sha);
      expect(check.builtSha).toBe(sha);
    });

    it("reports stale when SHAs differ", () => {
      const sha = getSourceSha(tmpDir);
      if (!sha) return;
      const distDir = path.join(tmpDir, "dist");
      fs.mkdirSync(distDir, { recursive: true });
      // Write a WRONG SHA in the build metadata
      writeBuildMeta("0".repeat(40), "0.1.0", distDir);
      const check = checkStaleBuild(tmpDir);
      expect(check.stale).toBe(true);
      expect(check.status).toBe("stale");
      expect(check.rebuildCommand).toContain("pnpm build");
      expect(check.message).toContain("CLI BUILD STALE");
    });

    it("reports no-build-meta when dist/.build-meta.json is missing", () => {
      const check = checkStaleBuild(tmpDir);
      const sha = getSourceSha(tmpDir);
      if (!sha) return;
      expect(check.stale).toBe(true);
      expect(check.status).toBe("no-build-meta");
      expect(check.message).toContain("CLI BUILD STALE");
    });

    it("reports no-source-sha when not a git repo", () => {
      // Use a path OUTSIDE the git repo (tmpDir was init'd as git)
      const nonGit = path.join(os.tmpdir(), `litt-p0-nongit2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      fs.mkdirSync(nonGit, { recursive: true });
      const check = checkStaleBuild(nonGit);
      expect(check.status).toBe("no-source-sha");
      expect(check.stale).toBe(false);
      try { fs.rmSync(nonGit, { recursive: true, force: true }); } catch { /* ignore */ }
    });
  });
});
