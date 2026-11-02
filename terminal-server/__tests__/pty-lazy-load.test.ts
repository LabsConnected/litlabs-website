/**
 * Lazy node-pty loading regression tests.
 *
 * Regression: node-pty used to be imported at module scope. A missing or
 * ABI-mismatched native binding (pty.node / conpty) threw inside the CJS
 * loader and killed the whole terminal-server process at startup — taking
 * the workspace file transport (HTTP) down with it and crash-looping any
 * supervisor that restarted it.
 *
 * These tests prove:
 *   - Importing/constructing the default manager never touches the binding.
 *   - A binding failure surfaces as a create() error (client-visible),
 *     not a process crash, and leaves no ghost session.
 *   - The failure is cached — the loader is attempted once, not per spawn.
 *   - probeHostPty() reports the failure with its reason for /health.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { useTrustedLocalEnv } from "./helpers/trusted-local-env";
import {
  PtySessionManager,
  probeHostPty,
  __setNodePtyLoaderForTests,
} from "../pty-session-manager.js";

useTrustedLocalEnv();

describe("lazy node-pty loading", () => {
  let root: string;
  let cwd: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "litt-pty-lazy-"));
    cwd = join(root, "ws");
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    __setNodePtyLoaderForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("does not touch the native binding at construction time", () => {
    let calls = 0;
    __setNodePtyLoaderForTests(() => {
      calls++;
      throw new Error("must not load yet");
    });
    const manager = new PtySessionManager(); // default factory — real loader path
    expect(calls).toBe(0);
    manager.shutdown();
  });

  it("surfaces a binding failure as a create() error, not a crash", () => {
    __setNodePtyLoaderForTests(() => {
      throw new Error("Cannot find module './prebuilds/linux-arm64/pty.node'");
    });
    const manager = new PtySessionManager();

    let thrown: Error | null = null;
    try {
      manager.create({
        userId: "user-1",
        cwd,
        allowedRoot: root,
        useDocker: false,
        onData: () => {},
        onExit: () => {},
      });
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("Host terminal unavailable");
    expect(thrown!.message).toContain("pty.node");
    // No ghost session left behind after a failed spawn.
    expect(manager.size).toBe(0);
    manager.shutdown();
  });

  it("caches the binding failure — loader is attempted once", () => {
    let calls = 0;
    __setNodePtyLoaderForTests(() => {
      calls++;
      throw new Error("binding gone");
    });
    const manager = new PtySessionManager();

    for (let i = 0; i < 3; i++) {
      expect(() =>
        manager.create({
          userId: "user-1",
          cwd,
          allowedRoot: root,
          useDocker: false,
          onData: () => {},
          onExit: () => {},
        }),
      ).toThrow(/Host terminal unavailable/);
    }
    expect(calls).toBe(1);
    expect(manager.size).toBe(0);
    manager.shutdown();
  });

  it("probeHostPty reports the cached failure reason for /health", () => {
    __setNodePtyLoaderForTests(() => {
      throw new Error("conpty.dll unavailable");
    });
    const status = probeHostPty();
    expect(status.available).toBe(false);
    expect(status.reason).toContain("conpty.dll unavailable");
    // Cached — a second probe returns the same object shape without re-throwing.
    expect(probeHostPty()).toEqual(status);
  });

  it("probeHostPty reports available when the binding loads", () => {
    const fakePty = { spawn: () => ({}) };
    __setNodePtyLoaderForTests(() => fakePty as never);
    expect(probeHostPty()).toEqual({ available: true, reason: null });
  });
});
