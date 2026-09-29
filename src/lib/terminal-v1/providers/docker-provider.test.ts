/**
 * Docker sandbox provider — execution-policy tests.
 *
 * - `execute()` must NOT run commands via `bash -c` string interpolation.
 * - Shell metacharacters (;, $(), backticks, &&) are passed as literal argv.
 * - Policy-denied ("dangerous") commands are rejected before docker runs.
 *
 * Run: npx vitest run src/lib/terminal-v1/providers/docker-provider.test.ts
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// Hoisted mock for child_process.execFile (execute() calls it directly via
// promisify at module load; the injectable runner only covers create/start).
// NOTE: sync manual mock (not the async importOriginal-spread pattern):
// async factories for node builtins do not propagate to dependency modules
// in this vitest setup, while this form does. `default` is required for the
// CJS interop the transform generates.
const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(),
}));
vi.mock("child_process", () => {
  const mocked = { execFile: execFileMock, spawn: spawnMock };
  return { ...mocked, default: mocked };
});

import {
  DockerSandboxProvider,
  tokenizeCommandLine,
  type DockerCommandRunner,
} from "./docker-provider";

function makeRunner() {
  const execCalls: string[][] = [];
  const runner: DockerCommandRunner = {
    exec: vi.fn(async (args: string[]) => {
      execCalls.push(args);
      return { stdout: "", stderr: "" };
    }),
    spawn: vi.fn(),
  };
  return { runner, execCalls };
}

describe("tokenizeCommandLine", () => {
  it("splits on whitespace", () => {
    expect(tokenizeCommandLine("npm install --save-dev")).toEqual([
      "npm",
      "install",
      "--save-dev",
    ]);
  });

  it("honors quotes", () => {
    expect(tokenizeCommandLine(`echo "hello world" 'it works'`)).toEqual([
      "echo",
      "hello world",
      "it works",
    ]);
  });

  it("keeps shell metacharacters as literal text", () => {
    expect(tokenizeCommandLine("echo hi; rm -rf /")).toEqual([
      "echo",
      "hi;",
      "rm",
      "-rf",
      "/",
    ]);
    expect(tokenizeCommandLine("echo $(whoami)")).toEqual(["echo", "$(whoami)"]);
    expect(tokenizeCommandLine("echo `id`")).toEqual(["echo", "`id`"]);
  });

  it("throws on unterminated quotes", () => {
    expect(() => tokenizeCommandLine('echo "oops')).toThrow(/unterminated/i);
  });

  it("returns [] for blank input", () => {
    expect(tokenizeCommandLine("   ")).toEqual([]);
  });
});

describe("DockerSandboxProvider.execute policy", () => {
  const created: Array<{ provider: DockerSandboxProvider; sandboxId: string }> =
    [];

  // execFile(file, args, options, callback)
  const execFileCalls: Array<{ file: string; args: string[] }> = [];

  beforeEach(() => {
    execFileMock.mockReset();
    execFileCalls.length = 0;
    execFileMock.mockImplementation(
      (
        file: string,
        args: string[],
        _options: unknown,
        callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        execFileCalls.push({ file, args });
        callback(null, { stdout: "", stderr: "" });
      },
    );
  });

  afterEach(async () => {
    for (const { provider, sandboxId } of created.splice(0)) {
      await provider.destroy(sandboxId).catch(() => undefined);
    }
  });

  async function makeSandbox() {
    const { runner } = makeRunner();
    const provider = new DockerSandboxProvider(runner);
    const instance = await provider.create({
      workspaceId: "ws-test",
      userId: "user-test",
      projectId: "proj-test",
      limits: { maxSessionMinutes: 0, idleTimeoutMinutes: 0 },
    });
    created.push({ provider, sandboxId: instance.sandboxId });
    execFileCalls.length = 0; // ignore create/start calls (they use the runner)
    return { provider, sandboxId: instance.sandboxId };
  }

  it("executes argv directly without bash -c", async () => {
    const { provider, sandboxId } = await makeSandbox();
    const result = await provider.execute(sandboxId, { command: "npm install" });
    expect(result.exitCode).toBe(0);
    expect(execFileCalls).toHaveLength(1);
    const { file, args } = execFileCalls[0];
    expect(file).toBe("docker");
    expect(args[0]).toBe("exec");
    expect(args).not.toContain("bash");
    expect(args).not.toContain("-c");
    // container name, then the tokenized argv
    expect(args.slice(2)).toEqual(["npm", "install"]);
  });

  it("neutralizes shell-string injection: ; $() backticks become literal argv", async () => {
    const { provider, sandboxId } = await makeSandbox();
    await provider.execute(sandboxId, {
      command: "echo pwned; rm -rf / && echo $(whoami) `id`",
    });
    const { args } = execFileCalls[0];
    expect(args).not.toContain("bash");
    expect(args.slice(2)).toEqual([
      "echo",
      "pwned;",
      "rm",
      "-rf",
      "/",
      "&&",
      "echo",
      "$(whoami)",
      "`id`",
    ]);
  });

  it("rejects policy-denied commands before docker runs", async () => {
    const { provider, sandboxId } = await makeSandbox();
    await expect(
      provider.execute(sandboxId, { command: "rm -rf /" }),
    ).rejects.toThrow(/denied by execution policy/i);
    await expect(
      provider.execute(sandboxId, { command: "dd if=/dev/zero of=/dev/sda" }),
    ).rejects.toThrow(/denied by execution policy/i);
    expect(execFileCalls).toHaveLength(0);
  });

  it("rejects empty commands", async () => {
    const { provider, sandboxId } = await makeSandbox();
    await expect(provider.execute(sandboxId, { command: "   " })).rejects.toThrow(
      /empty command/i,
    );
    expect(execFileCalls).toHaveLength(0);
  });

  it("still allows safe commands", async () => {
    const { provider, sandboxId } = await makeSandbox();
    await provider.execute(sandboxId, { command: "ls -la /workspace" });
    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].args.slice(2)).toEqual(["ls", "-la", "/workspace"]);
  });
});
