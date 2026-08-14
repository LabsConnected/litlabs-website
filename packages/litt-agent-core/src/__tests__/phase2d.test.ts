/**
 * Phase 2D tests — runtime consumption: freshness, stale, reconnect.
 *
 * Tests the deterministic freshness computation that both PowerShell
 * and litbit-web use to classify runtime state as fresh/stale/unreachable.
 *
 * Uses injected time (no real sleeps) for deterministic behavior.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Freshness computation (mirrors useLiTTRuntime.computeFreshness) ──

interface HeartbeatStatus {
  seq: number;
  lastHeartbeatAt: number;
  failures: number;
  maxFailures: number;
  intervalMs: number;
  latencyMs: number | null;
}

interface RuntimeState {
  phase: string;
  project: unknown;
  branch: string | null;
  model: string | null;
  profile: string | null;
  gitChanges: number;
  online: boolean;
  pingMs: number;
  contextTokens: number;
  heartbeat: HeartbeatStatus;
  activeCommand: unknown;
  lastResult: unknown;
  updatedAt: number;
}

type Freshness = "fresh" | "stale" | "unreachable";

function computeFreshness(
  state: RuntimeState | null,
  connected: boolean,
  now: number,
): Freshness {
  if (!connected) return "unreachable";
  if (!state) return "unreachable";

  const hb = state.heartbeat;
  if (!hb) return "stale";

  const elapsed = now - (hb.lastHeartbeatAt || 0);
  const staleThreshold = (hb.intervalMs || 15000) * 2;

  if (hb.lastHeartbeatAt === 0) return "stale";
  if (elapsed > staleThreshold) return "stale";
  if ((hb.failures ?? 0) >= (hb.maxFailures ?? 3)) return "stale";

  return "fresh";
}

// ─── Helpers ───────────────────────────────────────────────────────

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    phase: "idle",
    project: null,
    branch: null,
    model: null,
    profile: null,
    gitChanges: 0,
    online: true,
    pingMs: 10,
    contextTokens: 0,
    heartbeat: {
      seq: 1,
      lastHeartbeatAt: 1000,
      failures: 0,
      maxFailures: 3,
      intervalMs: 15000,
      latencyMs: 10,
    },
    activeCommand: null,
    lastResult: null,
    updatedAt: 1000,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("Phase 2D — Freshness: fresh immediately after heartbeat", () => {
  it("returns fresh when heartbeat just happened", () => {
    const now = 1100;
    const state = makeState({
      heartbeat: {
        seq: 1,
        lastHeartbeatAt: 1000,
        failures: 0,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: 10,
      },
    });
    assert.equal(computeFreshness(state, true, now), "fresh");
  });

  it("returns fresh when heartbeat is within 1x interval", () => {
    const now = 16000; // 15s after heartbeat at 1000
    const state = makeState({
      heartbeat: {
        seq: 1,
        lastHeartbeatAt: 1000,
        failures: 0,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: 10,
      },
    });
    assert.equal(computeFreshness(state, true, now), "fresh");
  });

  it("returns fresh when heartbeat is just under 2x threshold", () => {
    const now = 30000; // 29s after heartbeat at 1000, threshold = 30s
    const state = makeState({
      heartbeat: {
        seq: 1,
        lastHeartbeatAt: 1000,
        failures: 0,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: 10,
      },
    });
    assert.equal(computeFreshness(state, true, now), "fresh");
  });
});

describe("Phase 2D — Freshness: stale after controlled elapsed time", () => {
  it("returns stale when heartbeat exceeds 2x interval", () => {
    const now = 40000; // 39s after, threshold = 30s
    const state = makeState({
      heartbeat: {
        seq: 1,
        lastHeartbeatAt: 1000,
        failures: 0,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: 10,
      },
    });
    assert.equal(computeFreshness(state, true, now), "stale");
  });

  it("returns stale when lastHeartbeatAt is 0 (never heartbeated)", () => {
    const state = makeState({
      heartbeat: {
        seq: 0,
        lastHeartbeatAt: 0,
        failures: 0,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: null,
      },
    });
    assert.equal(computeFreshness(state, true, 5000), "stale");
  });

  it("returns stale when failures >= maxFailures", () => {
    const now = 1100;
    const state = makeState({
      heartbeat: {
        seq: 5,
        lastHeartbeatAt: 1000,
        failures: 3,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: null,
      },
    });
    assert.equal(computeFreshness(state, true, now), "stale");
  });

  it("returns stale when failures exceed maxFailures", () => {
    const now = 1100;
    const state = makeState({
      heartbeat: {
        seq: 10,
        lastHeartbeatAt: 1000,
        failures: 5,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: null,
      },
    });
    assert.equal(computeFreshness(state, true, now), "stale");
  });
});

describe("Phase 2D — Freshness: unreachable when disconnected", () => {
  it("returns unreachable when socket is disconnected", () => {
    const state = makeState();
    assert.equal(computeFreshness(state, false, 1100), "unreachable");
  });

  it("returns unreachable when state is null", () => {
    assert.equal(computeFreshness(null, true, 1100), "unreachable");
  });

  it("returns unreachable when both disconnected and null", () => {
    assert.equal(computeFreshness(null, false, 1100), "unreachable");
  });
});

describe("Phase 2D — Freshness: heartbeat refresh returns to fresh", () => {
  it("stale → fresh after heartbeat refresh", () => {
    // First, state is stale (old heartbeat)
    const oldNow = 50000;
    const state = makeState({
      heartbeat: {
        seq: 1,
        lastHeartbeatAt: 1000,
        failures: 0,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: 10,
      },
    });
    assert.equal(computeFreshness(state, true, oldNow), "stale");

    // Heartbeat refreshes — new lastHeartbeatAt
    const refreshedState = makeState({
      heartbeat: {
        seq: 2,
        lastHeartbeatAt: 50000, // just happened
        failures: 0,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: 12,
      },
    });
    const newNow = 50100;
    assert.equal(computeFreshness(refreshedState, true, newNow), "fresh");
  });

  it("stale (failures) → fresh after failures reset", () => {
    // Stale due to failures
    const state = makeState({
      heartbeat: {
        seq: 5,
        lastHeartbeatAt: 1000,
        failures: 3,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: null,
      },
    });
    assert.equal(computeFreshness(state, true, 1100), "stale");

    // Heartbeat succeeds, failures reset to 0
    const recoveredState = makeState({
      heartbeat: {
        seq: 6,
        lastHeartbeatAt: 1100,
        failures: 0,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: 8,
      },
    });
    assert.equal(computeFreshness(recoveredState, true, 1200), "fresh");
  });

  it("unreachable → fresh after reconnect with snapshot", () => {
    // Disconnected
    const state = makeState();
    assert.equal(computeFreshness(state, false, 1100), "unreachable");

    // Reconnected with fresh snapshot
    const reconnectedState = makeState({
      heartbeat: {
        seq: 10,
        lastHeartbeatAt: 2000,
        failures: 0,
        maxFailures: 3,
        intervalMs: 15000,
        latencyMs: 15,
      },
    });
    assert.equal(computeFreshness(reconnectedState, true, 2100), "fresh");
  });
});

describe("Phase 2D — Freshness: custom intervals", () => {
  it("respects custom intervalMs for stale threshold", () => {
    const state = makeState({
      heartbeat: {
        seq: 1,
        lastHeartbeatAt: 1000,
        failures: 0,
        maxFailures: 3,
        intervalMs: 5000, // 5s interval, 10s threshold
        latencyMs: 5,
      },
    });
    // 8s after — under 10s threshold → fresh
    assert.equal(computeFreshness(state, true, 9000), "fresh");
    // 12s after — over 10s threshold → stale
    assert.equal(computeFreshness(state, true, 13000), "stale");
  });

  it("respects custom maxFailures", () => {
    const state = makeState({
      heartbeat: {
        seq: 5,
        lastHeartbeatAt: 1000,
        failures: 2,
        maxFailures: 5, // higher threshold
        intervalMs: 15000,
        latencyMs: null,
      },
    });
    // 2 failures < 5 maxFailures → fresh (time is within range)
    assert.equal(computeFreshness(state, true, 1100), "fresh");
  });
});

describe("Phase 2D — Freshness: edge cases", () => {
  it("handles missing heartbeat gracefully", () => {
    const state = makeState({ heartbeat: undefined as unknown as HeartbeatStatus });
    assert.equal(computeFreshness(state, true, 1100), "stale");
  });

  it("handles zero intervalMs without crashing", () => {
    const state = makeState({
      heartbeat: {
        seq: 1,
        lastHeartbeatAt: 1000,
        failures: 0,
        maxFailures: 3,
        intervalMs: 0,
        latencyMs: 10,
      },
    });
    // intervalMs=0 is falsy, so || fallback uses 15000 → threshold=30000
    // elapsed=1 < 30000 → fresh (degenerate but doesn't crash)
    assert.equal(computeFreshness(state, true, 1001), "fresh");
  });
});

// ─── Integration: runId identity ───────────────────────────────────
// These tests prove that runId threads through the full
// CommandRouter → RuntimeStore → Socket.IO event chain,
// enabling bidirectional CLI↔Studio run identity.

import { RuntimeStore, CommandRouter, createShellExecutor } from "../index.js";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

function makeTempProject(dirName: string, scripts: Record<string, string>): string {
  const tmp = path.join(os.tmpdir(), `litt-test-${dirName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: dirName, version: "1.0.0", scripts }, null, 2),
  );
  return tmp;
}

function cleanupDir(p: string): void {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ok */ }
}

