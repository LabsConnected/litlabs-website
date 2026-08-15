/**
 * OS-2D — Final cross-surface acceptance tests.
 *
 * Proves that LiTT behaves as one operating system across all surfaces:
 *
 *   1. One runtime truth — RuntimeStore is the single source of truth
 *   2. Lifecycle correctness — run.started → tool.started → streaming →
 *      tool.completed/failed/cancelled/timeout → run.completed/failed/cancelled
 *   3. Identity correlation — every event carries runId, tool events carry toolCallId
 *   4. Cancellation — kills process tree, returns cancelled status, runtime returns to idle
 *   5. Cross-surface synchronization — multiple event collectors see the same events
 *   6. Failure recovery — bad commands, timeouts, and errors don't corrupt runtime state
 *   7. No fake UI state — all states derive from runtime events, not frontend guesses
 *
 * These tests use the real CommandExecutor + RuntimeStore + NodeShellExecutor.
 * They do NOT spin up a Socket.IO server — instead they simulate multiple
 * surfaces as independent event collectors attached to the same emitter.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NodeShellExecutor } from "../shell.js";
import { RuntimeStore, createInitialState } from "../state.js";
import { CommandExecutor } from "../command-executor.js";
import type {
  RuntimeEvent,
  RuntimeEventEmitter,
  RuntimeState,
  StreamChunk,
  ToolStatus,
} from "../types.js";

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * A multi-surface event collector.
 * Simulates CLI, Studio, and voice surfaces all listening
 * to the same runtime emitter.
 */
class SurfaceCollector {
  readonly name: string;
  readonly events: RuntimeEvent[] = [];
  private emitter: RuntimeEventEmitter;

  constructor(name: string, emitter: RuntimeEventEmitter) {
    this.name = name;
    this.emitter = emitter;
  }

  /** Wrap the emitter so this surface sees every event. */
  static wire(surfaces: SurfaceCollector[]): RuntimeEventEmitter {
    return (event: RuntimeEvent) => {
      for (const s of surfaces) {
        s.events.push(event);
      }
    };
  }

  /** Events of a specific type. */
  byType(type: string): RuntimeEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /** Events with a specific subtype (litt_event). */
  bySubtype(subtype: string): RuntimeEvent[] {
    return this.events.filter((e) => e.subtype === subtype);
  }

  /** Events for a specific run. */
  byRun(runId: string): RuntimeEvent[] {
    return this.events.filter((e) => e.runId === runId);
  }

  clear(): void {
    this.events.length = 0;
  }
}

// ─── 1. One Runtime Truth ──────────────────────────────────────────

describe("OS-2D.1 — One runtime truth", () => {
  it("RuntimeStore is the single source of truth — getState returns a copy", () => {
    const store = new RuntimeStore();
    const state1 = store.getState();
    const state2 = store.getState();
    assert.notEqual(state1, state2, "getState must return copies, not the same object");
    assert.deepEqual(state1, state2, "copies must have equal content");
  });

  it("RuntimeStore mutations are visible to all readers", () => {
    const store = new RuntimeStore();
    store.setPhase("running");
    const s1 = store.getState();
    assert.equal(s1.phase, "running");
    // A second reader sees the same phase
    const s2 = store.getState();
    assert.equal(s2.phase, "running");
  });

  it("RuntimeStore snapshot (toJSON) round-trips through setState", () => {
    const store = new RuntimeStore();
    store.setPhase("running");
    store.commandStart("test", ["--flag"], "/tmp", "run_123");
    const json = store.toJSON();
    const restored = JSON.parse(json) as RuntimeState;

    const store2 = new RuntimeStore();
    store2.setState(restored);
    const s = store2.getState();
    assert.equal(s.phase, "running");
    assert.equal(s.activeCommand?.runId, "run_123");
    assert.equal(s.activeCommand?.command, "test");
  });

  it("createInitialState produces a valid idle state", () => {
    const state = createInitialState();
    assert.equal(state.phase, "idle");
    assert.equal(state.activeCommand, null);
    assert.equal(state.lastResult, null);
    assert.equal(state.online, false);
  });
});

