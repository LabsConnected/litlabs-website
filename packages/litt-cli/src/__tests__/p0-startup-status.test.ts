/**
 * P0-7: Startup Status — regression tests.
 *
 * Proves:
 *   - collectStartupStatus returns all expected fields.
 *   - formatStartupStatus shows Project, Worktree, Branch, Git, Execution,
 *     Provider, Model, Auth, Tools, Worktree.
 *   - Canonical main warning is included when present.
 *   - Stale build warning is included when present.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  collectStartupStatus,
  formatStartupStatus,
  type StartupStatus,
} from "../lib/startup-status.js";

const tmpDir = path.join(os.tmpdir(), `litt-p0-status-${Date.now()}`);

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test-project" }));
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("P0-7: Startup Status", () => {
  describe("collectStartupStatus", () => {
    it("returns all expected fields", () => {
      const status = collectStartupStatus(tmpDir);
      expect(status).toHaveProperty("project");
      expect(status).toHaveProperty("worktree");
      expect(status).toHaveProperty("branch");
      expect(status).toHaveProperty("gitClean");
      expect(status).toHaveProperty("execution");
      expect(status).toHaveProperty("provider");
      expect(status).toHaveProperty("model");
      expect(status).toHaveProperty("authSignedIn");
      expect(status).toHaveProperty("toolsReady");
      expect(status).toHaveProperty("worktreeAvailable");
    });

    it("detects the project name from package.json", () => {
      const status = collectStartupStatus(tmpDir);
      expect(status.project).toBe("test-project");
    });

    it("defaults to LOCAL execution", () => {
      const status = collectStartupStatus(tmpDir);
      expect(status.execution).toBe("LOCAL");
    });

    it("detects provider from env vars", () => {
      const oldVal = process.env.OLLAMA_BASE_URL;
      process.env.OLLAMA_BASE_URL = "http://localhost:11434";
      const status = collectStartupStatus(tmpDir);
      expect(status.provider).toBe("Ollama");
      if (oldVal) process.env.OLLAMA_BASE_URL = oldVal;
      else delete process.env.OLLAMA_BASE_URL;
    });
  });

  describe("formatStartupStatus", () => {
    it("shows all expected labels", () => {
      const status: StartupStatus = {
        project: "litlabs-website",
        worktree: "E:\\LiTT\\Worktrees\\main",
        branch: "main",
        gitClean: true,
        gitChanged: 0,
        gitUntracked: 0,
        execution: "LOCAL",
        localOnly: false,
        provider: "Ollama",
        model: "qwen3:4b-instruct",
        authSignedIn: false,
        toolsReady: true,
        worktreeAvailable: true,
        worktreeLeaseStatus: "available",
        canonicalMainWarning: null,
        staleBuildWarning: null,
      };
      const text = formatStartupStatus(status);
      expect(text).toContain("Project:");
      expect(text).toContain("litlabs-website");
      expect(text).toContain("Worktree:");
      expect(text).toContain("Branch:");
      expect(text).toContain("main");
      expect(text).toContain("Git:");
      expect(text).toContain("clean");
      expect(text).toContain("Execution:");
      expect(text).toContain("LOCAL");
      expect(text).toContain("Provider:");
      expect(text).toContain("Ollama");
      expect(text).toContain("Model:");
      expect(text).toContain("qwen3:4b-instruct");
      expect(text).toContain("Auth:");
      expect(text).toContain("signed out");
      expect(text).toContain("Tools:");
      expect(text).toContain("ready");
      expect(text).toContain("Worktree:");
      expect(text).toContain("available");
    });

    it("shows canonical main warning when present", () => {
      const status: StartupStatus = {
        project: "test",
        worktree: "E:\\LiTT\\Worktrees\\main",
        branch: "wrong-branch",
        gitClean: true,
        gitChanged: 0,
        gitUntracked: 0,
        execution: "LOCAL",
        localOnly: false,
        provider: "Ollama",
        model: "qwen3:4b-instruct",
        authSignedIn: false,
        toolsReady: true,
        worktreeAvailable: true,
        worktreeLeaseStatus: "available",
        canonicalMainWarning: "WORKTREE MISMATCH: canonical main is on wrong-branch",
        staleBuildWarning: null,
      };
      const text = formatStartupStatus(status);
      expect(text).toContain("WORKTREE MISMATCH");
    });

    it("shows stale build warning when present", () => {
      const status: StartupStatus = {
        project: "test",
        worktree: "/tmp/test",
        branch: "main",
        gitClean: true,
        gitChanged: 0,
        gitUntracked: 0,
        execution: "LOCAL",
        localOnly: false,
        provider: "Ollama",
        model: "qwen3:4b-instruct",
        authSignedIn: false,
        toolsReady: true,
        worktreeAvailable: true,
        worktreeLeaseStatus: "available",
        canonicalMainWarning: null,
        staleBuildWarning: "CLI BUILD STALE: rebuild needed",
      };
      const text = formatStartupStatus(status);
      expect(text).toContain("CLI BUILD STALE");
    });

    it("shows dirty git state", () => {
      const status: StartupStatus = {
        project: "test",
        worktree: "/tmp/test",
        branch: "main",
        gitClean: false,
        gitChanged: 3,
        gitUntracked: 2,
        execution: "LOCAL",
        localOnly: false,
        provider: "Ollama",
        model: "qwen3:4b-instruct",
        authSignedIn: false,
        toolsReady: true,
        worktreeAvailable: true,
        worktreeLeaseStatus: "available",
        canonicalMainWarning: null,
        staleBuildWarning: null,
      };
      const text = formatStartupStatus(status);
      expect(text).toContain("3 modified");
      expect(text).toContain("2 untracked");
    });
  });
});
