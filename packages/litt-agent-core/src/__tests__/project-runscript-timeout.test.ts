/**
 * Regression coverage for verification timeout budgets.
 *
 * The canonical root test suite takes ~144s, and typecheck/build can
 * take 120s+ on slow devices (Termux/proot). The old 120_000 ms default
 * was killing these commands at ~125-128s, surfacing as misleading
 * "exit 1" failures when the processes were actually timed out.
 *
 * The fix introduces named VERIFY_TIMEOUTS constants and extends the
 * budgets:
 *   - runTypecheck: 300_000 ms (5 min)
 *   - runBuild:     600_000 ms (10 min)
 *   - runTest:      600_000 ms (10 min)
 *
 * These tests use a mocked ShellExecutor so no real process is spawned
 * and no timeout duration is actually waited.
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
  runCommand,
  VERIFY_TIMEOUTS,
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
  it("runTest passes timeoutMs = VERIFY_TIMEOUTS.test (600_000) to shell execution", async () => {
    const dir = makeFixture({ test: "vitest run" });
    try {
      const { shell, calls } = makeMockShell(dir);
      await runTest(shell, dir);
      assert.equal(calls.length, 1, "exactly one execute() call expected");
      assert.equal(
        calls[0].timeoutMs,
        VERIFY_TIMEOUTS.test,
        `runTest must request ${VERIFY_TIMEOUTS.test} ms, got ${calls[0].timeoutMs}`,
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

  it("runBuild passes timeoutMs = VERIFY_TIMEOUTS.build (600_000) to shell execution", async () => {
    const dir = makeFixture({ build: "next build" });
    try {
      const { shell, calls } = makeMockShell(dir);
      await runBuild(shell, dir);
      assert.equal(calls.length, 1, "exactly one execute() call expected");
      assert.equal(
        calls[0].timeoutMs,
        VERIFY_TIMEOUTS.build,
        `runBuild must request ${VERIFY_TIMEOUTS.build} ms, got ${calls[0].timeoutMs}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runTypecheck passes timeoutMs = VERIFY_TIMEOUTS.typecheck (300_000) to shell execution", async () => {
    const dir = makeFixture({ typecheck: "tsc --noEmit" });
    try {
      const { shell, calls } = makeMockShell(dir);
      await runTypecheck(shell, dir);
      assert.equal(calls.length, 1, "exactly one execute() call expected");
      assert.equal(
        calls[0].timeoutMs,
        VERIFY_TIMEOUTS.typecheck,
        `runTypecheck must request ${VERIFY_TIMEOUTS.typecheck} ms, got ${calls[0].timeoutMs}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runTypecheck fallback (no typecheck script) passes VERIFY_TIMEOUTS.typecheck to tsc --noEmit", async () => {
    // No typecheck script in package.json → falls back to npx tsc --noEmit
    const dir = makeFixture({ build: "next build" });
    try {
      const { shell, calls } = makeMockShell(dir);
      await runTypecheck(shell, dir);
      assert.equal(calls.length, 1, "exactly one execute() call expected");
      assert.equal(calls[0].command, "npx", "should use npx for tsc fallback");
      assert.deepEqual(calls[0].args, ["tsc", "--noEmit"]);
      assert.equal(
        calls[0].timeoutMs,
        VERIFY_TIMEOUTS.typecheck,
        `tsc fallback must use ${VERIFY_TIMEOUTS.typecheck} ms, got ${calls[0].timeoutMs}`,
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

// ─── Timeout message surfacing ─────────────────────────────────────

describe("runCommand timeout message", () => {
  it("surfaces TIMEOUT in the message when the shell reports status=timeout, not exit 1", async () => {
    // Mock shell that returns status="timeout" (simulating a killed process)
    const timeoutShell: ShellExecutor = {
      cwd: "/test",
      platform: process.platform,
      environment: process.env as Record<string, string>,
      async execute(options: ShellExecuteOptions): Promise<ShellResult> {
        return {
          ok: false,
          status: "timeout",
          stdout: "",
          stderr: "",
          exitCode: -1,
          durationMs: 120_500,
          command: options.command,
          args: options.args ?? [],
          truncated: false,
          pid: 999,
        };
      },
      async cancel(): Promise<number[]> {
        return [];
      },
    };

    const result = await runCommand(timeoutShell, "tsc", ["--noEmit"], {
      cwd: "/test",
      timeoutMs: 120_000,
    });

    assert.equal(result.status, "timeout");
    assert.equal(result.success, false);
    // The message must say TIMEOUT, not "exit -1" or "exit 1"
    assert.ok(
      result.message.includes("TIMEOUT"),
      `message must include "TIMEOUT", got: ${result.message}`,
    );
    assert.ok(
      result.message.includes("120000ms"),
      `message must include the timeout duration, got: ${result.message}`,
    );
    // Must NOT say "exit 1" or "exit -1" — that's the old misleading behavior
    assert.ok(
      !result.message.includes("exit 1"),
      `message must not include "exit 1", got: ${result.message}`,
    );
  });

  it("surfaces exit code in the message when the shell reports status=failed (not timeout)", async () => {
    const failedShell: ShellExecutor = {
      cwd: "/test",
      platform: process.platform,
      environment: process.env as Record<string, string>,
      async execute(options: ShellExecuteOptions): Promise<ShellResult> {
        return {
          ok: false,
          status: "failed",
          stdout: "",
          stderr: "error TS1234",
          exitCode: 1,
          durationMs: 5000,
          command: options.command,
          args: options.args ?? [],
          truncated: false,
          pid: 888,
        };
      },
      async cancel(): Promise<number[]> {
        return [];
      },
    };

    const result = await runCommand(failedShell, "tsc", ["--noEmit"], {
      cwd: "/test",
      timeoutMs: 120_000,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.success, false);
    // A real failure must still show "exit 1" — we didn't break that
    assert.ok(
      result.message.includes("exit 1"),
      `message must include "exit 1" for real failures, got: ${result.message}`,
    );
    assert.ok(
      !result.message.includes("TIMEOUT"),
      `message must not include "TIMEOUT" for real failures, got: ${result.message}`,
    );
  });
});
