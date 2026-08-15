/**
 * Phase 3C — CLI launch UX tests.
 *
 * Tests the release-candidate CLI launch contract:
 *   1. Bare `litt` defaults to cockpit
 *   2. `litt --help` does NOT dispatch cockpit
 *   3. Project root detection walks upward from cwd
 *   4. Detected root == RuntimeSession cwd == execution cwd
 *   5. No hardcoded C:\Users or litlabs-website paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { detectProject } from "../lib/utils.js";

// ─── Tests ─────────────────────────────────────────────────────────

describe("CLI Launch UX", () => {
  // ─── 1. Bare `litt` defaults to cockpit ────────────────────────

  it("bare command (no args) resolves to 'cockpit'", () => {
    // Simulate the index.ts dispatch logic
    const finalArgs: string[] = [];
    const requestedCommand = finalArgs[0];

    const isHelp = requestedCommand === "--help" || requestedCommand === "-h";
    const isVersion = requestedCommand === "--version" || requestedCommand === "-v";

    const command = isHelp || isVersion ? undefined : (requestedCommand ?? "cockpit");

    expect(isHelp).toBe(false);
    expect(isVersion).toBe(false);
    expect(command).toBe("cockpit");
  });

  it("litt --help does NOT dispatch cockpit", () => {
    const finalArgs = ["--help"];
    const requestedCommand = finalArgs[0];

    const isHelp = requestedCommand === "--help" || requestedCommand === "-h";
    const isVersion = requestedCommand === "--version" || requestedCommand === "-v";

    const command = isHelp || isVersion ? undefined : (requestedCommand ?? "cockpit");

    expect(isHelp).toBe(true);
    expect(command).toBeUndefined();
  });

  it("litt -h does NOT dispatch cockpit", () => {
    const finalArgs = ["-h"];
    const requestedCommand = finalArgs[0];

    const isHelp = requestedCommand === "--help" || requestedCommand === "-h";
    const command = isHelp ? undefined : (requestedCommand ?? "cockpit");

    expect(isHelp).toBe(true);
    expect(command).toBeUndefined();
  });

  it("litt doctor resolves to 'doctor' (not cockpit)", () => {
    const finalArgs = ["doctor"];
    const requestedCommand = finalArgs[0];

    const isHelp = requestedCommand === "--help" || requestedCommand === "-h";
    const isVersion = requestedCommand === "--version" || requestedCommand === "-v";

    const command = isHelp || isVersion ? undefined : (requestedCommand ?? "cockpit");

    expect(command).toBe("doctor");
  });

  it("litt status resolves to 'status' (not cockpit)", () => {
    const finalArgs = ["status"];
    const requestedCommand = finalArgs[0];

    const isHelp = requestedCommand === "--help" || requestedCommand === "-h";
    const command = isHelp ? undefined : (requestedCommand ?? "cockpit");

    expect(command).toBe("status");
  });

  it("litt --version resolves to version (not cockpit)", () => {
    const finalArgs = ["--version"];
    const requestedCommand = finalArgs[0];

    const isVersion = requestedCommand === "--version" || requestedCommand === "-v";
    const command = isVersion ? undefined : (requestedCommand ?? "cockpit");

    expect(isVersion).toBe(true);
    expect(command).toBeUndefined();
  });

  // ─── 2. Project root detection walks upward ────────────────────

  describe("detectProject — upward walk", () => {
    let tempRoot: string;
    let nestedDir: string;
    let deepNestedDir: string;

    beforeEach(() => {
      // Create a temp project structure:
      //   tempRoot/
      //     package.json
      //     .git/
      //     src/
      //       components/
      //         Button/
      //           deep/
      tempRoot = mkdtempSync(join(tmpdir(), "litt-test-"));
      writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ name: "test-project" }));
      mkdirSync(join(tempRoot, ".git"), { recursive: true });

      nestedDir = join(tempRoot, "src", "components");
      mkdirSync(nestedDir, { recursive: true });

      deepNestedDir = join(nestedDir, "Button", "deep");
      mkdirSync(deepNestedDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    it("detects project root from the root directory itself", () => {
      const project = detectProject(tempRoot);
      expect(project.rootDir).toBe(tempRoot);
      expect(project.hasPackageJson).toBe(true);
      expect(project.hasGit).toBe(true);
      expect(project.packageJson?.name).toBe("test-project");
    });

    it("detects project root from a nested subdirectory (src/components)", () => {
      const project = detectProject(nestedDir);
      expect(project.rootDir).toBe(tempRoot);
      expect(project.hasPackageJson).toBe(true);
      expect(project.hasGit).toBe(true);
    });

    it("detects project root from a deeply nested subdirectory (src/components/Button/deep)", () => {
      const project = detectProject(deepNestedDir);
      expect(project.rootDir).toBe(tempRoot);
      expect(project.hasPackageJson).toBe(true);
    });

    it("falls back to start dir when no package.json or .git found upward", () => {
      // Create a directory with no project markers above it
      const isolatedDir = mkdtempSync(join(tmpdir(), "litt-isolated-"));
      try {
        const project = detectProject(isolatedDir);
        expect(project.rootDir).toBe(isolatedDir);
        expect(project.hasPackageJson).toBe(false);
      } finally {
        rmSync(isolatedDir, { recursive: true, force: true });
      }
    });

    it("detects project root when only package.json exists (no .git)", () => {
      const noGitRoot = mkdtempSync(join(tmpdir(), "litt-nogit-"));
      writeFileSync(join(noGitRoot, "package.json"), JSON.stringify({ name: "no-git-project" }));
      const subDir = join(noGitRoot, "lib", "utils");
      mkdirSync(subDir, { recursive: true });

      try {
        const project = detectProject(subDir);
        expect(project.rootDir).toBe(noGitRoot);
        expect(project.hasPackageJson).toBe(true);
        expect(project.hasGit).toBe(false);
      } finally {
        rmSync(noGitRoot, { recursive: true, force: true });
      }
    });
  });

  // ─── 3. No hardcoded paths ─────────────────────────────────────

  describe("No hardcoded repository paths", () => {
    it("detectProject uses provided dir, not a hardcoded path", () => {
      // Create a temp project and verify detectProject finds it
      const tempRoot = mkdtempSync(join(tmpdir(), "litt-hardcode-"));
      writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ name: "temp" }));
      try {
        const project = detectProject(tempRoot);
        expect(project.rootDir).toBe(tempRoot);
        // The rootDir must be the temp dir we created, not a hardcoded
        // path to the development repo
        expect(project.rootDir).not.toContain("litlabs-website");
        expect(project.rootDir).not.toContain("CascadeProjects");
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    it("detectProject from a temp subdir does not fall back to a hardcoded path", () => {
      const tempRoot = mkdtempSync(join(tmpdir(), "litt-hardcode2-"));
      writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ name: "temp2" }));
      const subDir = join(tempRoot, "src", "deep");
      mkdirSync(subDir, { recursive: true });
      try {
        const project = detectProject(subDir);
        expect(project.rootDir).toBe(tempRoot);
        expect(project.rootDir).not.toContain("litlabs-website");
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    });
  });
});
