/**
 * Regression coverage for the project.test timeout fix.
 *
 * The canonical root test suite takes ~144s, which exceeds the 120_000 ms
 * default `runCommand` timeout and was killing `project.test`. The fix
 * extends `runScript()` to accept an optional `timeoutMs` and changes only
 * `runTest()` to pass 300_000 ms — build/check/run keep the 120s default.
 *
 * These tests use a mocked ShellExecutor so no real process is spawned and
 * no timeout duration is actually waited.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import {
  runScript,
  runTest,
  runBuild,
  runTypecheck,
} from "../project.js";
import type { ShellExecutor, ShellExecuteOptions, ShellResult } from "../types.js";

// ─── Fixture ────────────────────────────────────────────────────────

/**
 * Build a temp project dir with a package.json containing the requested
 * scripts, plus a pnpm-lock.yaml so the package manager is detected as pnpm.
 */
function makeFixture(scripts: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-project-test-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", scripts }, null, 2),
  );
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
  return dir;
}

/**
 * Mocked ShellExecutor that records every execute() call and resolves
 * immediately with a synthetic success result. No real process is spawned,
 * so no timeout duration is ever waited.
 */
function makeMockShell(cwd: string): {
  shell: ShellExecutor;
  calls: ShellExecuteOptions[];
} {
  const calls: ShellExecuteOptions[] = [];
  const shell: ShellExecutor = {
    cwd,
    platform: process.platform,
    environment: process.env as Record<string, string>,
    async execute(options: ShellExecuteOptions): Promise<ShellResult> {
      calls.push(options);
      return {
        ok: true,
        status: "success",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 0,
        command: options.command,
        args: options.args ?? [],
        truncated: false,
        pid: 12345,
      };
    },
    async cancel(): Promise<number[]> {
      return [];
    },
  };
  return { shell, calls };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("runScript timeout plumbing", () => {
  it("runTest passes timeoutMs = 300_000 to shell execution", async () => {
    const dir = makeFixture({ test: "vitest run" });
    try {
      const { shell, calls } = makeMockShell(dir);
      await runTest(shell, dir);
      assert.equal(calls.length, 1, "exactly one execute() call expected");
      assert.equal(
        calls[0].timeoutMs,
        300_000,
        `runTest must request 300_000 ms, got ${calls[0].timeoutMs}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runScript with no options resolves to the 120_000 default", async () => {
    const dir = makeFixture({ build: "next build" });
    try {
      const { shell, calls } = makeMockShell(dir);
      await runScript(shell, "build", dir);
      assert.equal(calls.length, 1, "exactly one execute() call expected");
      // runCommand applies its 120_000 default when runScript omits timeoutMs.
      // The mocked shell receives the value runCommand forwards, which is 120_000.
      assert.equal(
        calls[0].timeoutMs,
        120_000,
        `default runScript must resolve to 120_000 ms, got ${calls[0].timeoutMs}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runScript forwards an explicit timeoutMs when provided", async () => {
    const dir = makeFixture({ test: "vitest run" });
    try {
      const { shell, calls } = makeMockShell(dir);
      await runScript(shell, "test", dir, { timeoutMs: 300_000 });
      assert.equal(calls.length, 1, "exactly one execute() call expected");
      assert.equal(
        calls[0].timeoutMs,
        300_000,
        `explicit timeoutMs must be forwarded, got ${calls[0].timeoutMs}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runBuild is NOT accidentally changed to 300_000 (keeps 120_000 default)", async () => {
    const dir = makeFixture({ build: "next build" });
    try {
      const { shell, calls } = makeMockShell(dir);
      await runBuild(shell, dir);
      assert.equal(calls.length, 1, "exactly one execute() call expected");
      assert.equal(
        calls[0].timeoutMs,
        120_000,
        `runBuild must keep the 120_000 default, got ${calls[0].timeoutMs}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runTypecheck is NOT accidentally changed to 300_000 (keeps 120_000 default)", async () => {
    const dir = makeFixture({ typecheck: "tsc --noEmit" });
    try {
      const { shell, calls } = makeMockShell(dir);
      await runTypecheck(shell, dir);
      assert.equal(calls.length, 1, "exactly one execute() call expected");
      assert.equal(
        calls[0].timeoutMs,
        120_000,
        `runTypecheck must keep the 120_000 default, got ${calls[0].timeoutMs}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runTest still uses pnpm when pnpm-lock.yaml is present", async () => {
    const dir = makeFixture({ test: "vitest run" });
    try {
      const { shell, calls } = makeMockShell(dir);
      await runTest(shell, dir);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].command, "pnpm", "should detect pnpm from lockfile");
      assert.deepEqual(calls[0].args, ["run", "test"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
