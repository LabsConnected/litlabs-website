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
  describeSandboxInstallExit,
  runSandboxInstallOnce,
} from "../sandbox/install-flight";
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
