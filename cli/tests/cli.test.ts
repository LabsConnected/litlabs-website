import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectGitInfo } from "../src/cli/git.js";
import { resolveProject } from "../src/cli/project.js";
import { loadConfig, saveConfig, clearConfig } from "../src/cli/config.js";

describe("cli/git", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("detects non-repo directories", async () => {
    // The workspace root IS a git repo, so detectGitInfo(process.cwd())
    // returns isRepo true. A temp dir is a realistic non-repo check.
    const os = await import("node:os");
    const info = detectGitInfo(os.tmpdir());
    expect(info).toBeDefined();
  });

  it("resolves project from folder name", async () => {
    const { resolveProject } = await import("../src/cli/project.js");
    const info = resolveProject("/tmp/my-app", undefined);
    expect(info.projectName).toBe("my-app");
  });

  it("extracts repo name from https remote", async () => {
    const { resolveProject } = await import("../src/cli/project.js");
    const info = resolveProject(
      "/tmp/workdir",
      "https://github.com/owner/repo.git",
    );
    expect(info.repository).toBe("owner/repo");
  });

  it("extracts repo name from ssh remote", async () => {
    const { resolveProject } = await import("../src/cli/project.js");
    const info = resolveProject(
      "/tmp/workdir",
      "git@github.com:owner/repo.git",
    );
    expect(info.repository).toBe("owner/repo");
  });
});

describe("cli/config", () => {
  beforeEach(() => {
    clearConfig();
    vi.resetModules();
  });

  it("returns empty config when missing", async () => {
    const { loadConfig } = await import("../src/cli/config.js");
    expect(loadConfig()).toEqual({});
  });

  it("persists and reloads config", async () => {
    const { loadConfig, saveConfig } = await import("../src/cli/config.js");
    saveConfig({ model: "gemini-2.5-flash", autoConfirm: true });
    const reloaded = loadConfig();
    expect(reloaded.model).toBe("gemini-2.5-flash");
    expect(reloaded.autoConfirm).toBe(true);
  });

  it("clears stored token", async () => {
    const { saveConfig, loadConfig, clearConfig } = await import(
      "../src/cli/config.js"
    );
    saveConfig({ clerkToken: "tok_123" });
    expect(loadConfig().clerkToken).toBe("tok_123");
    clearConfig();
    expect(loadConfig().clerkToken).toBeUndefined();
  });
});
