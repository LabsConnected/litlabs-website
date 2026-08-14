/**
 * Acceptance tests for Phase 2 — terminal execution + check/test/build.
 *
 * These tests verify that the canonical terminal execution path works:
 *   CommandRouter → ToolRegistry → ShellExecutor → real process
 *
 * Tests cover:
 *   - runCommand (direct execution)
 *   - runScript (package manager script detection)
 *   - CommandRouter.check() / .test() / .build()
 *   - failing command propagation (nonzero exit codes)
 *   - stdout/stderr preservation
 *   - paths containing spaces
 *   - no hardcoded C:\Users\litbi paths in new source
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  createShellExecutor,
  CommandRouter,
  runCommand,
  runScript,
  runTypecheck,
  runTest,
  runBuild,
} from "../index.js";

// Resolve repo root (same logic as phase1.test.ts)
let REPO_ROOT: string;
const testDir = __dirname;
if (testDir.includes("__tests__")) {
  REPO_ROOT = path.resolve(testDir, "../../..");
} else {
  REPO_ROOT = path.resolve(testDir, "..");
}
let checkDir = REPO_ROOT;
for (let i = 0; i < 5; i++) {
  if (fs.existsSync(path.join(checkDir, "package.json")) &&
      fs.existsSync(path.join(checkDir, "pnpm-workspace.yaml"))) {
    REPO_ROOT = checkDir;
    break;
  }
  checkDir = path.dirname(checkDir);
}

// ─── Helpers ───────────────────────────────────────────────────────

function makeTempProject(dirName: string, scripts: Record<string, string>): string {
  const tmp = path.join(os.tmpdir(), `litt-test-${dirName}-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: dirName, version: "1.0.0", scripts }, null, 2),
  );
  return tmp;
}

function cleanup(p: string): void {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ok */ }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("Phase 2A — runCommand (direct execution)", () => {
  it("runs a successful command and returns stdout", async () => {
    const shell = createShellExecutor(REPO_ROOT);
    const result = await runCommand(shell, "node", ["-e", "console.log('hello')"]);
    assert.equal(result.success, true);
    assert.equal(result.data.exitCode, 0);
    assert.match(result.data.stdout as string, /hello/);
    assert.equal(typeof result.data.durationMs, "number");
  });

  it("runs a failing command and returns nonzero exit code", async () => {
    const shell = createShellExecutor(REPO_ROOT);
    const result = await runCommand(shell, "node", ["-e", "process.exit(3)"]);
    assert.equal(result.success, false);
    assert.equal(result.data.exitCode, 3);
  });

  it("preserves stderr output", async () => {
    const shell = createShellExecutor(REPO_ROOT);
    const result = await runCommand(shell, "node", ["-e", "process.stderr.write('err msg')"]);
    assert.equal(result.success, true);
    assert.match(result.data.stderr as string, /err msg/);
  });

  it("reports duration in milliseconds", async () => {
    const shell = createShellExecutor(REPO_ROOT);
    const result = await runCommand(shell, "node", ["-e", "setTimeout(()=>{},100)"]);
    assert.equal(result.success, true);
    assert.ok((result.data.durationMs as number) >= 50, "duration should be >= 50ms");
  });
});

