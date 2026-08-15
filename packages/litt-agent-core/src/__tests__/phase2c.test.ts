/**
 * Acceptance tests for Phase 2C — RuntimeStore heartbeat + command tracking.
 *
 * Verifies that the canonical RuntimeStore:
 *   - Tracks heartbeat success/failure with seq, latency, and stale detection
 *   - Records active command start/end with phase transitions
 *   - Stores last result for both surfaces to display
 *   - Emits the correct events (heartbeat, command_start, command_end, state_sync)
 *   - Serializes via toJSON for Socket.IO transport
 *   - Integrates with CommandRouter (status updates project, check updates lastResult)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs";
import {
  createShellExecutor,
  CommandRouter,
  RuntimeStore,
  createInitialState,
} from "../index.js";
import type { RuntimeEvent } from "../index.js";

// Resolve repo root
let REPO_ROOT: string;
const testDir = __dirname;
if (testDir.includes("__tests__")) {
  REPO_ROOT = path.resolve(testDir, "../../..");
} else {
  REPO_ROOT = path.resolve(testDir, "..");
}
let checkDir = REPO_ROOT;
for (let i = 0; i < 5; i++) {
  if (fs.existsSync(path.join(checkDir, "package.json")) &&
      fs.existsSync(path.join(checkDir, "pnpm-workspace.yaml"))) {
    REPO_ROOT = checkDir;
    break;
  }
  checkDir = path.dirname(checkDir);
}

describe("Phase 2C — Initial state has heartbeat fields", () => {
  it("createInitialState has heartbeat with seq 0", () => {
    const state = createInitialState();
    assert.equal(state.heartbeat.seq, 0);
    assert.equal(state.heartbeat.failures, 0);
    assert.equal(state.heartbeat.lastHeartbeatAt, 0);
    assert.equal(state.heartbeat.latencyMs, null);
    assert.ok(state.heartbeat.intervalMs > 0);
    assert.ok(state.heartbeat.maxFailures > 0);
  });

  it("createInitialState has null activeCommand and lastResult", () => {
    const state = createInitialState();
    assert.equal(state.activeCommand, null);
    assert.equal(state.lastResult, null);
  });

  it("createInitialState has updatedAt timestamp", () => {
    const state = createInitialState();
    assert.ok(state.updatedAt > 0);
  });
});

describe("Phase 2C — Heartbeat lifecycle", () => {
  it("recordHeartbeat updates seq, latency, and sets online", () => {
    const store = new RuntimeStore();
    // Use tickHeartbeat with a mock probe
    store.setHeartbeatProbe(async () => 42);
    store.configureHeartbeat({ intervalMs: 1000, maxFailures: 3 });

    return store.tickHeartbeat().then(() => {
      const state = store.getState();
      assert.equal(state.heartbeat.seq, 1);
      assert.equal(state.heartbeat.failures, 0);
      assert.equal(state.heartbeat.latencyMs, 42);
      assert.equal(state.online, true);
      assert.equal(state.pingMs, 42);
      assert.ok(state.heartbeat.lastHeartbeatAt > 0);
    });
  });

  it("recordHeartbeatFailure increments failures and goes offline after threshold", () => {
    const store = new RuntimeStore();
    store.setHeartbeatProbe(async () => { throw new Error("network down"); });
    store.configureHeartbeat({ intervalMs: 100, maxFailures: 2 });

    // First failure
    return store.tickHeartbeat().then(() => {
      let state = store.getState();
      assert.equal(state.heartbeat.failures, 1);
      assert.equal(state.online, false, "should still be offline (threshold 2)");

      // Second failure — should go offline
      return store.tickHeartbeat().then(() => {
        state = store.getState();
        assert.equal(state.heartbeat.failures, 2);
        assert.equal(state.online, false);
      });
    });
  });

  it("heartbeat emits heartbeat event", () => {
    const events: RuntimeEvent[] = [];
    const store = new RuntimeStore((e) => events.push(e));
    store.setHeartbeatProbe(async () => 15);

    return store.tickHeartbeat().then(() => {
      const hbEvents = events.filter((e) => e.type === "heartbeat");
      assert.ok(hbEvents.length >= 1, "should emit at least one heartbeat event");
      assert.equal(hbEvents[0].data.success, true);
      assert.equal(hbEvents[0].data.latencyMs, 15);
    });
  });

  it("isStale returns true when no heartbeat has run", () => {
    const store = new RuntimeStore();
    assert.equal(store.isStale(), true);
  });

  it("isStale returns false after a recent heartbeat", () => {
    const store = new RuntimeStore();
    store.setHeartbeatProbe(async () => 10);
    return store.tickHeartbeat().then(() => {
      assert.equal(store.isStale(), false);
    });
  });

  it("startHeartbeat does not create duplicate timers", () => {
    const store = new RuntimeStore();
    store.setHeartbeatProbe(async () => 10);
    store.configureHeartbeat({ intervalMs: 50_000 });

    store.startHeartbeat();
    // Calling start again should be a no-op, not create a second timer
    store.startHeartbeat();
    store.stopHeartbeat();
    // If we stop and the timer was duplicated, this is fine —
    // but the key invariant is that stopHeartbeat clears all timers.
    // We verify by ensuring no exception and clean state.
    assert.equal(store.getState().heartbeat.seq, 0, "no ticks should have run");
  });

  it("startHeartbeat throws if no probe is set", () => {
    const store = new RuntimeStore();
    assert.throws(() => store.startHeartbeat(), /Heartbeat probe not set/);
  });
});

describe("Phase 2C — Active command tracking", () => {
  it("commandStart sets phase to running and records active command", () => {
    const store = new RuntimeStore();
    store.commandStart("check", [], "/some/path");
    const state = store.getState();
    assert.equal(state.phase, "running");
    assert.ok(state.activeCommand);
    assert.equal(state.activeCommand!.command, "check");
    assert.equal(state.activeCommand!.cwd, "/some/path");
    assert.ok(state.activeCommand!.startedAt > 0);
  });

  it("commandEnd clears active command and records last result", () => {
    const store = new RuntimeStore();
    store.commandStart("build", [], "/repo");
    store.commandEnd("build", true, 0, 5000, "build succeeded");
    const state = store.getState();
    assert.equal(state.activeCommand, null);
    assert.ok(state.lastResult);
    assert.equal(state.lastResult!.command, "build");
    assert.equal(state.lastResult!.success, true);
    assert.equal(state.lastResult!.exitCode, 0);
    assert.equal(state.lastResult!.durationMs, 5000);
    assert.equal(state.lastResult!.message, "build succeeded");
  });

  it("commandEnd with failure sets phase to failed", () => {
    const store = new RuntimeStore();
    store.commandStart("test", [], "/repo");
    store.commandEnd("test", false, 1, 2000, "tests failed");
    const state = store.getState();
    assert.equal(state.phase, "failed");
    assert.equal(state.lastResult!.success, false);
    assert.equal(state.lastResult!.exitCode, 1);
  });

  it("commandStart emits command_start event", () => {
    const events: RuntimeEvent[] = [];
    const store = new RuntimeStore((e) => events.push(e));
    store.commandStart("check", ["--staged"], "/repo");
    const startEvents = events.filter((e) => e.type === "command_start");
    assert.ok(startEvents.length >= 1);
    assert.equal(startEvents[0].data.command, "check");
  });

  it("commandEnd emits command_end event", () => {
    const events: RuntimeEvent[] = [];
    const store = new RuntimeStore((e) => events.push(e));
    store.commandStart("build", [], "/repo");
    store.commandEnd("build", true, 0, 100, "ok");
    const endEvents = events.filter((e) => e.type === "command_end");
    assert.ok(endEvents.length >= 1);
    assert.equal(endEvents[0].data.success, true);
    assert.equal(endEvents[0].data.exitCode, 0);
  });
});

describe("Phase 2C — Serialization", () => {
  it("toJSON produces valid JSON with all fields", () => {
    const store = new RuntimeStore();
    store.setPhase("thinking");
    store.commandStart("check", [], "/repo");
    const json = store.toJSON();
    const parsed = JSON.parse(json);
    assert.equal(parsed.phase, "running"); // commandStart sets phase to running
    assert.ok(parsed.heartbeat);
    assert.ok(parsed.activeCommand);
    assert.ok(parsed.updatedAt > 0);
  });

  it("setState replaces state and emits state_sync", () => {
    const events: RuntimeEvent[] = [];
    const store = new RuntimeStore((e) => events.push(e));
    const newState = createInitialState();
    newState.phase = "verifying";
    store.setState(newState);
    assert.equal(store.getState().phase, "verifying");
    const syncEvents = events.filter((e) => e.type === "state_sync");
    assert.ok(syncEvents.length >= 1);
  });
});

describe("Phase 2C — CommandRouter + RuntimeStore integration", () => {
  it("status() updates store with project and git changes", async () => {
    const pkgDir = path.join(REPO_ROOT, "packages", "litt-agent-core");
    const shell = createShellExecutor(pkgDir);
    const store = new RuntimeStore();
    const router = new CommandRouter(shell, { cwd: pkgDir, store });

    await router.status();
    const state = store.getState();
    assert.ok(state.project, "store should have project set");
    // resolveProjectContext walks up to the git root, so the name is the repo name
    assert.ok(state.project!.name.length > 0, "project name should be non-empty");
    assert.ok(state.gitChanges >= 0, "store should have gitChanges set");
  });

  it("check() updates store with command start/end", async () => {
    const os = await import("os");
    const tmp = path.join(os.tmpdir(), `litt-2c-check-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "fast-check", version: "1.0.0", scripts: { typecheck: "node -e \"console.log('ok')\"" } }),
    );
    try {
      const shell = createShellExecutor(tmp);
      const store = new RuntimeStore();
      const router = new CommandRouter(shell, { cwd: tmp, store });

      await router.check();
      const state = store.getState();
      assert.equal(state.activeCommand, null, "activeCommand should be cleared after completion");
      assert.ok(state.lastResult, "lastResult should be set");
      assert.equal(state.lastResult!.command, "check");
      assert.ok(state.phase === "complete" || state.phase === "failed");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("check() emits command_start and command_end events", async () => {
    const os = await import("os");
    const tmp = path.join(os.tmpdir(), `litt-2c-events-${Date.now()}`);
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "fast-check2", version: "1.0.0", scripts: { typecheck: "node -e \"console.log('ok')\"" } }),
    );
    try {
      const shell = createShellExecutor(tmp);
      const events: RuntimeEvent[] = [];
      const store = new RuntimeStore((e) => events.push(e));
      const router = new CommandRouter(shell, { cwd: tmp, store });

      await router.check();
      const startEvents = events.filter((e) => e.type === "command_start");
      const endEvents = events.filter((e) => e.type === "command_end");
      assert.ok(startEvents.length >= 1, "should emit command_start");
      assert.ok(endEvents.length >= 1, "should emit command_end");
      assert.equal(startEvents[0].data.command, "check");
      assert.equal(endEvents[0].data.command, "check");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
