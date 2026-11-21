/**
 * Install single-flight (round 10, 2026-11-16).
 *
 * Prepare's background install and preview start's inline install run
 * the same package-manager install in the same sandbox. Uncoordinated,
 * they ran concurrently against one store at 1 vCPU / 1024 MB and the
 * preview install was signal-killed mid-flight (exit -1) in the live
 * proof. runSandboxInstallOnce makes the second caller adopt the
 * in-flight install instead of launching a duplicate.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildSandboxInstallEnv,
  describeSandboxInstallExit,
  logSandboxInstallMemoryEvidence,
  runSandboxInstallOnce,
  SANDBOX_INSTALL_CHILD_CONCURRENCY,
  SANDBOX_INSTALL_NETWORK_CONCURRENCY,
  SANDBOX_INSTALL_NODE_HEAP_MB,
  SANDBOX_MEMORY_LIMIT_BYTES,
} from "../sandbox/install-flight";
import type { SandboxProvider } from "../sandbox/provider";
import type { ExecuteCommandResult } from "../sandbox/provider";

function result(exitCode: number): ExecuteCommandResult {
  return { exitCode, stdout: "", stderr: "", durationMs: 1 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runSandboxInstallOnce", () => {
  it("runs the install once for concurrent callers; the second adopts", async () => {
    const gate = deferred<ExecuteCommandResult>();
    const runInstall = vi.fn(() => gate.promise);

    const owner = runSandboxInstallOnce("sbx-flight-1", runInstall);
    const adopter = runSandboxInstallOnce("sbx-flight-1", runInstall);
    expect(runInstall).toHaveBeenCalledTimes(1);

    gate.resolve(result(0));
    const [ownerFlight, adopterFlight] = await Promise.all([owner, adopter]);
    expect(ownerFlight).toEqual({ result: result(0), adopted: false });
    expect(adopterFlight).toEqual({ result: result(0), adopted: true });
  });

  it("clears the flight when it settles — a later caller installs fresh", async () => {
    const runInstall = vi.fn(async () => result(0));
    await runSandboxInstallOnce("sbx-flight-2", runInstall);
    const second = await runSandboxInstallOnce("sbx-flight-2", runInstall);
    expect(runInstall).toHaveBeenCalledTimes(2);
    expect(second.adopted).toBe(false);
  });

  it("keys flights by sandboxId — different sandboxes install independently", async () => {
    const runA = vi.fn(async () => result(0));
    const runB = vi.fn(async () => result(0));
    const [a, b] = await Promise.all([
      runSandboxInstallOnce("sbx-flight-3a", runA),
      runSandboxInstallOnce("sbx-flight-3b", runB),
    ]);
    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).toHaveBeenCalledTimes(1);
    expect(a.adopted).toBe(false);
    expect(b.adopted).toBe(false);
  });

  it("propagates a rejection to owner and adopter alike, then clears", async () => {
    const boom = new Error("transport died");
    const runInstall = vi.fn(async (): Promise<ExecuteCommandResult> => {
      throw boom;
    });
    const owner = runSandboxInstallOnce("sbx-flight-4", runInstall);
    const adopter = runSandboxInstallOnce("sbx-flight-4", runInstall);
    await expect(owner).rejects.toThrow("transport died");
    await expect(adopter).rejects.toThrow("transport died");

    // The failed flight does not poison the sandbox: the next caller
    // starts a fresh install.
    const retry = await runSandboxInstallOnce("sbx-flight-4", async () => result(0));
    expect(retry).toEqual({ result: result(0), adopted: false });
  });
});

/**
 * Install memory shaping (round 12, 2026-11-16). The install ran
 * unshaped while the tree's .npmrc allowed a 4 GB Node heap inside
 * the 1 GB sandbox — no GC backpressure before the cgroup ceiling.
 * buildSandboxInstallEnv is the single env both install sites pass;
 * these tests pin the shaping values and their relationship to the
 * sandbox limit.
 */
