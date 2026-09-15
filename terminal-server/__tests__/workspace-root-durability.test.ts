import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  evaluateWorkspaceRoot,
  isEphemeralPath,
  isSeparateMount,
} from "../workspace/durability";

describe("isEphemeralPath", () => {
  it("flags /tmp and os.tmpdir()", () => {
    expect(isEphemeralPath("/tmp/littree-workspaces")).toBe(true);
    expect(isEphemeralPath(join(tmpdir(), "ws"))).toBe(true);
    expect(isEphemeralPath("/var/tmp/ws")).toBe(true);
    expect(isEphemeralPath("/dev/shm/ws")).toBe(true);
  });

  it("accepts durable paths", () => {
    expect(isEphemeralPath("/data/littree-workspaces")).toBe(false);
    expect(isEphemeralPath("/home/user/workspaces")).toBe(false);
    expect(isEphemeralPath("/tmpdata/ws")).toBe(false);
  });
});

describe("isSeparateMount", () => {
  it("reports the filesystem root as mounted", () => {
    expect(isSeparateMount("/")).toBe(true);
  });

  it("reports a plain subdirectory as not mounted", () => {
    const dir = mkdtempSync(join(tmpdir(), "litt-notmnt-"));
    try {
      // tmpdir may itself be a mount on some systems; only assert when
      // the platform could read /proc/mounts at all.
      const result = isSeparateMount(join(dir, "sub"));
      if (result !== null) expect(result).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("evaluateWorkspaceRoot", () => {
  afterEach(() => {
    delete process.env.TERMINAL_WORKSPACE_ROOT;
  });

  it("fails in production when TERMINAL_WORKSPACE_ROOT is unset", () => {
    const verdict = evaluateWorkspaceRoot({
      nodeEnv: "production",
      configuredRoot: undefined,
      resolvedRoot: "/tmp/littree-workspaces",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/ephemeral/i);
  });

  it("fails in production when the root resolves under /tmp", () => {
    const verdict = evaluateWorkspaceRoot({
      nodeEnv: "production",
      configuredRoot: "/tmp/littree-workspaces",
      resolvedRoot: "/tmp/littree-workspaces",
    });
    expect(verdict.ok).toBe(false);
  });

  it("fails in production when the root is not a mounted volume", () => {
    // Non-ephemeral path that is determinably not a mountpoint — the
    // exact failure mode found in production: env var pointed at
    // /data/... but nothing was mounted there.
    const unmounted = "/data/litt-test-unmounted-9x7q/workspaces";
    const mounted = isSeparateMount(unmounted);
    if (mounted === false) {
      const verdict = evaluateWorkspaceRoot({
        nodeEnv: "production",
        configuredRoot: unmounted,
        resolvedRoot: unmounted,
      });
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toMatch(/not a mounted volume/i);
    }
    // When the platform cannot inspect mounts, the check is skipped.
  });

  it("passes in production for a mounted non-ephemeral root", () => {
    const verdict = evaluateWorkspaceRoot({
      nodeEnv: "production",
      configuredRoot: "/",
      resolvedRoot: "/",
    });
    expect(verdict.ok).toBe(true);
  });

  it("warns but does not fail outside production", () => {
    const verdict = evaluateWorkspaceRoot({
      nodeEnv: "development",
      configuredRoot: undefined,
      resolvedRoot: "/tmp/littree-workspaces",
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toMatch(/ephemeral|will not survive/i);
  });
});
