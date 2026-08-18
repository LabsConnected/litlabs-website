/**
 * Acceptance tests for Phase 1 — read-only project tools.
 *
 * These tests run without Next.js, React, Clerk, or Supabase.
 * They use the real git repo (this repo) as the test fixture.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs";
import {
  createShellExecutor,
  resolveProjectContext,
  gitStatus,
  gitDiff,
  gitBranch,
  gitLog,
  inspectPackageJson,
  isSafePath,
  detectProjectRoot,
  CommandRouter,
  createDefaultRegistry,
  RuntimeStore,
  createInitialState,
} from "../index.js";

// Use this repo's root as the test fixture.
// __dirname under tsx resolves to the src/__tests__ directory.
// We need to go up 3 levels: __tests__ -> src -> litt-agent-core -> packages -> repo root
// But tsx may resolve __dirname differently, so detect it properly.
let REPO_ROOT: string;
const testDir = __dirname;
if (testDir.includes("__tests__")) {
  // Normal: .../litt-agent-core/src/__tests__
  REPO_ROOT = path.resolve(testDir, "../../..");
} else {
  // tsx might resolve to .../packages or similar
  REPO_ROOT = path.resolve(testDir, "..");
}
// Verify it has a package.json — if not, walk up
let checkDir = REPO_ROOT;
for (let i = 0; i < 5; i++) {
  if (fs.existsSync(path.join(checkDir, "package.json")) &&
      fs.existsSync(path.join(checkDir, "pnpm-workspace.yaml"))) {
    REPO_ROOT = checkDir;
    break;
  }
  checkDir = path.dirname(checkDir);
}
const SHELL = createShellExecutor(REPO_ROOT);

describe("Phase 1A — Shell Executor", () => {
  it("NodeShellExecutor executes git successfully", async () => {
    const res = await SHELL.execute({
      command: "git",
      args: ["--version"],
      timeoutMs: 5000,
    });
    assert.equal(res.ok, true);
    assert.match(res.stdout, /git version/);
    assert.equal(res.exitCode, 0);
    assert.ok(res.durationMs >= 0);
  });

  it("NodeShellExecutor reports failure for bad command", async () => {
    const res = await SHELL.execute({
      command: "git",
      args: ["bad-subcommand-that-does-not-exist"],
      timeoutMs: 5000,
    });
    assert.equal(res.ok, false);
    assert.notEqual(res.exitCode, 0);
  });

  it("Shell executor cwd matches what was passed in", () => {
    // The shell executor should use the cwd we gave it, not a hardcoded path
    assert.equal(SHELL.cwd, REPO_ROOT);
    // The shell executor should not have a hardcoded Windows user path in its source
    const shellSrc = fs.readFileSync(path.join(__dirname, "..", "shell.ts"), "utf8");
    assert.ok(!shellSrc.includes("C:\\Users\\litbi"),
      "shell.ts must not contain hardcoded C:\\Users\\litbi path");
  });
});

describe("Phase 1B — Project Detection", () => {
  it("detectProjectRoot finds the repo root from a subdirectory", () => {
    const subDir = path.join(REPO_ROOT, "src", "lib");
    const root = detectProjectRoot(subDir);
    // Should walk up and find the repo root (has .git)
    const repoName = path.basename(REPO_ROOT);
    assert.ok(root.endsWith(repoName),
      `expected repo root ending in ${repoName}, got: ${root}`);
  });

  it("detectProjectRoot uses explicit root when provided", () => {
    const root = detectProjectRoot("/tmp", REPO_ROOT);
    assert.equal(root, REPO_ROOT);
  });

  it("resolveProjectContext returns git repo info", async () => {
    const ctx = await resolveProjectContext(SHELL, REPO_ROOT);
    assert.equal(ctx.isGitRepo, true);
    const repoName = path.basename(REPO_ROOT);
    assert.ok(ctx.root.endsWith(repoName),
      `root should end with ${repoName}, got: ${ctx.root}`);
    assert.ok(ctx.branch !== null, "branch should be detected");
    assert.ok(ctx.name.length > 0, "name should be non-empty");
  });
});

describe("Phase 1B — Read-Only Git Tools", () => {
  it("gitStatus returns porcelain output", async () => {
    const result = await gitStatus(SHELL, REPO_ROOT);
    assert.equal(result.success, true);
    assert.ok(typeof result.data.changeCount === "number");
    assert.ok(Array.isArray(result.data.files));
  });

  it("gitDiff returns diff output (may be empty if clean)", async () => {
    const result = await gitDiff(SHELL, REPO_ROOT);
    assert.equal(result.success, true);
    assert.ok(typeof result.data.diff === "string");
  });

  it("gitBranch returns current branch", async () => {
    const result = await gitBranch(SHELL, REPO_ROOT);
    assert.equal(result.success, true);
    assert.ok(typeof result.data.branch === "string" || result.data.branch === null);
  });

  it("gitLog returns recent commits", async () => {
    const result = await gitLog(SHELL, REPO_ROOT, 5);
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.data.commits));
    assert.ok(result.data.commits.length > 0, "should have at least one commit");
  });
});

describe("Phase 1B — File Tools", () => {
  it("inspectPackageJson reads and parses package.json", async () => {
    const result = await inspectPackageJson(SHELL, REPO_ROOT);
    assert.equal(result.success, true);
    assert.ok(result.data.name, "should have a name");
    assert.ok(result.data.version, "should have a version");
    assert.ok(typeof result.data.scripts === "object");
  });

  it("isSafePath blocks .env files", () => {
    assert.equal(isSafePath(".env"), false);
    assert.equal(isSafePath(".env.local"), false);
    assert.equal(isSafePath("config/.env"), false);
  });

  it("isSafePath blocks node_modules", () => {
    assert.equal(isSafePath("node_modules/foo"), false);
  });

  it("isSafePath blocks path traversal", () => {
    assert.equal(isSafePath("../../etc/passwd"), false);
  });

  it("isSafePath allows normal files", () => {
    assert.equal(isSafePath("src/index.ts"), true);
    assert.equal(isSafePath("README.md"), true);
  });
});

describe("Phase 1D — Command Router", () => {
  const router = new CommandRouter(SHELL, { cwd: REPO_ROOT });

  it("router.status() returns project + git info", async () => {
    const result = await router.status();
    assert.equal(result.command, "status");
    assert.equal(result.result.success, true);
    assert.ok(result.project, "should have project info");
    const repoName = path.basename(REPO_ROOT);
    assert.ok(result.project?.root.endsWith(repoName),
      `root should end with ${repoName}, got: ${result.project?.root}`);
    assert.ok(result.project?.isGitRepo, "should be a git repo");
  });

  it("router.diff() returns diff data", async () => {
    const result = await router.diff();
    assert.equal(result.command, "diff");
    assert.equal(result.result.success, true);
  });

  it("router.dispatch('status') matches router.status()", async () => {
    const direct = await router.status();
    const dispatched = await router.dispatch("status");
    assert.equal(direct.command, dispatched.command);
    assert.equal(direct.result.success, dispatched.result.success);
  });

  it("router.dispatch('unknown') returns error", async () => {
    const result = await router.dispatch("nonexistent");
    assert.equal(result.result.success, false);
    assert.match(result.result.message, /Unknown command/);
  });
});

describe("Phase 1F — Runtime State", () => {
  it("createInitialState returns idle state", () => {
    const state = createInitialState();
    assert.equal(state.phase, "idle");
    assert.equal(state.project, null);
    assert.equal(state.online, false);
  });

  it("RuntimeStore tracks phase changes", () => {
    const events: string[] = [];
    const store = new RuntimeStore((e) => {
      if (e.type === "phase_change") events.push(`${e.data.from}->${e.data.to}`);
    });
    store.setPhase("thinking");
    store.setPhase("running");
    store.setPhase("complete");
    assert.deepEqual(events, ["idle->thinking", "thinking->running", "running->complete"]);
  });

  it("RuntimeStore getState returns a copy", () => {
    const store = new RuntimeStore();
    const s1 = store.getState();
    s1.phase = "failed";
    const s2 = store.getState();
    assert.equal(s2.phase, "idle", "mutation should not affect store");
  });
});

describe("Acceptance Gate 2 — No Hardcoded Paths", () => {
  it("core works from a different directory", async () => {
    // Create a shell executor pointed at a subdirectory
    const subDir = path.join(REPO_ROOT, "packages", "litt-agent-core");
    const subShell = createShellExecutor(subDir);
    const ctx = await resolveProjectContext(subShell, subDir);
    // It should detect the git repo by walking up from the subdirectory
    assert.equal(ctx.isGitRepo, true);
    // The root should be the repo root (found by walking up to .git)
    const repoName = path.basename(REPO_ROOT);
    assert.ok(ctx.root.endsWith(repoName),
      `root should be the repo root, got: ${ctx.root}`);
    // The branch should be detected
    assert.ok(ctx.branch !== null, "branch should be detected from subdirectory");
  });

  it("core does not import from @/lib, next/, @clerk, or @supabase", async () => {
    // Read all source files and check for forbidden imports
    const srcDir = path.join(__dirname, "..");
    const files = fs.readdirSync(srcDir)
      .filter((f) => f.endsWith(".ts") && !f.includes("__tests__"))
      .map((f) => path.join(srcDir, f));

    const forbiddenPatterns = [
      { pattern: /^import\s+.*from\s+["']@\/lib/m, name: "@/lib" },
      { pattern: /^import\s+.*from\s+["']next\//m, name: "next/" },
      { pattern: /^import\s+.*from\s+["']@clerk/m, name: "@clerk" },
      { pattern: /^import\s+.*from\s+["']@supabase/m, name: "@supabase" },
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      const basename = path.basename(file);
      for (const { pattern, name } of forbiddenPatterns) {
        const lines = content.split("\n");
        for (const line of lines) {
          assert.ok(
            !pattern.test(line),
            `${basename} must not import from ${name}: ${line.trim()}`,
          );
        }
      }
      // Also check for hardcoded Windows user paths in source (not in comments about existing code)
      const sourceLines = content.split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
      for (const line of sourceLines) {
        assert.ok(
          !line.includes("C:\\Users\\litbi"),
          `${basename} must not contain hardcoded C:\\Users\\litbi path: ${line.trim()}`,
        );
      }
    }
  });
});