describe("buildSandboxInstallEnv (round 12)", () => {
  it("caps the install's Node heap safely under the sandbox memory limit", () => {
    const env = buildSandboxInstallEnv("/home/litt");
    expect(env.NODE_OPTIONS).toBe(`--max-old-space-size=${SANDBOX_INSTALL_NODE_HEAP_MB}`);
    expect(SANDBOX_INSTALL_NODE_HEAP_MB).toBe(768);
    // The cap must leave real headroom under the enforced ceiling —
    // a cap at (or above) the limit would be no shaping at all.
    expect(SANDBOX_INSTALL_NODE_HEAP_MB * 1024 * 1024).toBeLessThan(SANDBOX_MEMORY_LIMIT_BYTES);
    expect(SANDBOX_MEMORY_LIMIT_BYTES).toBe(4294967296);
    // And it must actually override the tree .npmrc's 4096 allowance.
    expect(SANDBOX_INSTALL_NODE_HEAP_MB).toBeLessThan(4096);
  });

  it("bounds pnpm concurrency to single-vCPU values", () => {
    const env = buildSandboxInstallEnv("/home/litt");
    expect(env.npm_config_network_concurrency).toBe(String(SANDBOX_INSTALL_NETWORK_CONCURRENCY));
    expect(env.npm_config_child_concurrency).toBe(String(SANDBOX_INSTALL_CHILD_CONCURRENCY));
    expect(SANDBOX_INSTALL_NETWORK_CONCURRENCY).toBe(4);
    expect(SANDBOX_INSTALL_CHILD_CONCURRENCY).toBe(2);
  });

  it("keeps the pre-existing install env contract (NODE_ENV, root check, HOME pin)", () => {
    const env = buildSandboxInstallEnv("/home/litt");
    expect(env.NODE_ENV).toBe("development");
    expect(env.NPM_CONFIG_IGNORE_WORKSPACE_ROOT_CHECK).toBe("true");
    expect(env.HOME).toBe("/home/litt");
  });
});

/**
 * Install memory evidence (round 12, 2026-11-16). After each install
 * attempt the sandbox's cgroup peak (and, on a signal kill, the
 * kernel's OOM lines) are read back and logged, so the next exit -1
 * settles itself. The read is strictly best-effort.
 */
