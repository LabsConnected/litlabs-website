/**
 * stdin plumbing regression tests.
 *
 * PR #27 fixed checkpoint command injection by passing the commit message
 * via stdin (`git commit --file=-`). The later ExecutionGateway refactor
 * severed that plumbing: the exec endpoint accepted `inputs.stdin` but
 * nothing downstream piped it to the child process, so `git commit --file=-`
 * blocked on stdin until the gateway timeout — silently breaking checkpoint
 * creation. These tests pin the full chain:
 *
 *   gateway.execute({ inputs.stdin })
 *     → CommandExecutor → runCommand → ShellExecutor.spawn(child.stdin)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import { createShellExecutor } from "../shell.js";
import { runCommand } from "../execution.js";
import { CommandExecutor } from "../command-executor.js";
import { createExecutionGateway } from "../execution-gateway.js";
import { createDefaultRegistry } from "../tools.js";
import type {
  ShellExecutor,
  ShellExecuteOptions,
  ShellResult,
} from "../types.js";

const TMP = os.tmpdir();

describe("stdin plumbing — ShellExecutor", () => {
  it("pipes explicit stdin to the child process", async () => {
    if (process.platform === "win32") return; // `cat` is unix-only
    const shell = createShellExecutor(TMP);
    const result = await shell.execute({ command: "cat", args: [], stdin: "hello-stdin" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "hello-stdin");
  });

  it("works normally when stdin is omitted", async () => {
    const shell = createShellExecutor(TMP);
    const result = await shell.execute({ command: "echo", args: ["hi"] });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /hi/);
  });
});

describe("stdin plumbing — runCommand", () => {
  it("forwards stdin through the security pipeline", async () => {
    if (process.platform === "win32") return;
    const shell = createShellExecutor(TMP);
    const result = await runCommand(shell, "cat", [], { cwd: TMP, stdin: "via-run-command" });
    assert.equal(result.success, true);
    assert.equal((result.data.stdout as string), "via-run-command");
  });

  it("rejects stdin payloads over 1 MiB", async () => {
    const shell = createShellExecutor(TMP);
    const big = "x".repeat(1_048_577);
    const result = await runCommand(shell, "cat", [], { cwd: TMP, stdin: big });
    assert.equal(result.success, false);
    assert.equal(result.data.code, "STDIN_TOO_LARGE");
  });
});

describe("stdin plumbing — CommandExecutor", () => {
  it("forwards options.stdin to the shell", async () => {
    if (process.platform === "win32") return;
    const shell = createShellExecutor(TMP);
    const executor = new CommandExecutor(shell, null, null);
    const res = await executor.execute("cat", [], { cwd: TMP, stdin: "via-executor" });
    assert.equal(res.result.success, true);
    assert.equal(res.result.data.stdout as string, "via-executor");
  });
});

describe("stdin plumbing — ExecutionGateway", () => {
  it("forwards request.inputs.stdin to the shell (the PR #27 regression)", async () => {
    let seen: ShellExecuteOptions | null = null;
    const stubShell: ShellExecutor = {
      cwd: TMP,
      platform: process.platform,
      environment: {},
      cancel: async () => [],
      execute: async (options: ShellExecuteOptions): Promise<ShellResult> => {
        seen = options;
        return {
          ok: true,
          status: "success",
          stdout: "ok",
          stderr: "",
          exitCode: 0,
          durationMs: 1,
          command: options.command,
          args: options.args ?? [],
          truncated: false,
          pid: 0,
        };
      },
    };
    const executor = new CommandExecutor(stubShell, null, null);
    const gateway = createExecutionGateway({
      tools: createDefaultRegistry(),
      shell: stubShell,
      executor,
      store: null,
      projectId: "stdin-test",
    });

    const gwResult = await gateway.execute({
      toolId: "project.run",
      inputs: { command: "echo", args: ["hi"], stdin: "gateway-stdin-payload" },
      cwd: TMP,
      mode: "act",
      identity: {
        tenantId: "test",
        userId: "user_test",
        actorId: "user_test",
        trusted: true,
        interaction: "headless",
      },
    });

    assert.equal(gwResult.result.success, true);
    assert.ok(seen, "shell.execute must have been called");
    assert.equal((seen as ShellExecuteOptions).stdin, "gateway-stdin-payload");
  });
});