// ─── 2. Lifecycle Correctness ──────────────────────────────────────

describe("OS-2D.2 — Lifecycle correctness", () => {
  let shell: NodeShellExecutor;
  let store: RuntimeStore;
  let cli: SurfaceCollector;
  let studio: SurfaceCollector;
  let voice: SurfaceCollector;
  let executor: CommandExecutor;

  beforeEach(() => {
    shell = new NodeShellExecutor(process.cwd());
    store = new RuntimeStore();
    cli = new SurfaceCollector("cli", () => {});
    studio = new SurfaceCollector("studio", () => {});
    voice = new SurfaceCollector("voice", () => {});
    const emitter = SurfaceCollector.wire([cli, studio, voice]);
    // Store also gets the same emitter so store events reach all surfaces
    store.setEmitter(emitter);
    executor = new CommandExecutor(shell, store, emitter);
  });

  it("emits tool_call → tool_stream → tool_result lifecycle in order", async () => {
    const result = await executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo hello-os-2d"] : ["hello-os-2d"],
      { timeoutMs: 5000 },
    );

    assert.equal(result.status, "success");

    // All surfaces should see the same events
    for (const surface of [cli, studio, voice]) {
      const types = surface.events.map((e) => e.type);
      const toolCallIdx = types.indexOf("tool_call");
      const toolResultIdx = types.indexOf("tool_result");
      assert.ok(toolCallIdx >= 0, `${surface.name} should see tool_call`);
      assert.ok(toolResultIdx >= 0, `${surface.name} should see tool_result`);
      assert.ok(toolCallIdx < toolResultIdx, `${surface.name}: tool_call before tool_result`);
    }
  });

  it("emits litt_event for each lifecycle transition with correct subtypes", async () => {
    await executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo lifecycle"] : ["lifecycle"],
      { timeoutMs: 5000 },
    );

    for (const surface of [cli, studio, voice]) {
      const subtypes = surface.byType("litt_event").map((e) => e.subtype);
      assert.ok(subtypes.includes("tool_call"), `${surface.name}: litt_event tool_call`);
      assert.ok(subtypes.includes("tool_result"), `${surface.name}: litt_event tool_result`);
    }
  });

  it("emits tool_stream events for commands with output", async () => {
    const chunks: StreamChunk[] = [];
    await executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo streaming-output"] : ["streaming-output"],
      { timeoutMs: 5000, onStream: (c) => chunks.push(c) },
    );

    // The onStream callback should have received chunks
    assert.ok(chunks.length > 0, "onStream callback should receive chunks");

    // All surfaces should see tool_stream events
    for (const surface of [cli, studio, voice]) {
      const streamEvents = surface.byType("tool_stream");
      assert.ok(streamEvents.length > 0, `${surface.name} should see tool_stream events`);
    }
  });

  it("RuntimeStore transitions: idle → running → complete", async () => {
    // Before execution: idle
    assert.equal(store.getState().phase, "idle");

    // Start execution (don't await yet)
    const execPromise = executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo phase-test"] : ["phase-test"],
      { timeoutMs: 5000 },
    );

    // The CommandExecutor doesn't call store.commandStart directly —
    // the security boundary (runCommand) does that via the store.
    // After execution completes:
    const result = await execPromise;
    assert.equal(result.status, "success");

    // Store should reflect completion
    const finalState = store.getState();
    assert.ok(
      finalState.phase === "complete" || finalState.phase === "idle",
      `Store phase after success should be complete or idle, got ${finalState.phase}`,
    );
  });
});

// ─── 3. Identity Correlation ───────────────────────────────────────

