/**
 * PtySessionManager isolation enforcement.
 *
 * Uses an injected spawn factory, so no real process is ever started. The
 * assertion that matters is whether `spawnHost` is called at all: in a
 * production-like environment it must never be, whatever the caller passes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  PtySessionManager,
  type PtyProcessHandle,
  type PtySpawnFactory,
} from "../pty-session-manager.js";
import { TerminalIsolationError } from "../isolation-policy.js";

const ENV_KEYS = [
  "NODE_ENV",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_GIT_COMMIT_SHA",
  "TERMINAL_ALLOW_HOST_SHELL",
  "ALLOW_HOST_SHELL",
  "ALLOW_ANONYMOUS_DEV",
] as const;

const saved: Record<string, string | undefined> = {};

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

function makeFactory() {
  const handle = (): PtyProcessHandle => ({
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  });
  const spawnHost = vi.fn(handle);
  const spawnDocker = vi.fn(handle);
  return { factory: { spawnHost, spawnDocker } as unknown as PtySpawnFactory, spawnHost, spawnDocker };
}

describe("PtySessionManager isolation enforcement", () => {
  let root: string;
  let managers: PtySessionManager[];

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    root = mkdtempSync(join(tmpdir(), "pty-isolation-"));
    managers = [];
  });

  afterEach(() => {
    for (const m of managers) m.shutdown?.();
    rmSync(root, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function createManager(factory: PtySpawnFactory): PtySessionManager {
    const m = new PtySessionManager({}, factory);
    managers.push(m);
    return m;
  }

  function open(m: PtySessionManager, useDocker: boolean) {
    return m.create({
      userId: "user_1",
      cwd: root,
      allowedRoot: root,
      useDocker,
      onData: () => {},
      onExit: () => {},
    });
  }

  it("refuses a host shell in production and never calls spawnHost", () => {
    setEnv({ NODE_ENV: "production" });
    const { factory, spawnHost, spawnDocker } = makeFactory();
    const m = createManager(factory);

    expect(() => open(m, false)).toThrow(TerminalIsolationError);
    expect(spawnHost).not.toHaveBeenCalled();
    expect(spawnDocker).not.toHaveBeenCalled();
    expect(m.size).toBe(0);
  });

  it("refuses a host shell on Railway even when NODE_ENV is development", () => {
    setEnv({ NODE_ENV: "development", RAILWAY_SERVICE_ID: "svc_1" });
    const { factory, spawnHost } = makeFactory();
    const m = createManager(factory);

    expect(() => open(m, false)).toThrow(TerminalIsolationError);
    expect(spawnHost).not.toHaveBeenCalled();
  });

  it("ignores every override variable in production", () => {
    setEnv({
      NODE_ENV: "production",
      TERMINAL_ALLOW_HOST_SHELL: "true",
      ALLOW_HOST_SHELL: "1",
      ALLOW_ANONYMOUS_DEV: "true",
    });
    const { factory, spawnHost } = makeFactory();
    const m = createManager(factory);

    expect(() => open(m, false)).toThrow(TerminalIsolationError);
    expect(spawnHost).not.toHaveBeenCalled();
  });

  it("refuses Docker mode in production too: Docker alone is not verified isolation", () => {
    setEnv({ NODE_ENV: "production" });
    const { factory, spawnHost, spawnDocker } = makeFactory();
    const m = createManager(factory);

    expect(() => open(m, true)).toThrow(TerminalIsolationError);
    expect(spawnDocker).not.toHaveBeenCalled();
    expect(spawnHost).not.toHaveBeenCalled();
    expect(m.size).toBe(0);
  });

  it("refuses Docker mode on Railway even with TERMINAL_USE_DOCKER and override variables set", () => {
    setEnv({
      NODE_ENV: "development",
      RAILWAY_PROJECT_ID: "p",
      TERMINAL_ALLOW_HOST_SHELL: "true",
    });
    const { factory, spawnHost, spawnDocker } = makeFactory();
    const m = createManager(factory);

    expect(() => open(m, true)).toThrow(/execution is disabled in production/);
    expect(spawnDocker).not.toHaveBeenCalled();
    expect(spawnHost).not.toHaveBeenCalled();
  });

  it("uses only the Docker path in local development when Docker mode is on", () => {
    setEnv({ NODE_ENV: "development" });
    const { factory, spawnHost, spawnDocker } = makeFactory();
    const m = createManager(factory);

    const snapshot = open(m, true);
    expect(snapshot.sessionId).toBeTruthy();
    expect(spawnDocker).toHaveBeenCalledTimes(1);
    expect(spawnHost).not.toHaveBeenCalled();
  });

  it("does not fall back to a host shell when the Docker spawn fails (local development)", () => {
    setEnv({ NODE_ENV: "development" });
    const { factory, spawnHost, spawnDocker } = makeFactory();
    spawnDocker.mockImplementation(() => {
      throw new Error("docker unavailable");
    });
    const m = createManager(factory);

    expect(() => open(m, true)).toThrow("docker unavailable");
    expect(spawnHost).not.toHaveBeenCalled();
    expect(m.size).toBe(0);
  });

  it("still allows a host shell in local development", () => {
    setEnv({ NODE_ENV: "development" });
    const { factory, spawnHost } = makeFactory();
    const m = createManager(factory);

    open(m, false);
    expect(spawnHost).toHaveBeenCalledTimes(1);
  });
});
