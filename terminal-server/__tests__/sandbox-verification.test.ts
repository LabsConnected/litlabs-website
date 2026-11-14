/**
 * Sandbox verification service tests (SANDBOX-PLAN.md Phase 0).
 *
 * Properties proven here — the semantics the Phase 4 policy check
 * will rely on:
 *   1. Absent report  -> never-run, not verified.
 *   2. Failed report  -> failed, not verified (the disabled provider
 *      production wires today can never verify).
 *   3. Green report   -> verified only inside the freshness window;
 *      stale the moment the window lapses.
 *   4. Concurrent runNow() calls share one in-flight canary run.
 */

import { describe, it, expect } from "vitest";
import {
  SandboxVerificationService,
  createDefaultSandboxVerificationService,
} from "../sandbox/verification";
import type { CanaryProvider } from "../sandbox/provider";
import { createCompliantFakeProvider } from "../sandbox/testing/fake-providers";

describe("SandboxVerificationService — default (disabled provider)", () => {
  it("starts never-run and cannot verify even after a run", async () => {
    const service = createDefaultSandboxVerificationService();

    expect(service.providerName).toBe("disabled");
    const before = service.getSignal();
    expect(before.state).toBe("never-run");
    expect(before.verified).toBe(false);
    expect(before.report).toBeNull();
    expect(service.isVerified()).toBe(false);

    const report = await service.runNow();
    expect(report.passed).toBe(false);

    const after = service.getSignal();
    expect(after.state).toBe("failed");
    expect(after.verified).toBe(false);
    expect(service.isVerified()).toBe(false);
  });
});

describe("SandboxVerificationService — compliant provider", () => {
  it("verifies after a green run, with checkedAt/freshUntil from the report", async () => {
    const service = new SandboxVerificationService(createCompliantFakeProvider(), {
      maxAgeMs: 60_000,
      canary: { runId: "test-signal-green" },
    });

    const report = await service.runNow();
    expect(report.passed).toBe(true);

    const signal = service.getSignal();
    expect(signal.state).toBe("verified");
    expect(signal.verified).toBe(true);
    expect(signal.provider).toBe("fake");
    expect(signal.checkedAt).toBe(report.finishedAt);
    expect(signal.freshUntil).not.toBeNull();
    expect(service.isVerified()).toBe(true);
  });

  it("goes stale the moment the freshness window lapses", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const service = new SandboxVerificationService(createCompliantFakeProvider(), {
      maxAgeMs: 1_000,
      now,
      canary: { runId: "test-signal-stale" },
    });

    await service.runNow();
    expect(service.getSignal().state).toBe("verified");

    clock += 1_001;
    const signal = service.getSignal();
    expect(signal.state).toBe("stale");
    expect(signal.verified).toBe(false);
    expect(service.isVerified()).toBe(false);
  });

  it("start() kicks a boot run without blocking, and the signal follows", async () => {
    const service = new SandboxVerificationService(createCompliantFakeProvider(), {
      canary: { runId: "test-signal-boot" },
    });
    service.start();
    // Join the in-flight boot run rather than starting a second one.
    const report = await service.runNow();
    expect(report.passed).toBe(true);
    expect(service.isVerified()).toBe(true);
  });

  it("dedupes concurrent runNow() calls into a single canary run", async () => {
    const provider = createCompliantFakeProvider();
    const service = new SandboxVerificationService(provider, {
      canary: { runId: "test-signal-dedupe" },
    });

    const [a, b] = await Promise.all([service.runNow(), service.runNow()]);
    expect(a).toBe(b);
    expect(provider.calls.health).toBe(1);
    expect(provider.calls.create).toBe(2); // sandboxes A + B of one run
  });

  it("periodic refresh re-runs the canary and keeps the signal verified past one freshness window", async () => {
    const provider = createCompliantFakeProvider();
    const service = new SandboxVerificationService(provider, {
      // 60ms freshness window: without refresh the signal would go
      // stale almost immediately; a 10ms refresh keeps re-verifying.
      maxAgeMs: 60,
      canary: { runId: "test-signal-refresh" },
    });

    await service.runNow();
    expect(service.isVerified()).toBe(true);
    const runsAtStart = provider.calls.health;

    service.startPeriodicRefresh(10);
    expect(service.periodicRefreshActive).toBe(true);
    try {
      // ~3 freshness windows pass; refresh must have re-run the canary
      // several times and the signal must still read verified.
      await new Promise((resolve) => setTimeout(resolve, 180));
      expect(provider.calls.health).toBeGreaterThan(runsAtStart + 2);
      expect(service.getSignal().state).toBe("verified");
      expect(service.isVerified()).toBe(true);
    } finally {
      service.stopPeriodicRefresh();
    }
    expect(service.periodicRefreshActive).toBe(false);

    // After stop, no further canary runs are scheduled.
    const runsAtStop = provider.calls.health;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(provider.calls.health).toBe(runsAtStop);
  });

  it("periodic refresh is idempotent — a second start does not double-schedule", async () => {
    const service = new SandboxVerificationService(createCompliantFakeProvider(), {
      canary: { runId: "test-signal-refresh-idempotent" },
    });
    service.startPeriodicRefresh(10);
    service.startPeriodicRefresh(10);
    expect(service.periodicRefreshActive).toBe(true);
    service.stopPeriodicRefresh();
    expect(service.periodicRefreshActive).toBe(false);
    // Stopping twice is a no-op, not an error.
    service.stopPeriodicRefresh();
  });

  it("a failing provider under periodic refresh stays failed and never throws", async () => {
    const service = createDefaultSandboxVerificationService({
      canary: { runId: "test-signal-refresh-failing" },
    });
    service.startPeriodicRefresh(10);
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(service.getSignal().state).toBe("failed");
      expect(service.isVerified()).toBe(false);
    } finally {
      service.stopPeriodicRefresh();
    }
  });

  it("a provider whose health() throws yields a failed report, not an exception", async () => {
    const exploding: CanaryProvider = {
      name: "exploding",
      health: async () => {
        throw new Error("health exploded");
      },
      create: async () => {
        throw new Error("unreachable");
      },
      get: async () => null,
      execute: async () => {
        throw new Error("unreachable");
      },
      destroy: async () => {},
    };
    const service = new SandboxVerificationService(exploding);
    const report = await service.runNow();
    expect(report.passed).toBe(false);
    expect(service.getSignal().state).toBe("failed");
    expect(service.isVerified()).toBe(false);
  });
});