describe("Phase 2D.1 — Run identity: commandStart stores runId", () => {
  it("commandStart with runId stores it in activeCommand", () => {
    const store = new RuntimeStore();
    const runId = "run_12345_abcdef";
    store.commandStart("build", [], "/tmp/test", runId);

    const state = store.getState();
    assert.ok(state.activeCommand, "activeCommand should be set");
    assert.equal(state.activeCommand!.runId, runId);
    assert.equal(state.phase, "running");
  });

  it("commandStart without runId generates one automatically", () => {
    const store = new RuntimeStore();
    store.commandStart("test", [], "/tmp/test");

    const state = store.getState();
    assert.ok(state.activeCommand, "activeCommand should be set");
    assert.ok(state.activeCommand!.runId.startsWith("run_"),
      `auto-generated runId should start with "run_", got: ${state.activeCommand!.runId}`);
  });

  it("commandEnd with runId stores it in lastResult", () => {
    const store = new RuntimeStore();
    const runId = "run_67890_ghijkl";
    store.commandStart("check", [], "/tmp/test", runId);
    store.commandEnd("check", true, 0, 500, "typecheck passed", runId);

    const state = store.getState();
    assert.ok(state.lastResult, "lastResult should be set");
    assert.equal(state.lastResult!.runId, runId);
    assert.equal(state.lastResult!.success, true);
    assert.equal(state.activeCommand, null, "activeCommand should be cleared");
  });

  it("commandEnd without runId inherits from activeCommand", () => {
    const store = new RuntimeStore();
    const runId = "run_inherit_test";
    store.commandStart("build", [], "/tmp/test", runId);
    store.commandEnd("build", false, 1, 1000, "build failed");

    const state = store.getState();
    assert.ok(state.lastResult, "lastResult should be set");
    assert.equal(state.lastResult!.runId, runId,
      "lastResult should inherit runId from the active command");
  });
});