describe("logSandboxInstallMemoryEvidence (round 12)", () => {
  function evidenceProvider(stdout: string, commands: string[]) {
    return {
      execute: vi.fn(async (_sandboxId: string, input: { command: string }) => {
        commands.push(input.command);
        return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
      }),
    } as unknown as SandboxProvider;
  }

  it("logs peak vs limit after a successful install, without a dmesg read", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    await logSandboxInstallMemoryEvidence({
      provider: evidenceProvider("LITT_MEMORY_PEAK=1048576000\n", commands),
      sandboxId: "sbx-ev-1",
      install: result(0),
      log: (m) => logs.push(m),
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("/sys/fs/cgroup/memory.peak");
    expect(commands[0]).not.toContain("dmesg");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("[sandbox-lifecycle] install memory evidence");
    expect(logs[0]).toContain("sandbox=sbx-ev-1");
    expect(logs[0]).toContain("exit=0");
    expect(logs[0]).toContain("memory.peak=1048576000");
    expect(logs[0]).toContain("limit=4294967296");
  });

  it("on a signal kill, also captures and logs the kernel OOM lines", async () => {
    const commands: string[] = [];
    const logs: string[] = [];
    const stdout =
      "LITT_MEMORY_PEAK=1073741824\n" +
      "[12345.6] Memory cgroup out of memory: Killed process 4242 (node) total-vm:3900000kB, anon-rss:980000kB\n";
    await logSandboxInstallMemoryEvidence({
      provider: evidenceProvider(stdout, commands),
      sandboxId: "sbx-ev-2",
      install: result(-1),
      log: (m) => logs.push(m),
    });
    expect(commands[0]).toContain("dmesg");
    expect(commands[0]).toContain("out of memory|oom-kill|killed process");
    expect(logs[0]).toContain("exit=-1");
    expect(logs[0]).toContain("memory.peak=1073741824");
    expect(logs.some((l) => l.includes("kernel:") && l.includes("Killed process 4242"))).toBe(true);
  });

  it("logs peak=unknown when the read returns no parseable peak", async () => {
    const logs: string[] = [];
    await logSandboxInstallMemoryEvidence({
      provider: evidenceProvider("", []),
      sandboxId: "sbx-ev-3",
      install: result(1),
      log: (m) => logs.push(m),
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("exit=1");
    expect(logs[0]).toContain("memory.peak=unknown");
  });

  it("a failing evidence read is swallowed — it can never fail the install path", async () => {
    const provider = {
      execute: vi.fn(async () => {
        throw new Error("sandbox gone");
      }),
    } as unknown as SandboxProvider;
    const logs: string[] = [];
    await expect(
      logSandboxInstallMemoryEvidence({
        provider,
        sandboxId: "sbx-ev-4",
        install: result(-1),
        log: (m) => logs.push(m),
      }),
    ).resolves.toBeUndefined();
    expect(logs).toHaveLength(0);
  });
});

describe("describeSandboxInstallExit", () => {
  it("names a negative exit as a signal kill (the exit -1 of the proof)", () => {
    const note = describeSandboxInstallExit(result(-1));
    expect(note).toContain("killed by a signal");
    expect(note).toContain("exit -1");
  });

  it("stays silent for normal exits and ordinary failures", () => {
    expect(describeSandboxInstallExit(result(0))).toBeNull();
    expect(describeSandboxInstallExit(result(1))).toBeNull();
  });
});

/**
 * Round 13 (2026-11-17): the evidence read resolves the cgroup
 * directory from /proc/self/cgroup before the hardcoded paths — in
 * the E2B guest the sandbox's accounting lives under a scoped v2
 * subpath, so both literal paths were absent and every live line
 * read memory.peak=unknown. When no path yields a number, the
 * read's first stderr line is logged alongside the unknown, so the
 * evidence can never fail silently again.
 */
describe("logSandboxInstallMemoryEvidence — cgroup resolution (round 13)", () => {
  function evidenceProvider(stdout: string, commands: string[]) {
    return {
      execute: vi.fn(async (_sandboxId: string, input: { command: string }) => {
        commands.push(input.command);
        return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
      }),
    } as unknown as SandboxProvider;
  }

  it("resolves the cgroup dir from /proc/self/cgroup, keeping the canonical paths as fallbacks", async () => {
    const commands: string[] = [];
    await logSandboxInstallMemoryEvidence({
      provider: evidenceProvider("LITT_MEMORY_PEAK=1048576000\n", commands),
      sandboxId: "sbx-ev-5",
      install: result(0),
      log: () => {},
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("/proc/self/cgroup");
    expect(commands[0]).toContain("/sys/fs/cgroup${cg}/memory.peak");
    expect(commands[0]).toContain("/sys/fs/cgroup/memory.peak");
    expect(commands[0]).toContain("/sys/fs/cgroup/memory/memory.max_usage_in_bytes");
  });

  it("logs the raw read failure alongside an unknown peak", async () => {
    const logs: string[] = [];
    const stdout =
      "LITT_MEMORY_PEAK=unknown\n" +
      "LITT_MEMORY_PEAK_ERR=cat: /sys/fs/cgroup/memory/memory.max_usage_in_bytes: No such file or directory\n";
    await logSandboxInstallMemoryEvidence({
      provider: evidenceProvider(stdout, []),
      sandboxId: "sbx-ev-6",
      install: result(0),
      log: (m) => logs.push(m),
    });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("memory.peak=unknown");
    expect(logs[1]).toContain("peak read failed");
    expect(logs[1]).toContain("No such file or directory");
  });

  it("a known peak logs no failure line even when an err line rides along", async () => {
    const logs: string[] = [];
    const stdout =
      "LITT_MEMORY_PEAK=1048576000\n" +
      "LITT_MEMORY_PEAK_ERR=cat: /sys/fs/cgroup/memory.peak: No such file or directory\n";
    await logSandboxInstallMemoryEvidence({
      provider: evidenceProvider(stdout, []),
      sandboxId: "sbx-ev-7",
      install: result(0),
      log: (m) => logs.push(m),
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("memory.peak=1048576000");
  });
});
