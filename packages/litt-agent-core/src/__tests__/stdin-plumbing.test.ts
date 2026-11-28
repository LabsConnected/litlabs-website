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

const WIN = process.platform === "win32";
// resolveCommand probes process.env.PATH (not the per-call env option), so
// forcing the cmd-builtin branch means stripping GNU dirs off PATH itself.
function withoutGnuOnPath<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.PATH;
  process.env.PATH = "C:\\Windows\\System32";
  return fn().finally(() => { process.env.PATH = saved; });
}

describe("Windows prompt-prone builtins — no stdin-pipe hangs", { skip: !WIN }, () => {
  it("bare `date` completes promptly — never waits on the cmd prompt", async () => {
    const shell = createShellExecutor(TMP);
    const res = await shell.execute({ command: "date", args: [], timeoutMs: 10_000 });
    assert.notEqual(res.status, "timeout", "bare `date` hung on the interactive prompt");
    assert.equal(res.status, "success");
    assert.match(res.stdout, /\d{4}/); // GNU or `date /t` output — a real date either way
  });

  it("bare `date` via the cmd fallback prints the date (`/t` injected, exit 0)", async () => {
    const shell = createShellExecutor(TMP);
    const res = await withoutGnuOnPath(() =>
      shell.execute({ command: "date", args: [], timeoutMs: 10_000 }));
    assert.equal(res.status, "success"); // /t prints and exits — no prompt abort
    assert.match(res.stdout, /\d{4}/);
  });

  it("`date +%Y` never hangs: GNU date prints the year, cmd fallback aborts honestly", async () => {
    const shell = createShellExecutor(TMP);
    const gnu = await shell.execute({ command: "date", args: ["+%Y"], timeoutMs: 10_000 });
    assert.notEqual(gnu.status, "timeout");
    if (gnu.status === "success") {
      assert.match(gnu.stdout, /^\d{4}/); // Git coreutils date.exe understood +%Y
    }
    // cmd fallback (no GNU on PATH): invalid arg → prompt → stdin EOF → honest abort
    const cmd = await withoutGnuOnPath(() =>
      shell.execute({ command: "date", args: ["+%Y"], timeoutMs: 10_000 }));
    assert.notEqual(cmd.status, "timeout", "cmd `date +%Y` hung instead of aborting");
    assert.notEqual(cmd.status, "success"); // cmd can't parse +%Y — must fail, not fake it
  });

  it("bare `time` completes promptly", async () => {
    const shell = createShellExecutor(TMP);
    const res = await shell.execute({ command: "time", args: [], timeoutMs: 10_000 });
    assert.notEqual(res.status, "timeout");
    assert.equal(res.status, "success");
  });

  it("`pause` gets stdin EOF — returns instead of waiting for a keypress", async () => {
    const shell = createShellExecutor(TMP);
    const res = await shell.execute({ command: "pause", args: [], timeoutMs: 10_000 });
    assert.notEqual(res.status, "timeout", "`pause` waited for input that can never arrive");
  });

  it("explicit stdin still reaches the child (regression guard)", async () => {
    const shell = createShellExecutor(TMP);
    const res = await shell.execute({ command: "findstr", args: ["^"], stdin: "stdin-alive\n" });
    assert.equal(res.status, "success");
    assert.match(res.stdout, /stdin-alive/);
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