describe("Phase 2D.1 — Run identity: command_start event carries runId", () => {
  it("emits command_start event with runId", () => {
    const store = new RuntimeStore();
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    store.setEmitter((event) => {
      events.push({ type: event.type, data: event.data });
    });

    const runId = "run_event_test";
    store.commandStart("test", ["--verbose"], "/tmp/test", runId);

    const startEvent = events.find((e) => e.type === "command_start");
    assert.ok(startEvent, "should emit command_start event");
    assert.equal(startEvent!.data.runId, runId,
      "command_start event data should carry runId");
  });

  it("emits command_end event with runId", () => {
    const store = new RuntimeStore();
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    store.setEmitter((event) => {
      events.push({ type: event.type, data: event.data });
    });

    const runId = "run_end_event";
    store.commandStart("build", [], "/tmp/test", runId);
    store.commandEnd("build", true, 0, 200, "ok", runId);

    const endEvent = events.find((e) => e.type === "command_end");
    assert.ok(endEvent, "should emit command_end event");
    assert.equal(endEvent!.data.runId, runId,
      "command_end event data should carry runId");
  });
});

describe("Phase 2D.1 — Run identity: CommandRouter threads runId", () => {
  it("router.check(runId) threads runId through RuntimeStore", async () => {
    const tmp = makeTempProject("runid-check", { typecheck: "node -e \"process.exit(0)\"" });
    try {
      const shell = createShellExecutor(tmp);
      const store = new RuntimeStore();
      const router = new CommandRouter(shell, { cwd: tmp, store });
      const runId = "run_router_check_test";

      await router.check(runId);

      const state = store.getState();
      assert.ok(state.lastResult, "lastResult should be set");
      assert.equal(state.lastResult!.runId, runId,
        "router.check(runId) should thread runId into lastResult");
      assert.equal(state.lastResult!.command, "check");
    } finally { cleanupDir(tmp); }
  });

  it("router.build(runId) threads runId through RuntimeStore", async () => {
    const tmp = makeTempProject("runid-build", { build: "node -e \"process.exit(0)\"" });
    try {
      const shell = createShellExecutor(tmp);
      const store = new RuntimeStore();
      const router = new CommandRouter(shell, { cwd: tmp, store });
      const runId = "run_router_build_test";

      await router.build(runId);

      const state = store.getState();
      assert.ok(state.lastResult, "lastResult should be set");
      assert.equal(state.lastResult!.runId, runId,
        "router.build(runId) should thread runId into lastResult");
    } finally { cleanupDir(tmp); }
  });

  it("router.dispatch('check', { runId }) threads runId", async () => {
    const tmp = makeTempProject("runid-dispatch", { typecheck: "node -e \"process.exit(0)\"" });
    try {
      const shell = createShellExecutor(tmp);
      const store = new RuntimeStore();
      const router = new CommandRouter(shell, { cwd: tmp, store });
      const runId = "run_dispatch_test";

      await router.dispatch("check", { runId });

      const state = store.getState();
      assert.ok(state.lastResult, "lastResult should be set");
      assert.equal(state.lastResult!.runId, runId,
        "dispatch with runId in args should thread into lastResult");
    } finally { cleanupDir(tmp); }
  });
});

