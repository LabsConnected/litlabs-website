/**
 * Workstream step deduplication — regression tests for the duplicate
 * workstream-row bug.
 *
 * Observed live bug (mission/workstream-step path):
 *   ● Execute single status operation
 *   ● Execute single status operation
 *
 * Root cause: a single mission step produced multiple workstream
 * activities because:
 *   1. mission:step_started, mission:step_working, and
 *      mission:step_verifying all map to the same lifecycle event
 *      type (mission.step_started), and each delivery created a
 *      fresh "reason" activity via ws.addReason().
 *   2. mission:step_passed created a separate "verify" activity via
 *      ws.addVerify() instead of completing the existing step row.
 *   3. mission:step_failed created a separate "failure" activity via
 *      ws.begin("failure", ...) instead of failing the existing row.
 *   4. The dual sessionBridge + client subscription could redeliver
 *      the same event, and the store had no identity-based dedup.
 *
 * Fix: WorkstreamStore now carries an optional `sourceId` (the stable
 * stepId / toolCallId from the source event). beginSource() is a
 * no-op if an activity with that sourceId already exists;
 * completeSource()/failSource() terminalize the existing activity
 * (or create it as already-terminal for out-of-order delivery).
 *
 * These tests lock the identity-based dedup contract so a future
 * change cannot reintroduce the duplicate.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { WorkstreamStore } from "../ink/workstream-store.js";

describe("WorkstreamStore — sourceId identity dedup", () => {
  let store: WorkstreamStore;

  beforeEach(() => {
    store = new WorkstreamStore();
  });

  // ── beginSource: duplicate delivery is a no-op ──────────────────

  describe("beginSource — duplicate delivery", () => {
    it("beginSource with the same sourceId twice yields one activity", () => {
      const id1 = store.beginSource("reason", "WORKING", "Execute status", undefined, "step_1");
      const id2 = store.beginSource("reason", "WORKING", "Execute status", undefined, "step_1");
      expect(id1).toBe(id2);
      expect(store.length()).toBe(1);
      expect(store.snapshot().activities[0].sourceId).toBe("step_1");
    });

    it("beginSource with different sourceIds yields two activities", () => {
      store.beginSource("reason", "WORKING", "Execute status", undefined, "step_1");
      store.beginSource("reason", "WORKING", "Execute status", undefined, "step_2");
      expect(store.length()).toBe(2);
    });

    it("beginSource without sourceId always creates a new activity", () => {
      store.beginSource("reason", "WORKING", "Execute status");
      store.beginSource("reason", "WORKING", "Execute status");
      expect(store.length()).toBe(2);
    });
  });

  // ── completeSource: completes the existing row, no new row ──────

  describe("completeSource — completes existing row", () => {
    it("completeSource terminalizes the activity started by beginSource", () => {
      const id = store.beginSource("reason", "WORKING", "Run tests", undefined, "step_a");
      expect(store.byId(id)?.status).toBe("running");
      store.completeSource("step_a", { success: true });
      expect(store.length()).toBe(1);
      expect(store.byId(id)?.status).toBe("complete");
      expect(store.byId(id)?.success).toBe(true);
    });

    it("completeSource does not create a new row when the step exists", () => {
      store.beginSource("reason", "WORKING", "Run tests", undefined, "step_a");
      store.completeSource("step_a", { success: true });
      expect(store.length()).toBe(1);
    });

    it("completeSource creates an already-complete row for out-of-order delivery", () => {
      // Terminal event arrives before the start event (rare but possible
      // with async event delivery). The step must still be visible.
      store.completeSource("step_late", { success: true, label: "Late step" });
      expect(store.length()).toBe(1);
      const a = store.snapshot().activities[0];
      expect(a.sourceId).toBe("step_late");
      expect(a.status).toBe("complete");
    });

    it("completeSource on an already-terminal activity is a no-op", () => {
      store.beginSource("reason", "WORKING", "Run tests", undefined, "step_a");
      store.completeSource("step_a", { success: true, elapsedMs: 10 });
      store.completeSource("step_a", { success: false, elapsedMs: 999 });
      const a = store.byId(store.snapshot().activities[0].id)!;
      expect(a.status).toBe("complete");
      expect(a.success).toBe(true);
      expect(a.elapsedMs).toBe(10);
    });
  });

  // ── failSource: fails the existing row, no new row ──────────────

  describe("failSource — fails existing row", () => {
    it("failSource terminalizes the activity started by beginSource", () => {
      const id = store.beginSource("reason", "WORKING", "Run tests", undefined, "step_a");
      store.failSource("step_a", "Tests failed");
      expect(store.length()).toBe(1);
      expect(store.byId(id)?.status).toBe("failed");
      expect(store.byId(id)?.reason).toBe("Tests failed");
    });

    it("failSource does not create a new row when the step exists", () => {
      store.beginSource("reason", "WORKING", "Run tests", undefined, "step_a");
      store.failSource("step_a", "Tests failed");
      expect(store.length()).toBe(1);
    });

    it("failSource creates an already-failed row for out-of-order delivery", () => {
      store.failSource("step_late", "Failed before start", "Late fail");
      expect(store.length()).toBe(1);
      const a = store.snapshot().activities[0];
      expect(a.sourceId).toBe("step_late");
      expect(a.status).toBe("failed");
    });
  });

  // ── Full step lifecycle: started → passed = ONE row ─────────────

  describe("Full step lifecycle — one logical step = one row", () => {
    it("started → passed produces exactly one row (not started + verify)", () => {
      // OLD behavior (bug): addReason("Run tests") + addVerify("Run tests", true) = 2 rows
      // NEW behavior (fix): beginSource + completeSource = 1 row
      store.beginSource("reason", "WORKING", "Run tests", undefined, "step_1");
      store.completeSource("step_1", { success: true });
      expect(store.length()).toBe(1);
      const a = store.snapshot().activities[0];
      expect(a.sourceId).toBe("step_1");
      expect(a.status).toBe("complete");
      expect(a.label).toBe("Run tests");
    });

    it("started → failed produces exactly one row (not started + failure)", () => {
      // OLD behavior (bug): addReason("Run tests") + begin("failure") + fail = 2 rows
      // NEW behavior (fix): beginSource + failSource = 1 row
      store.beginSource("reason", "WORKING", "Run tests", undefined, "step_1");
      store.failSource("step_1", "Tests failed");
      expect(store.length()).toBe(1);
      const a = store.snapshot().activities[0];
      expect(a.sourceId).toBe("step_1");
      expect(a.status).toBe("failed");
    });

    it("started → working → verifying → passed produces exactly one row", () => {
      // Simulates the mission:step_started / mission:step_working /
      // mission:step_verifying / mission:step_passed sequence that all
      // map to the same lifecycle event type. Each redelivery of
      // step_started must be a no-op.
      store.beginSource("reason", "WORKING", "Validate", undefined, "step_v");
      store.beginSource("reason", "WORKING", "Validate", undefined, "step_v"); // working
      store.beginSource("reason", "WORKING", "Validate", undefined, "step_v"); // verifying
      store.completeSource("step_v", { success: true });
      expect(store.length()).toBe(1);
      expect(store.snapshot().activities[0].status).toBe("complete");
    });
  });

  // ── Multiple distinct steps: each gets its own row ─────────────

  describe("Multiple distinct steps — no false collapse", () => {
    it("two different stepIds with the same label produce two rows", () => {
      // This is the critical anti-regression: the dedup must be
      // identity-based, NOT label-based. Two genuinely independent
      // operations with identical text must both be visible.
      store.beginSource("reason", "WORKING", "Execute status", undefined, "step_1");
      store.beginSource("reason", "WORKING", "Execute status", undefined, "step_2");
      expect(store.length()).toBe(2);
      const acts = store.snapshot().activities;
      expect(acts[0].sourceId).toBe("step_1");
      expect(acts[1].sourceId).toBe("step_2");
      expect(acts[0].label).toBe("Execute status");
      expect(acts[1].label).toBe("Execute status");
    });

    it("a multi-step workflow displays every real step exactly once", () => {
      const steps = ["Inspect", "Edit", "Test", "Verify"];
      for (let i = 0; i < steps.length; i++) {
        const sid = `step_${i}`;
        store.beginSource("reason", "WORKING", steps[i], undefined, sid);
        store.completeSource(sid, { success: true });
      }
      expect(store.length()).toBe(4);
      expect(store.snapshot().activities.map((a) => a.label)).toEqual(steps);
      // All complete, none running
      expect(store.snapshot().activities.every((a) => a.status === "complete")).toBe(true);
    });
  });

  // ── Re-delivery / replay (reconnect, remount) ───────────────────

  describe("Re-delivery — replay does not duplicate", () => {
    it("replaying the same started event does not duplicate", () => {
      store.beginSource("reason", "WORKING", "Run tests", undefined, "step_1");
      store.beginSource("reason", "WORKING", "Run tests", undefined, "step_1");
      store.beginSource("reason", "WORKING", "Run tests", undefined, "step_1");
      expect(store.length()).toBe(1);
    });

    it("replaying started → passed → started does not duplicate", () => {
      // Reconnect scenario: the bridge replays the event history.
      store.beginSource("reason", "WORKING", "Run tests", undefined, "step_1");
      store.completeSource("step_1", { success: true });
      // Reconnect replays the started event again — must not create a
      // new row, and must not un-terminalize the existing one.
      store.beginSource("reason", "WORKING", "Run tests", undefined, "step_1");
      expect(store.length()).toBe(1);
      expect(store.snapshot().activities[0].status).toBe("complete");
    });
  });

  // ── sourceId is preserved on the activity ───────────────────────

  describe("sourceId propagation", () => {
    it("beginSource stores sourceId on the activity", () => {
      store.beginSource("reason", "WORKING", "Run tests", undefined, "step_xyz");
      expect(store.snapshot().activities[0].sourceId).toBe("step_xyz");
    });

    it("begin without sourceId leaves sourceId undefined", () => {
      store.begin("reason", "WORKING", "Run tests");
      expect(store.snapshot().activities[0].sourceId).toBeUndefined();
    });

    it("add with sourceId stores it on the immediate activity", () => {
      store.add("reason", "WORKING", "Run tests", undefined, "step_imm");
      expect(store.snapshot().activities[0].sourceId).toBe("step_imm");
    });
  });

  // ── Acceptance case: single status operation ────────────────────

  describe("Acceptance — single status operation", () => {
    it("one status operation renders exactly one row", () => {
      // The exact acceptance case from the bug report:
      //   "Run exactly one status operation. Do not retry."
      // Expected: one ● row, not two.
      const stepId = "step_status_1";
      store.beginSource("reason", "WORKING", "Execute single status operation", undefined, stepId);
      // Simulate the duplicate delivery that caused the bug (e.g.
      // mission:step_started + mission:step_working both mapping to
      // mission.step_started, or dual subscription redelivery).
      store.beginSource("reason", "WORKING", "Execute single status operation", undefined, stepId);
      store.completeSource(stepId, { success: true });
      expect(store.length()).toBe(1);
      const a = store.snapshot().activities[0];
      expect(a.label).toBe("Execute single status operation");
      expect(a.status).toBe("complete");
    });
  });
});