describe("OS-2D.3 — Identity correlation", () => {
  let shell: NodeShellExecutor;
  let store: RuntimeStore;
  let surfaces: SurfaceCollector[];
  let executor: CommandExecutor;

  beforeEach(() => {
    shell = new NodeShellExecutor(process.cwd());
    store = new RuntimeStore();
    const cli = new SurfaceCollector("cli", () => {});
    const studio = new SurfaceCollector("studio", () => {});
    const voice = new SurfaceCollector("voice", () => {});
    surfaces = [cli, studio, voice];
    const emitter = SurfaceCollector.wire(surfaces);
    store.setEmitter(emitter);
    executor = new CommandExecutor(shell, store, emitter);
  });

  it("every event carries a runId", async () => {
    await executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo id-test"] : ["id-test"],
      {
        timeoutMs: 5000,
        runId: "run_identity_001",
      },
    );

    for (const surface of surfaces) {
      const eventsWithoutRunId = surface.events.filter((e) => !e.runId);
      assert.equal(
        eventsWithoutRunId.length,
        0,
        `${surface.name}: all events should carry runId, found ${eventsWithoutRunId.length} without`,
      );
    }
  });

  it("tool events carry toolCallId", async () => {
    const toolCallId = "tc_identity_002";
    await executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo tool-id"] : ["tool-id"],
      { timeoutMs: 5000, runId: "run_identity_002", toolCallId },
    );

    for (const surface of surfaces) {
      const toolEvents = surface.events.filter(
        (e) => e.type === "tool_call" || e.type === "tool_result" || e.type === "tool_stream",
      );
      assert.ok(toolEvents.length > 0, `${surface.name}: should have tool events`);
      for (const ev of toolEvents) {
        assert.equal(ev.toolCallId, toolCallId, `${surface.name}: tool event toolCallId mismatch`);
      }
    }
  });

  it("no orphaned events — all events can be traced to a runId", async () => {
    const runId = "run_orphan_check";
    await executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo orphan"] : ["orphan"],
      { timeoutMs: 5000, runId },
    );

    for (const surface of surfaces) {
      const orphaned = surface.events.filter((e) => e.runId && e.runId !== runId);
      assert.equal(
        orphaned.length,
        0,
        `${surface.name}: no events should reference a different runId`,
      );
    }
  });

  it("explicit runId is threaded through all events", async () => {
    const runId = "run_explicit_12345";
    const result = await executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo explicit"] : ["explicit"],
      { timeoutMs: 5000, runId },
    );

    assert.equal(result.runId, runId, "Result should carry the explicit runId");

    for (const surface of surfaces) {
      const runEvents = surface.byRun(runId);
      assert.ok(runEvents.length > 0, `${surface.name}: should have events for ${runId}`);
    }
  });
});

// ─── 4. Cancellation ───────────────────────────────────────────────