describe("Phase 2D.1 — Run identity: snapshot equals store state", () => {
  it("getState() snapshot includes runId from activeCommand", () => {
    const store = new RuntimeStore();
    const runId = "run_snapshot_test";
    store.commandStart("test", [], "/tmp/test", runId);

    const snapshot = store.getState();
    assert.ok(snapshot.activeCommand, "snapshot should have activeCommand");
    assert.equal(snapshot.activeCommand!.runId, runId,
      "snapshot should carry runId in activeCommand");
  });

  it("getState() snapshot includes runId from lastResult", () => {
    const store = new RuntimeStore();
    const runId = "run_snapshot_last";
    store.commandStart("build", [], "/tmp/test", runId);
    store.commandEnd("build", true, 0, 100, "ok", runId);

    const snapshot = store.getState();
    assert.ok(snapshot.lastResult, "snapshot should have lastResult");
    assert.equal(snapshot.lastResult!.runId, runId,
      "snapshot should carry runId in lastResult");
  });

  it("toJSON() serializes runId in the canonical snapshot", () => {
    const store = new RuntimeStore();
    const runId = "run_json_test";
    store.commandStart("check", [], "/tmp/test", runId);

    const json = store.toJSON();
    const parsed = JSON.parse(json);
    assert.ok(parsed.activeCommand, "JSON should have activeCommand");
    assert.equal(parsed.activeCommand.runId, runId,
      "JSON snapshot should carry runId in activeCommand");
  });
});

describe("Phase 2D.1 — Run identity: CLI and Studio use identical contract", () => {
  it("CommandRouter result contract is the same regardless of caller", async () => {
    // Both CLI (litt check) and Studio (/check) hit the same
    // CommandRouter.dispatch(). The result shape must be identical.
    const tmp = makeTempProject("contract-test", { typecheck: "node -e \"process.exit(0)\"" });
    try {
      const shell = createShellExecutor(tmp);
      const store = new RuntimeStore();
      const router = new CommandRouter(shell, { cwd: tmp, store });

      // Simulate CLI call (no runId in args, auto-generated)
      const cliResult = await router.dispatch("check");
      const cliState = store.getState();
      const cliRunId = cliState.lastResult?.runId;
      assert.ok(cliRunId, "CLI path should produce a runId");

      // Simulate Studio call (explicit runId in args)
      const studioRunId = "run_studio_explicit";
      const studioResult = await router.dispatch("check", { runId: studioRunId });
      const studioState = store.getState();
      const studioRunIdFromState = studioState.lastResult?.runId;
      assert.equal(studioRunIdFromState, studioRunId,
        "Studio path should thread explicit runId");

      // Both results have the same shape
      assert.equal(cliResult.command, "check");
      assert.equal(studioResult.command, "check");
      assert.equal(typeof cliResult.result.success, typeof studioResult.result.success);
    } finally { cleanupDir(tmp); }
  });
});
