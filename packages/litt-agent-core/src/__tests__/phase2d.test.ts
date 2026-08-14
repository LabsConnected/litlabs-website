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