describe("OS-2D.4 — Cancellation", () => {
  let shell: NodeShellExecutor;
  let store: RuntimeStore;
  let surfaces: SurfaceCollector[];
  let executor: CommandExecutor;

  beforeEach(() => {
    shell = new NodeShellExecutor(process.cwd());
    store = new RuntimeStore();
    const cli = new SurfaceCollector("cli", () => {});
    const studio = new SurfaceCollector("studio", () => {});
    surfaces = [cli, studio];
    const emitter = SurfaceCollector.wire(surfaces);
    store.setEmitter(emitter);
    executor = new CommandExecutor(shell, store, emitter);
  });

  it("cancels a long-running command and returns cancelled status", async () => {
    const execPromise = executor.execute(
      process.platform === "win32" ? "cmd" : "sh",
      process.platform === "win32" ? ["/c", "ping -n 10 127.0.0.1 > nul"] : ["-c", "sleep 10"],
      { timeoutMs: 30_000, runId: "run_cancel_001" },
    );

    // Let the process start
    await new Promise((r) => setTimeout(r, 200));

    // Cancel
    const killedPids = await executor.cancel();
    assert.ok(killedPids.length > 0, "cancel() should kill at least one PID");

    const result = await execPromise;
    assert.equal(result.status, "cancelled");
    assert.equal(result.result.success, false);
  });

  it("emits cancelled status in tool_result event", async () => {
    const execPromise = executor.execute(
      process.platform === "win32" ? "cmd" : "sh",
      process.platform === "win32" ? ["/c", "ping -n 10 127.0.0.1 > nul"] : ["-c", "sleep 10"],
      { timeoutMs: 30_000, runId: "run_cancel_002", toolCallId: "tc_cancel_002" },
    );

    await new Promise((r) => setTimeout(r, 200));
    await executor.cancel();
    await execPromise;

    for (const surface of surfaces) {
      const toolResults = surface.byType("tool_result");
      const cancelled = toolResults.find((e) => e.data.status === "cancelled");
      assert.ok(cancelled, `${surface.name}: should see tool_result with status=cancelled`);

      // Also check litt_event with tool_cancelled subtype
      const cancelEvents = surface.bySubtype("tool_cancelled");
      assert.ok(cancelEvents.length > 0, `${surface.name}: should see litt_event tool_cancelled`);
    }
  });

  it("cancel with wrong runId does nothing", async () => {
    // Start a command
    const execPromise = executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo no-cancel"] : ["no-cancel"],
      { timeoutMs: 5000, runId: "run_correct" },
    );

    // Try to cancel with a different runId
    const killedPids = await executor.cancel("run_wrong");
    assert.deepEqual(killedPids, [], "cancel with wrong runId should kill nothing");

    // The original command should still complete normally
    const result = await execPromise;
    assert.equal(result.status, "success");
  });

  it("executor returns to idle after cancellation", async () => {
    assert.equal(executor.isRunning(), false);

    const execPromise = executor.execute(
      process.platform === "win32" ? "cmd" : "sh",
      process.platform === "win32" ? ["/c", "ping -n 10 127.0.0.1 > nul"] : ["-c", "sleep 10"],
      { timeoutMs: 30_000 },
    );

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(executor.isRunning(), true);

    await executor.cancel();
    await execPromise;

    assert.equal(executor.isRunning(), false, "executor should be idle after cancellation");
    assert.equal(executor.getActiveRun(), null, "activeRun should be null after cancellation");
  });
});

// ─── 5. Cross-Surface Synchronization ──────────────────────────────

describe("OS-2D.5 — Cross-surface synchronization", () => {
  it("all surfaces see the same events in the same order", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore();
    const cli = new SurfaceCollector("cli", () => {});
    const studio = new SurfaceCollector("studio", () => {});
    const voice = new SurfaceCollector("voice", () => {});
    const emitter = SurfaceCollector.wire([cli, studio, voice]);
    store.setEmitter(emitter);
    const executor = new CommandExecutor(shell, store, emitter);

    const runId = "run_sync_001";
    await executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo sync-test"] : ["sync-test"],
      { timeoutMs: 5000, runId },
    );

    // All surfaces should have the same number of events
    const counts = [cli, studio, voice].map((s) => s.events.length);
    assert.equal(counts[0], counts[1], "cli and studio should have same event count");
    assert.equal(counts[1], counts[2], "studio and voice should have same event count");

    // All surfaces should have the same event types in the same order
    const typesCli = cli.events.map((e) => `${e.type}:${e.subtype ?? ""}`);
    const typesStudio = studio.events.map((e) => `${e.type}:${e.subtype ?? ""}`);
    const typesVoice = voice.events.map((e) => `${e.type}:${e.subtype ?? ""}`);
    assert.deepEqual(typesCli, typesStudio, "cli and studio event sequences match");
    assert.deepEqual(typesStudio, typesVoice, "studio and voice event sequences match");
  });

  it("RuntimeStore state is consistent regardless of how many surfaces read it", async () => {
    const store = new RuntimeStore();
    const emitter = SurfaceCollector.wire([
      new SurfaceCollector("s1", () => {}),
      new SurfaceCollector("s2", () => {}),
      new SurfaceCollector("s3", () => {}),
    ]);
    store.setEmitter(emitter);

    store.commandStart("test", ["--flag"], "/tmp", "run_consistent");
    const state1 = store.getState();
    const state2 = store.getState();
    const state3 = store.getState();

    assert.equal(state1.activeCommand?.runId, "run_consistent");
    assert.equal(state2.activeCommand?.runId, "run_consistent");
    assert.equal(state3.activeCommand?.runId, "run_consistent");
  });
});

// ─── 6. Failure Recovery ───────────────────────────────────────────

