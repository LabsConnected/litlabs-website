/**
 * Regression test for the checkpoint command-injection fix (P0-3).
 *
 * The fix (PR #27) replaced shell-string interpolation of a user-supplied
 * git commit label with `git commit --file=-` plus a `stdin` field threaded
 * through the request. That `stdin` field was read out of the HTTP request
 * body in the checkpoints route and the terminal-server exec endpoint, but
 * was never actually forwarded into NodeShellExecutor.execute() — so any
 * command that reads from stdin (like `git commit --file=-`) would block on
 * an open-but-unwritten pipe until the process timeout, instead of receiving
 * the data. This test proves stdin is written and closed for real.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NodeShellExecutor } from "../shell.js";
import { runCommand } from "../execution.js";

describe("NodeShellExecutor stdin", () => {
  it("delivers stdin content to the child process", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const result = await shell.execute({
      command: "cat",
      args: [],
      timeoutMs: 5000,
      stdin: "hello from stdin\n",
    });

    assert.equal(result.status, "success");
    assert.equal(result.stdout, "hello from stdin\n");
  });

  it("closes stdin immediately when none is provided, instead of hanging", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const t0 = Date.now();
    // `cat` with no args reads from stdin until EOF. If stdin is never
    // closed, this blocks until the timeout fires (5000ms below). If stdin
    // is closed immediately (the fix), cat exits right away with no output.
    const result = await shell.execute({
      command: "cat",
      args: [],
      timeoutMs: 5000,
    });
    const elapsedMs = Date.now() - t0;

    assert.equal(result.status, "success");
    assert.equal(result.stdout, "");
    assert.ok(elapsedMs < 2000, `expected cat to exit fast on closed stdin, took ${elapsedMs}ms`);
  });
});

describe("runCommand stdin passthrough", () => {
  it("forwards options.stdin through to the shell executor", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const result = await runCommand(shell, "cat", [], { stdin: "commit message body\n" });

    assert.equal(result.status, "success");
    assert.equal(result.data.stdout, "commit message body\n");
  });
});

describe("git commit --file=- via stdin (checkpoint code path)", () => {
  it("commits using a message delivered over stdin, not the command string", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs");
    const path = await import("node:path");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-checkpoint-stdin-"));
    const shell = new NodeShellExecutor(tmpDir);

    await shell.execute({ command: "git", args: ["init", "-q"], cwd: tmpDir, timeoutMs: 5000 });
    await shell.execute({ command: "git", args: ["config", "user.email", "test@example.com"], cwd: tmpDir, timeoutMs: 5000 });
    await shell.execute({ command: "git", args: ["config", "user.name", "Test"], cwd: tmpDir, timeoutMs: 5000 });
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "content\n");
    await shell.execute({ command: "git", args: ["add", "."], cwd: tmpDir, timeoutMs: 5000 });

    // A label containing shell metacharacters that would have been
    // dangerous under the old `git commit -m "${label}"` interpolation.
    const dangerousLabel = "checkpoint `touch /tmp/pwned` $(echo pwned)";

    const commitResult = await shell.execute({
      command: "git",
      args: ["commit", "--file=-"],
      cwd: tmpDir,
      timeoutMs: 5000,
      stdin: dangerousLabel,
    });

    assert.equal(commitResult.status, "success", commitResult.stderr);

    const logResult = await shell.execute({
      command: "git",
      args: ["log", "-1", "--pretty=%B"],
      cwd: tmpDir,
      timeoutMs: 5000,
    });
    assert.ok(logResult.stdout.includes(dangerousLabel.split(" ")[0]));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