describe("Phase 2B — runScript (package manager detection)", () => {
  it("runs a script from package.json", async () => {
    const tmp = makeTempProject("script-test", { build: "node -e \"console.log('built')\"" });
    try {
      const shell = createShellExecutor(tmp);
      const result = await runScript(shell, "build", tmp);
      assert.equal(result.success, true);
      assert.match(result.data.stdout as string, /built/);
    } finally { cleanup(tmp); }
  });

  it("fails gracefully when script doesn't exist", async () => {
    const tmp = makeTempProject("no-script", { build: "echo ok" });
    try {
      const shell = createShellExecutor(tmp);
      const result = await runScript(shell, "nonexistent", tmp);
      assert.equal(result.success, false);
      assert.match(result.message, /No "nonexistent" script/);
    } finally { cleanup(tmp); }
  });

  it("fails gracefully when no package.json", async () => {
    const tmp = path.join(os.tmpdir(), `litt-test-nopkg-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const shell = createShellExecutor(tmp);
      const result = await runScript(shell, "build", tmp);
      assert.equal(result.success, false);
      assert.match(result.message, /No package\.json/);
    } finally { cleanup(tmp); }
  });
});

describe("Phase 2C — CommandRouter check/test/build", () => {
  it("router.check() runs typecheck on agent-core", async () => {
    const pkgDir = path.join(REPO_ROOT, "packages", "litt-agent-core");
    const shell = createShellExecutor(pkgDir);
    const router = new CommandRouter(shell, { cwd: pkgDir });
    const result = await router.check();
    assert.equal(result.command, "check");
    assert.equal(result.result.success, true);
    assert.equal(result.result.data.exitCode, 0);
  });

  it("router.test() runs tests on agent-core", async () => {
    const pkgDir = path.join(REPO_ROOT, "packages", "litt-agent-core");
    const shell = createShellExecutor(pkgDir);
    const router = new CommandRouter(shell, { cwd: pkgDir });
    const result = await router.test();
    assert.equal(result.command, "test");
    assert.equal(result.result.success, true);
  });

  it("router.build() runs build on agent-core", async () => {
    const pkgDir = path.join(REPO_ROOT, "packages", "litt-agent-core");
    const shell = createShellExecutor(pkgDir);
    const router = new CommandRouter(shell, { cwd: pkgDir });
    const result = await router.build();
    assert.equal(result.command, "build");
    assert.equal(result.result.success, true);
  });

  it("router.dispatch('check') matches router.check()", async () => {
    const pkgDir = path.join(REPO_ROOT, "packages", "litt-agent-core");
    const shell = createShellExecutor(pkgDir);
    const router = new CommandRouter(shell, { cwd: pkgDir });
    const direct = await router.check();
    const dispatched = await router.dispatch("check");
    assert.equal(direct.command, dispatched.command);
    assert.equal(direct.result.success, dispatched.result.success);
  });
});

describe("Phase 2D — Failing command propagation", () => {
  it("check fails when typecheck script exits nonzero", async () => {
    const tmp = makeTempProject("fail-check", { typecheck: "node -e \"process.exit(2)\"" });
    try {
      const shell = createShellExecutor(tmp);
      const router = new CommandRouter(shell, { cwd: tmp });
      const result = await router.check();
      assert.equal(result.result.success, false);
      assert.equal(result.result.data.exitCode, 2);
    } finally { cleanup(tmp); }
  });

  it("test fails when test script exits nonzero", async () => {
    const tmp = makeTempProject("fail-test", { test: "node -e \"process.exit(1)\"" });
    try {
      const shell = createShellExecutor(tmp);
      const router = new CommandRouter(shell, { cwd: tmp });
      const result = await router.test();
      assert.equal(result.result.success, false);
      assert.equal(result.result.data.exitCode, 1);
    } finally { cleanup(tmp); }
  });

  it("build fails when build script exits nonzero", async () => {
    const tmp = makeTempProject("fail-build", { build: "node -e \"process.exit(5)\"" });
    try {
      const shell = createShellExecutor(tmp);
      const router = new CommandRouter(shell, { cwd: tmp });
      const result = await router.build();
      assert.equal(result.result.success, false);
      assert.equal(result.result.data.exitCode, 5);
    } finally { cleanup(tmp); }
  });
});

describe("Phase 2E — Paths containing spaces", () => {
  it("runCommand works in a directory with spaces", async () => {
    const tmp = path.join(os.tmpdir(), `litt test dir ${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const shell = createShellExecutor(tmp);
      const result = await runCommand(shell, "node", ["-e", "console.log('ok')"], { cwd: tmp });
      assert.equal(result.success, true);
      assert.match(result.data.stdout as string, /ok/);
    } finally { cleanup(tmp); }
  });

  it("runScript works in a directory with spaces", async () => {
    const tmp = path.join(os.tmpdir(), `litt test dir ${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "space-test", version: "1.0.0", scripts: { build: "echo built" } }),
    );
    try {
      const shell = createShellExecutor(tmp);
      const result = await runScript(shell, "build", tmp);
      assert.equal(result.success, true);
    } finally { cleanup(tmp); }
  });
});

describe("Phase 2F — No hardcoded paths in new source", () => {
  it("shell.ts has no hardcoded C:\\Users\\litbi", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "shell.ts"), "utf8");
    const codeLines = src.split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    for (const line of codeLines) {
      assert.ok(!line.includes("C:\\Users\\litbi"),
        `shell.ts must not contain hardcoded C:\\Users\\litbi: ${line.trim()}`);
    }
  });

  it("project.ts has no hardcoded C:\\Users\\litbi", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "project.ts"), "utf8");
    const codeLines = src.split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    for (const line of codeLines) {
      assert.ok(!line.includes("C:\\Users\\litbi"),
        `project.ts must not contain hardcoded C:\\Users\\litbi: ${line.trim()}`);
    }
  });

  it("tools.ts has no hardcoded C:\\Users\\litbi", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "tools.ts"), "utf8");
    const codeLines = src.split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    for (const line of codeLines) {
      assert.ok(!line.includes("C:\\Users\\litbi"),
        `tools.ts must not contain hardcoded C:\\Users\\litbi: ${line.trim()}`);
    }
  });

  it("router.ts has no hardcoded C:\\Users\\litbi", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "router.ts"), "utf8");
    const codeLines = src.split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    for (const line of codeLines) {
      assert.ok(!line.includes("C:\\Users\\litbi"),
        `router.ts must not contain hardcoded C:\\Users\\litbi: ${line.trim()}`);
    }
  });
});