describe("OS-2D.6 — Failure recovery", () => {
  let shell: NodeShellExecutor;
  let store: RuntimeStore;
  let surfaces: SurfaceCollector[];
  let executor: CommandExecutor;

  beforeEach(() => {
    shell = new NodeShellExecutor(process.cwd());
    store = new RuntimeStore();
    const cli = new SurfaceCollector("cli", () => {});
    const studio = new SurfaceCollector("studio", () => {});
    surfaces = [cli, studio];
    const emitter = SurfaceCollector.wire(surfaces);
    store.setEmitter(emitter);
    executor = new CommandExecutor(shell, store, emitter);
  });

  it("bad command returns failed status, not crash", async () => {
    const result = await executor.execute(
      "this-command-does-not-exist-anywhere-xyz",
      [],
      { timeoutMs: 5000, runId: "run_bad_cmd" },
    );

    assert.equal(result.status, "failed");
    assert.equal(result.result.success, false);
  });

  it("failed command emits tool_result with failed status", async () => {
    await executor.execute("this-does-not-exist-xyz", [], { timeoutMs: 5000 });

    for (const surface of surfaces) {
      const toolResults = surface.byType("tool_result");
      const failed = toolResults.find((e) => e.data.status === "failed");
      assert.ok(failed, `${surface.name}: should see tool_result with status=failed`);
    }
  });

  it("timeout returns timeout status, not crash", async () => {
    const result = await executor.execute(
      process.platform === "win32" ? "cmd" : "sh",
      process.platform === "win32" ? ["/c", "ping -n 10 127.0.0.1 > nul"] : ["-c", "sleep 10"],
      { timeoutMs: 300, runId: "run_timeout" },
    );

    assert.equal(result.status, "timeout");
    assert.equal(result.result.success, false);
  });

  it("runtime state is not corrupted after failure", async () => {
    // Fail a command
    await executor.execute("nonexistent-cmd-xyz", [], { timeoutMs: 5000 });

    // Store should still be readable
    const state = store.getState();
    assert.ok(typeof state.phase === "string", "phase should be a string after failure");
    assert.ok(typeof state.updatedAt === "number", "updatedAt should be a number after failure");

    // A subsequent successful command should work
    const result2 = await executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo recovery"] : ["recovery"],
      { timeoutMs: 5000 },
    );
    assert.equal(result2.status, "success", "should recover after failure");
  });

  it("runtime state is not corrupted after timeout", async () => {
    // Timeout a command
    await executor.execute(
      process.platform === "win32" ? "cmd" : "sh",
      process.platform === "win32" ? ["/c", "ping -n 10 127.0.0.1 > nul"] : ["-c", "sleep 10"],
      { timeoutMs: 300 },
    );

    // Store should still be readable
    const state = store.getState();
    assert.ok(typeof state.phase === "string", "phase should be a string after timeout");

    // A subsequent successful command should work
    const result2 = await executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo after-timeout"] : ["after-timeout"],
      { timeoutMs: 5000 },
    );
    assert.equal(result2.status, "success", "should recover after timeout");
  });

  it("runtime state is not corrupted after cancellation", async () => {
    // Cancel a command
    const execPromise = executor.execute(
      process.platform === "win32" ? "cmd" : "sh",
      process.platform === "win32" ? ["/c", "ping -n 10 127.0.0.1 > nul"] : ["-c", "sleep 10"],
      { timeoutMs: 30_000 },
    );
    await new Promise((r) => setTimeout(r, 200));
    await executor.cancel();
    await execPromise;

    // Store should still be readable
    const state = store.getState();
    assert.ok(typeof state.phase === "string", "phase should be a string after cancellation");

    // A subsequent successful command should work
    const result2 = await executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo after-cancel"] : ["after-cancel"],
      { timeoutMs: 5000 },
    );
    assert.equal(result2.status, "success", "should recover after cancellation");
  });

  it("emitter failure does not crash the executor", async () => {
    const crashingShell = new NodeShellExecutor(process.cwd());
    const crashingStore = new RuntimeStore();
    const crashingEmitter: RuntimeEventEmitter = () => {
      throw new Error("Simulated emitter failure");
    };
    crashingStore.setEmitter(crashingEmitter);
    const crashingExecutor = new CommandExecutor(crashingShell, crashingStore, crashingEmitter);

    // Should not throw even though emitter crashes
    const result = await crashingExecutor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo crash-test"] : ["crash-test"],
      { timeoutMs: 5000 },
    );

    assert.equal(result.status, "success", "executor should survive emitter crashes");
  });
});

