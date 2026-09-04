/**
 * P0-3: Activity Feed Duplication — regression tests.
 *
 * Proves:
 *   - One logical activity = one row.
 *   - Normal update mutates the existing activity instead of appending.
 *   - Rerender preserves exactly one logical row.
 *   - Reconnect/resume replays events without duplicating.
 *   - Completion updates the existing row (not a new row).
 *   - Failure updates the existing row (not a new row).
 */
import { describe, it, expect } from "vitest";
import {
  activityKey,
  reconcileActivity,
  reconcileActivityBatch,
  countLogicalActivities,
  findActivityByKey,
} from "../ink/activity-reconciler.js";
import type { ActivityEntry } from "../ink/cockpit-store.js";

function makeEntry(
  id: string,
  type: string,
  text: string,
  opts: { runId?: string; toolCallId?: string; ts?: number } = {},
): ActivityEntry {
  return {
    id,
    ts: opts.ts ?? Date.now(),
    type,
    runId: opts.runId,
    toolCallId: opts.toolCallId,
    text,
  };
}

describe("P0-3: Activity Feed Deduplication", () => {
  describe("activityKey", () => {
    it("keys mission step events by runId + stepId", () => {
      const entry = makeEntry("act_1", "mission.step_started", "Inspecting", {
        runId: "run_1",
        toolCallId: "step_inspect_1",
      });
      expect(activityKey(entry)).toBe("run_1::step::step_inspect_1");
    });

    it("keys tool events by runId + toolCallId", () => {
      const entry = makeEntry("act_1", "tool.started", "Read file", {
        runId: "run_1",
        toolCallId: "tc_1",
      });
      expect(activityKey(entry)).toBe("run_1::tool::tc_1");
    });

    it("keys run-level events by runId", () => {
      const entry = makeEntry("act_1", "run.started", "command", { runId: "run_1" });
      expect(activityKey(entry)).toBe("run_1::run");
    });

    it("keys mission lifecycle events by runId + mission", () => {
      const entry = makeEntry("act_1", "mission.created", "Mission: test", { runId: "run_1" });
      expect(activityKey(entry)).toBe("run_1::mission");
    });
  });

  describe("reconcileActivity — normal update", () => {
    it("appends when no matching key exists", () => {
      const log: ActivityEntry[] = [];
      const entry = makeEntry("act_1", "mission.step_started", "Inspecting", {
        runId: "run_1",
        toolCallId: "step_1",
      });
      const result = reconcileActivity(log, entry);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Inspecting");
    });

    it("updates the existing row when key matches (step_started → step_passed)", () => {
      const started = makeEntry("act_1", "mission.step_started", "Inspecting", {
        runId: "run_1",
        toolCallId: "step_1",
        ts: 1000,
      });
      const passed = makeEntry("act_2", "mission.step_passed", "Inspecting", {
        runId: "run_1",
        toolCallId: "step_1",
        ts: 2000,
      });
      let log = reconcileActivity([], started);
      log = reconcileActivity(log, passed);
      expect(log).toHaveLength(1);
      expect(log[0].type).toBe("mission.step_passed");
      expect(log[0].ts).toBe(2000);
    });

    it("updates the existing row when key matches (step_started → step_failed)", () => {
      const started = makeEntry("act_1", "mission.step_started", "Run tests", {
        runId: "run_1",
        toolCallId: "step_2",
        ts: 1000,
      });
      const failed = makeEntry("act_2", "mission.step_failed", "Run tests", {
        runId: "run_1",
        toolCallId: "step_2",
        ts: 2000,
      });
      let log = reconcileActivity([], started);
      log = reconcileActivity(log, failed);
      expect(log).toHaveLength(1);
      expect(log[0].type).toBe("mission.step_failed");
    });
  });

  describe("reconcileActivity — rerender preserves one row", () => {
    it("replaying the same event does not duplicate", () => {
      const entry = makeEntry("act_1", "mission.step_started", "Inspecting", {
        runId: "run_1",
        toolCallId: "step_1",
      });
      let log = reconcileActivity([], entry);
      // Simulate rerender — replay the same event
      log = reconcileActivity(log, { ...entry, id: "act_2" });
      expect(log).toHaveLength(1);
      expect(countLogicalActivities(log)).toBe(1);
    });
  });

  describe("reconcileActivity — reconnect/resume", () => {
    it("replaying a batch of events on reconnect does not duplicate", () => {
      const events: ActivityEntry[] = [
        makeEntry("act_1", "mission.step_started", "Inspecting", { runId: "run_1", toolCallId: "step_1" }),
        makeEntry("act_2", "mission.step_passed", "Inspecting", { runId: "run_1", toolCallId: "step_1" }),
        makeEntry("act_3", "mission.step_started", "Verify", { runId: "run_1", toolCallId: "step_2" }),
      ];
      // First pass
      let log = reconcileActivityBatch([], events);
      expect(log).toHaveLength(2); // step_1 and step_2
      // Reconnect — replay the same events
      log = reconcileActivityBatch(log, events);
      expect(log).toHaveLength(2);
      expect(countLogicalActivities(log)).toBe(2);
    });
  });

  describe("reconcileActivity — completion preserves one row", () => {
    it("a step that goes started → passed stays one row", () => {
      const started = makeEntry("act_1", "mission.step_started", "Assess analytics", {
        runId: "run_1", toolCallId: "step_a",
      });
      const passed = makeEntry("act_2", "mission.step_passed", "Assess analytics", {
        runId: "run_1", toolCallId: "step_a",
      });
      let log = reconcileActivity([], started);
      log = reconcileActivity(log, passed);
      expect(log).toHaveLength(1);
      expect(log[0].type).toBe("mission.step_passed");
    });
  });

  describe("reconcileActivity — failure preserves one row", () => {
    it("a step that goes started → failed stays one row", () => {
      const started = makeEntry("act_1", "mission.step_started", "Verify production readiness", {
        runId: "run_1", toolCallId: "step_v",
      });
      const failed = makeEntry("act_2", "mission.step_failed", "Verify production readiness", {
        runId: "run_1", toolCallId: "step_v",
      });
      let log = reconcileActivity([], started);
      log = reconcileActivity(log, failed);
      expect(log).toHaveLength(1);
      expect(log[0].type).toBe("mission.step_failed");
    });
  });

  describe("reconcileActivity — multiple distinct steps", () => {
    it("two different steps produce two rows, not one", () => {
      const step1 = makeEntry("act_1", "mission.step_started", "Inspecting", {
        runId: "run_1", toolCallId: "step_1",
      });
      const step2 = makeEntry("act_2", "mission.step_started", "Assessing", {
        runId: "run_1", toolCallId: "step_2",
      });
      let log = reconcileActivity([], step1);
      log = reconcileActivity(log, step2);
      expect(log).toHaveLength(2);
      expect(countLogicalActivities(log)).toBe(2);
    });

    it("the observed duplicate 'Inspecting / Inspecting' does not happen", () => {
      // Simulate the exact observed bug: same step emitted twice
      const e1 = makeEntry("act_1", "mission.step_started", "Inspecting", {
        runId: "run_1", toolCallId: "step_inspect",
      });
      const e2 = makeEntry("act_2", "mission.step_started", "Inspecting", {
        runId: "run_1", toolCallId: "step_inspect",
      });
      let log = reconcileActivity([], e1);
      log = reconcileActivity(log, e2);
      expect(log).toHaveLength(1);
      // The text should not be "Inspecting\nInspecting" or doubled
      expect(log[0].text).toBe("Inspecting");
    });
  });

  describe("countLogicalActivities", () => {
    it("counts unique keys", () => {
      const log: ActivityEntry[] = [
        makeEntry("act_1", "mission.step_started", "A", { runId: "r1", toolCallId: "s1" }),
        makeEntry("act_2", "mission.step_passed", "A", { runId: "r1", toolCallId: "s1" }),
        makeEntry("act_3", "mission.step_started", "B", { runId: "r1", toolCallId: "s2" }),
      ];
      expect(countLogicalActivities(log)).toBe(2);
    });
  });

  describe("findActivityByKey", () => {
    it("finds the entry for a given key", () => {
      const entry = makeEntry("act_1", "mission.step_started", "Test", {
        runId: "r1", toolCallId: "s1",
      });
      const log = [entry];
      const found = findActivityByKey(log, "r1::step::s1");
      expect(found).not.toBe(null);
      expect(found?.text).toBe("Test");
    });

    it("returns null when key not found", () => {
      expect(findActivityByKey([], "nonexistent")).toBe(null);
    });
  });
});
