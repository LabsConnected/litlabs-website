/**
 * Docker CLI spawn environment (Phase 2 lifecycle, readiness report
 * §3.5): the `docker` CLI child process gets the same allowlist
 * treatment as package scripts (buildPackageScriptEnv) — the
 * terminal's platform secrets must not ride along in its environment.
 * The container itself only ever received its three explicit -e vars;
 * this covers the CLI process env only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildDockerCliEnv, createDockerSession } from "../docker-manager";

class FakeProc extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 5150;
  killed = false;
  kill = vi.fn(() => true);
}

describe("buildDockerCliEnv", () => {
  it("keeps PATH/HOME and DOCKER_* config, forces TERM, drops everything else", () => {
    const env = buildDockerCliEnv({
      PATH: "/usr/bin",
      HOME: "/home/litt",
      TERM: "dumb",
      DOCKER_HOST: "tcp://127.0.0.1:2375",
      DOCKER_CONFIG: "/home/litt/.docker",
      CLERK_SECRET_KEY: "must-not-pass",
      TERMINAL_AUTH_SECRET: "must-not-pass",
      E2B_API_KEY: "must-not-pass",
      RANDOM_PROJECT_VAR: "nope",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/litt");
    expect(env.TERM).toBe("xterm-256color");
    expect(env.DOCKER_HOST).toBe("tcp://127.0.0.1:2375");
    expect(env.DOCKER_CONFIG).toBe("/home/litt/.docker");
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
    expect(env.TERMINAL_AUTH_SECRET).toBeUndefined();
    expect(env.E2B_API_KEY).toBeUndefined();
    expect(env.RANDOM_PROJECT_VAR).toBeUndefined();
  });
});

describe("createDockerSession spawn env", () => {
  let root: string;
  let workspace: string;
  let spawnFn: ReturnType<typeof vi.fn>;
  const PLANTED = "LITT_TEST_PLANTED_SECRET";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "docker-cli-env-"));
    workspace = join(root, "proj");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "package.json"), '{"name":"p"}');
    spawnFn = vi.fn(() => new FakeProc());
    process.env[PLANTED] = "must-not-reach-docker-cli";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env[PLANTED];
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("spawns the docker CLI without the terminal's environment", async () => {
    createDockerSession(
      { userId: "user_1234567890", sessionId: "sess-envtest1", workspace, onData: () => {} },
      { spawn: spawnFn as never },
    );
    // The spawn happens as the session starts; give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(spawnFn).toHaveBeenCalled();
    for (const call of spawnFn.mock.calls) {
      const options = call[2] as { env?: Record<string, string> } | undefined;
      expect(options?.env).toBeDefined();
      expect(options!.env![PLANTED]).toBeUndefined();
      expect(options!.env!.TERM).toBe("xterm-256color");
    }
  });
});