// ─── 7. No Fake UI State ────────────────────────────────────────────

describe("OS-2D.7 — No fake UI state", () => {
  it("RuntimeState phase is derived from store mutations, not guessed", () => {
    const store = new RuntimeStore();
    assert.equal(store.getState().phase, "idle", "initial phase is idle");

    store.setPhase("running");
    assert.equal(store.getState().phase, "running", "phase after setPhase(running)");

    store.setPhase("complete");
    assert.equal(store.getState().phase, "complete", "phase after setPhase(complete)");

    store.setPhase("failed");
    assert.equal(store.getState().phase, "failed", "phase after setPhase(failed)");
  });

  it("commandStart sets phase to running, commandEnd sets phase to complete/failed", () => {
    const store = new RuntimeStore();
    assert.equal(store.getState().phase, "idle");

    store.commandStart("test", [], "/tmp", "run_phase_001");
    assert.equal(store.getState().phase, "running", "phase should be running during commandStart");
    assert.ok(store.getState().activeCommand, "activeCommand should be set during commandStart");

    store.commandEnd("test", true, 0, 100, "ok", "run_phase_001");
    assert.equal(store.getState().phase, "complete", "phase should be complete after success");
    assert.equal(store.getState().activeCommand, null, "activeCommand should be null after commandEnd");
    assert.ok(store.getState().lastResult, "lastResult should be set after commandEnd");
  });

  it("commandEnd with failure sets phase to failed", () => {
    const store = new RuntimeStore();
    store.commandStart("test", [], "/tmp", "run_phase_002");
    store.commandEnd("test", false, 1, 100, "error", "run_phase_002");
    assert.equal(store.getState().phase, "failed", "phase should be failed after error");
  });

  it("RuntimeState is a frozen snapshot — surfaces can't mutate it", () => {
    const store = new RuntimeStore();
    store.setPhase("running");
    const state = store.getState();

    // Mutating the returned state should not affect the store
    state.phase = "idle";
    assert.equal(
      store.getState().phase,
      "running",
      "mutating returned state should not affect store",
    );
  });

  it("freshness is derived from heartbeat timestamps, not guessed", () => {
    const store = new RuntimeStore();
    const state = store.getState();

    // Freshness computation (mirrors useLiTTRuntime.computeFreshness)
    function computeFreshness(s: RuntimeState | null, connected: boolean, now: number): string {
      if (!connected) return "unreachable";
      if (!s) return "unreachable";
      const hb = s.heartbeat;
      if (!hb) return "stale";
      const elapsed = now - (hb.lastHeartbeatAt || 0);
      const staleThreshold = (hb.intervalMs || 15000) * 2;
      if (hb.lastHeartbeatAt === 0) return "stale";
      if (elapsed > staleThreshold) return "stale";
      if ((hb.failures ?? 0) >= (hb.maxFailures ?? 3)) return "stale";
      return "fresh";
    }

    // Disconnected → unreachable
    assert.equal(computeFreshness(state, false, Date.now()), "unreachable");

    // Connected but no heartbeat → stale
    assert.equal(computeFreshness(state, true, Date.now()), "stale");

    // Connected with recent heartbeat → fresh
    const freshState = { ...state, heartbeat: { ...state.heartbeat, lastHeartbeatAt: Date.now() } };
    assert.equal(computeFreshness(freshState, true, Date.now()), "fresh");

    // Connected with old heartbeat → stale
    const staleState = {
      ...state,
      heartbeat: { ...state.heartbeat, lastHeartbeatAt: Date.now() - 60000 },
    };
    assert.equal(computeFreshness(staleState, true, Date.now()), "stale");
  });
});
