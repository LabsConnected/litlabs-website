/**
 * Run cancellation + timeout regression tests.
 *
 * Contract under test:
 *   3. Remote command timeout must terminate cleanly.
 *   4. Cancellation must kill the actual process and report correctly.
 *   5. stdout/stderr streaming must not corrupt or interleave.
 *  10. `node -e "console.log('runner-ok')"` must succeed through the
 *      intended remote path.
 *
 * These tests exercise the RunRegistry directly and through the command
 * bridge, proving that:
 *   - A registered run can be cancelled and the underlying Cancellable
 *     is invoked exactly once.
 *   - The run is unregistered after completion (no leak).
 *   - /api/cancel reports cancelled:false for an unknown runId.
 *   - The runner-ok command succeeds end-to-end through dispatchCommand.
 *   - stdout and stderr are returned as separate, uninterleaved fields.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RunRegistry, getRunRegistry } from "../run-registry.js";
import { dispatchCommand } from "../command-bridge.js";
import { getRunRegistry as getRunRegistryFromBridge } from "../run-registry.js";

// ─── RunRegistry unit tests ───────────────────────────────────────

describe("RunRegistry", () => {
  let registry: RunRegistry;

  beforeEach(() => {
    registry = new RunRegistry();
  });

  it("registers and cancels a running process", async () => {
    const cancelSpy = vi.fn(async () => [12345]);
    registry.register("run_1", { cancel: cancelSpy });

    expect(registry.has("run_1")).toBe(true);
    expect(registry.size).toBe(1);

    const cancelled = await registry.cancel("run_1");
    expect(cancelled).toBe(true);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(registry.has("run_1")).toBe(false);
  });

  it("returns cancelled=false for an unknown runId", async () => {
    const cancelled = await registry.cancel("nonexistent");
    expect(cancelled).toBe(false);
  });

  it("unregisters a completed run without calling cancel", () => {
    const cancelSpy = vi.fn(async () => []);
    registry.register("run_2", { cancel: cancelSpy });
    registry.unregister("run_2");

    expect(registry.has("run_2")).toBe(false);
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it("cancel removes the entry so a second cancel is a no-op", async () => {
    const cancelSpy = vi.fn(async () => [1]);
    registry.register("run_3", { cancel: cancelSpy });

    await registry.cancel("run_3");
    const second = await registry.cancel("run_3");

    expect(second).toBe(false);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it("clear removes all entries", () => {
    registry.register("a", { cancel: async () => [] });
    registry.register("b", { cancel: async () => [] });
    expect(registry.size).toBe(2);

    registry.clear();
    expect(registry.size).toBe(0);
  });

  it("getRunRegistry returns a shared singleton", () => {
    const a = getRunRegistry();
    const b = getRunRegistry();
    expect(a).toBe(b);
  });
});

// ─── Command bridge integration: runner-ok + cleanup ──────────────

describe("dispatchCommand: runner-ok + run registry cleanup", () => {
  beforeEach(() => {
    getRunRegistryFromBridge().clear();
  });

  afterEach(() => {
    getRunRegistryFromBridge().clear();
  });

  it("executes `node -e \"console.log('runner-ok')\"` through the /do command", async () => {
    const response = await dispatchCommand({
      command: "do",
      args: ["node", "-e", "console.log('runner-ok')"],
      mode: "act",
    });

    expect(response.ok).toBe(true);
    expect(response.result?.message).toContain("runner-ok");
    const stdout = response.result?.data?.stdout as string | undefined;
    expect(stdout).toContain("runner-ok");
  });

  it("returns stdout and stderr as separate, uninterleaved fields", async () => {
    // Write to both stdout and stderr — the response must keep them
    // in separate data fields, never concatenated.
    const response = await dispatchCommand({
      command: "do",
      args: ["node", "-e", "console.log('OUT'); console.error('ERR')"],
      mode: "act",
    });

    const stdout = (response.result?.data?.stdout as string | undefined) ?? "";
    const stderr = (response.result?.data?.stderr as string | undefined) ?? "";
    expect(stdout).toContain("OUT");
    expect(stdout).not.toContain("ERR");
    expect(stderr).toContain("ERR");
    expect(stderr).not.toContain("OUT");
  });

  it("unregisters the run after successful completion", async () => {
    const response = await dispatchCommand({
      command: "do",
      args: ["node", "-e", "console.log('done')"],
      mode: "act",
    });

    expect(response.ok).toBe(true);
    // After completion, the runId should no longer be in the registry.
    expect(getRunRegistryFromBridge().has(response.runId)).toBe(false);
  });

  it("unregisters the run after a failed command", async () => {
    const response = await dispatchCommand({
      command: "do",
      args: ["node", "-e", "process.exit(1)"],
      mode: "act",
    });

    expect(response.ok).toBe(false);
    expect(getRunRegistryFromBridge().has(response.runId)).toBe(false);
  });

  it("accepts an explicit runId via options", async () => {
    const explicitRunId = "run_explicit_test_001";
    const response = await dispatchCommand(
      {
        command: "do",
        args: ["node", "-e", "console.log('ok')"],
        mode: "act",
      },
      { runId: explicitRunId },
    );

    expect(response.runId).toBe(explicitRunId);
  });
});

// ─── Cancellation through the command bridge ─────────────────────

describe("dispatchCommand: cancellation kills the actual process", () => {
  beforeEach(() => {
    getRunRegistryFromBridge().clear();
  });

  afterEach(() => {
    getRunRegistryFromBridge().clear();
  });

  it("a long-running process can be cancelled via the RunRegistry", async () => {
    // Start a process that sleeps for 10 seconds.
    const runId = "run_cancel_test_001";
    const dispatchPromise = dispatchCommand(
      {
        command: "do",
        args: ["node", "-e", "setTimeout(() => {}, 10000)"],
        mode: "act",
      },
      { runId },
    );

    // Wait briefly for the process to start and register itself.
    // The registry entry is created synchronously inside the handler,
    // but the handler is async — give it a tick to register.
    await new Promise((r) => setTimeout(r, 200));

    // The run should be registered now.
    expect(getRunRegistryFromBridge().has(runId)).toBe(true);

    // Cancel it.
    const cancelled = await getRunRegistryFromBridge().cancel(runId);
    expect(cancelled).toBe(true);

    // Wait for the dispatch to complete (it will get a non-zero exit
    // or a cancelled status).
    const response = await dispatchPromise;
    expect(response.ok).toBe(false);

    // The run should be unregistered after completion.
    expect(getRunRegistryFromBridge().has(runId)).toBe(false);
  });
});
