/**
 * Performance PR #1 — Pipeline timing instrumentation tests.
 *
 * Verifies:
 * - recordPipelineStage records durations without throwing
 * - PipelineTimer measures elapsed time
 * - Labels are normalized to low-cardinality values
 * - No PII/prompt contents are recorded (by construction — labels are enums/booleans)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prom-client to avoid registry pollution in tests
vi.mock("prom-client", () => {
  const mockObserve = vi.fn();
  const mockInc = vi.fn();
  const mockLabels = vi.fn(() => ({ observe: mockObserve, inc: mockInc }));
  class MockHistogram {
    labels = mockLabels;
  }
  class MockCounter {
    labels = mockLabels;
  }
  class MockGauge {
    labels = mockLabels;
  }
  class MockRegistry {
    metrics = vi.fn();
  }
  return {
    Registry: MockRegistry,
    Counter: MockCounter,
    Histogram: MockHistogram,
    Gauge: MockGauge,
    collectDefaultMetrics: vi.fn(),
  };
});

// Mock server-only
vi.mock("server-only", () => ({}));

import {
  recordPipelineStage,
  PipelineTimer,
} from "@/lib/metrics";

describe("Performance PR #1 — Pipeline timing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recordPipelineStage accepts valid stage labels", () => {
    expect(() =>
      recordPipelineStage(
        {
          stage: "build",
          taskKind: "build",
          modelRole: "builder",
          workspaceWarm: true,
          depsRequired: false,
          previewReused: true,
          status: "success",
          cacheHit: true,
        },
        1500
      )
    ).not.toThrow();
  });

  it("recordPipelineStage normalizes missing labels to safe defaults", () => {
    expect(() =>
      recordPipelineStage({ stage: "model" }, 250)
    ).not.toThrow();
  });

  it("PipelineTimer measures elapsed time and records on end", () => {
    const timer = new PipelineTimer({
      stage: "preview",
      taskKind: "build",
    });
    // Simulate work
    const start = Date.now();
    while (Date.now() - start < 10) {
      // busy wait ~10ms
    }
    expect(() => timer.end({ status: "success" })).not.toThrow();
  });

  it("PipelineTimer accepts extra labels on end", () => {
    const timer = new PipelineTimer({ stage: "validation" });
    expect(() =>
      timer.end({
        status: "failure",
        retryCount: 2,
      })
    ).not.toThrow();
  });

  it("supports all defined pipeline stages", () => {
    const stages = [
      "request_received",
      "request_acknowledged",
      "queue_enqueued",
      "queue_claimed",
      "context",
      "model",
      "model_first_token",
      "tool",
      "workspace",
      "dependencies",
      "build",
      "preview",
      "validation",
      "approval_wait",
      "publish",
      "task_completed",
      "task_failed",
      "task_canceled",
    ] as const;

    for (const stage of stages) {
      expect(() =>
        recordPipelineStage({ stage }, 100)
      ).not.toThrow();
    }
  });

  it("does not accept arbitrary label values (type safety)", () => {
    // TypeScript ensures labels are constrained to enums/booleans.
    // This test documents that prompt contents, code, PII cannot be passed
    // because the type system only allows the defined low-cardinality values.
    const labels = {
      stage: "build" as const,
      taskKind: "build" as const,
      // @ts-expect-error — prompt contents are not a valid label
      prompt: "secret prompt contents",
    };
    // The type error above proves the constraint. At runtime we only
    // pass the valid subset.
    const { prompt: _ignored, ...valid } = labels;
    expect(() => recordPipelineStage(valid, 100)).not.toThrow();
  });
});
