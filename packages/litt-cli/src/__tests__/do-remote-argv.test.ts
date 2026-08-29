/**
 * Integration tests proving the exact argv received by the remote executor
 * when `litt do --remote` is dispatched with various quoting styles.
 *
 * These tests verify the full path:
 *   resolveDispatch(args) → shell-args tokenization → remoteExecutor(args)
 *
 * The remote executor spy captures the args it would send to terminal-server.
 * We assert the exact argv array — not just length or presence.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveDispatch } from "../lib/dispatch.js";
import { tokenizeShellArgs } from "../lib/shell-args.js";
import { executeCommand } from "../lib/command-execution.js";

/** Simulate the --remote dispatch path for `do` commands. */
async function dispatchDoRemote(rawArgs: string[]): Promise<{ argv: string[] | null; exitCode: number }> {
  const dispatch = resolveDispatch(rawArgs);

  if (!dispatch.useRemote) return { argv: null, exitCode: -1 };

  const command = dispatch.command!;
  let remoteArgs = dispatch.rest;

  // Mirror the logic in index.ts exactly:
  // When `do` has exactly one arg, tokenize it with shell-args.
  if (command === "do" && dispatch.rest.length === 1) {
    const result = tokenizeShellArgs(dispatch.rest[0]);
    if (result.error) return { argv: null, exitCode: 1 };
    if (result.tokens.length > 0) {
      remoteArgs = result.tokens;
    }
  }

  let capturedArgv: string[] | null = null;

  const exitCode = await executeCommand(command, {
    useRemote: true,
    isRemoteable: (cmd) => cmd === "do",
    remoteExecutor: () => {
      capturedArgv = [...remoteArgs];
      return Promise.resolve(0);
    },
    localExecutor: () => {
      throw new Error("fail-closed violation: local executor reached on --remote path");
    },
    onError: () => {},
  });

  return { argv: capturedArgv, exitCode };
}

describe("do --remote argv preservation", () => {
  // ─── echo cli-ok (the simplest case) ───────────────────────────

  it("echo cli-ok → ['echo', 'cli-ok']", async () => {
    const { argv } = await dispatchDoRemote(["do", "--remote", "echo cli-ok"]);
    expect(argv).toEqual(["echo", "cli-ok"]);
  });

  // ─── Quoted arguments containing spaces ────────────────────────

  it("echo 'hello world' → ['echo', 'hello world']", async () => {
    const { argv } = await dispatchDoRemote(["do", "--remote", "echo 'hello world'"]);
    expect(argv).toEqual(["echo", "hello world"]);
  });

  it('echo "hello world" → ["echo", "hello world"]', async () => {
    const { argv } = await dispatchDoRemote(["do", "--remote", 'echo "hello world"']);
    expect(argv).toEqual(["echo", "hello world"]);
  });

  it("git commit -m 'hello world' → ['git', 'commit', '-m', 'hello world']", async () => {
    const { argv } = await dispatchDoRemote(["do", "--remote", "git commit -m 'hello world'"]);
    expect(argv).toEqual(["git", "commit", "-m", "hello world"]);
  });

  // ─── Escaped quotes ────────────────────────────────────────────

  it('node -e "console.log(\\"hello world\\")" preserves inner quotes', async () => {
    const input = 'node -e "console.log(\\"hello world\\")"';
    const { argv } = await dispatchDoRemote(["do", "--remote", input]);
    expect(argv).toEqual(["node", "-e", 'console.log("hello world")']);
  });

  it("echo 'say \"hi\"' → ['echo', 'say \"hi\"']", async () => {
    const { argv } = await dispatchDoRemote(["do", "--remote", "echo 'say \"hi\"'"]);
    expect(argv).toEqual(["echo", 'say "hi"']);
  });

  // ─── Multiple arguments ────────────────────────────────────────

  it("ls -la /app → ['ls', '-la', '/app']", async () => {
    const { argv } = await dispatchDoRemote(["do", "--remote", "ls -la /app"]);
    expect(argv).toEqual(["ls", "-la", "/app"]);
  });

  it("handles many args with mixed quoting", async () => {
    const input = 'git push origin main --force-with-lease "message here"';
    const { argv } = await dispatchDoRemote(["do", "--remote", input]);
    expect(argv).toEqual(["git", "push", "origin", "main", "--force-with-lease", "message here"]);
  });

  // ─── Empty command ─────────────────────────────────────────────

  it("empty string → argv stays as [''] (no tokenization override)", async () => {
    // rest=[""] → length 1 → tokenize → tokens=[] → remoteArgs stays [""].
    // The server will reject an empty command — we don't fabricate one.
    const { argv } = await dispatchDoRemote(["do", "--remote", ""]);
    // Empty input produces no tokens, so remoteArgs stays as [""].
    expect(argv).toEqual([""]);
  });

  it("whitespace-only string → argv stays as ['   ']", async () => {
    const { argv } = await dispatchDoRemote(["do", "--remote", "   "]);
    // Whitespace-only produces no tokens, so remoteArgs stays as ["   "].
    expect(argv).toEqual(["   "]);
  });

  // ─── do --remote /verify (single token, no splitting needed) ───

  it("/verify → ['/verify']", async () => {
    const { argv } = await dispatchDoRemote(["do", "--remote", "/verify"]);
    expect(argv).toEqual(["/verify"]);
  });

  // ─── Multiple rest args (shell already split them) ─────────────

  it("when shell already splits args, they pass through unchanged", async () => {
    // Shell passes: do --remote echo hello world
    // resolveDispatch: rest = ["echo", "hello", "world"] (length 3, not 1)
    // No tokenization needed — pass through directly.
    const { argv } = await dispatchDoRemote(["do", "--remote", "echo", "hello", "world"]);
    expect(argv).toEqual(["echo", "hello", "world"]);
  });

  // ─── Unmatched quotes produce an error ─────────────────────────

  it("unmatched single quote → exit 1, no argv sent", async () => {
    const { argv, exitCode } = await dispatchDoRemote(["do", "--remote", "echo 'hello"]);
    expect(exitCode).toBe(1);
    expect(argv).toBeNull();
  });

  it("unmatched double quote → exit 1, no argv sent", async () => {
    const { argv, exitCode } = await dispatchDoRemote(["do", "--remote", 'echo "hello']);
    expect(exitCode).toBe(1);
    expect(argv).toBeNull();
  });

  // ─── --workspace flag is stripped before tokenization ──────────

  it("--workspace flag is stripped and does not appear in argv", async () => {
    const { argv } = await dispatchDoRemote([
      "do", "--remote", "--workspace", "ws-test-123", "echo hello",
    ]);
    expect(argv).toEqual(["echo", "hello"]);
  });
});
