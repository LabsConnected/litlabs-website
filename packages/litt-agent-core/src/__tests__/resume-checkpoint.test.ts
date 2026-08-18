/**
 * Resume, Checkpoint, and Cancel — proves the RuntimeStore's mission
 * lifecycle methods for interrupting and resuming missions.
 *
 * Contract (resumeMission):
 *   - Same-mission resume is allowed ONLY when mission.status === "blocked".
 *   - blocked → working is the ONLY lifecycle transition performed.
 *   - failed / complete / cancelled are terminal — resume rejected.
 *   - planning / working / verifying are NOT resumable through this API.
 *   - A blocked step is reset to working and attemptCount increments.
 *   - An invalid checkpoint is rejected (mission must still be blocked).
 *
 * Contract (addCheckpoint / cancelMission):
 *   - addCheckpoint() captures progress at a point in time and persists it.
 *   - cancelMission() transitions to "cancelled" with a reason.
 *
 * The pre-existing MissionStore.resumeFromCheckpoint is a low-level
 * persistence primitive that only repositions currentStepId. It does
 * NOT change mission status or reset step state. RuntimeStore.resumeMission
 * is the canonical lifecycle operation that goes through the state machine.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { RuntimeStore } from "../state.js";
import { isValidMissionTransition } from "../missions/mission-state-machine.js";

function createTempDir(): string {
  const tmp = path.join(os.tmpdir(), `litt-resume-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function cleanupTempDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
}

describe("Resume, Checkpoint, and Cancel", () => {
  let tmpDir: string;
  let store: RuntimeStore;

  beforeEach(() => {
    tmpDir = createTempDir();
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-project", version: "1.0.0" }),
    );
    store = new RuntimeStore({ projectRoot: tmpDir });
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  // ─── addCheckpoint ───────────────────────────────────────────────

  describe("addCheckpoint", () => {
    it("creates a checkpoint with the current step and proven steps", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });
      const s2 = await store.addMissionStep({ title: "Step 2" });
      const s3 = await store.addMissionStep({ title: "Step 3" });

      // Pass step 1, work on step 2
      await store.setCurrentStep(s1!.id);
      await store.updateMissionStepStatus(s1!.id, "passed");
      await store.setCurrentStep(s2!.id);

      const checkpoint = await store.addCheckpoint({ stepId: s2!.id });
      assert.ok(checkpoint);
      assert.equal(checkpoint!.stepId, s2!.id);
      assert.ok(checkpoint!.provenAt.includes(s1!.id));
      assert.ok(checkpoint!.remaining.includes(s3!.id));
      assert.equal(checkpoint!.missionId, store.getMission()!.id);
    });

    it("returns null when there is no active mission", async () => {
      const checkpoint = await store.addCheckpoint({ stepId: null });
      assert.equal(checkpoint, null);
    });

    it("persists the checkpoint on the mission", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      await store.addMissionStep({ title: "Step 1" });

      const checkpoint = await store.addCheckpoint({ stepId: null });
      assert.ok(checkpoint);

      const mission = store.getMission()!;
      assert.equal(mission.checkpoints.length, 1);
      assert.equal(mission.checkpoints[0].id, checkpoint!.id);
    });

    it("auto-derives provenAt and remaining from step statuses", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });
      const s2 = await store.addMissionStep({ title: "Step 2" });
      const s3 = await store.addMissionStep({ title: "Step 3" });

      await store.setCurrentStep(s1!.id);
      await store.updateMissionStepStatus(s1!.id, "passed");
      await store.setCurrentStep(s2!.id);

      const cp = await store.addCheckpoint({ stepId: s2!.id });
      assert.ok(cp!.provenAt.includes(s1!.id));
      assert.ok(cp!.remaining.includes(s3!.id));
      assert.ok(!cp!.remaining.includes(s1!.id));
    });
  });

  // ─── resumeMission: blocked ──────────────────────────────────────

  describe("resumeMission — blocked mission", () => {
    it("resumes a blocked mission, setting currentStepId and transitioning to working", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });
      const s2 = await store.addMissionStep({ title: "Step 2" });

      // Pass step 1, work on step 2
      await store.setCurrentStep(s1!.id);
      await store.updateMissionStepStatus(s1!.id, "passed");
      await store.setCurrentStep(s2!.id);
      const cp = await store.addCheckpoint({ stepId: s2!.id });

      // Block the step and the mission
      await store.updateMissionStepStatus(s2!.id, "blocked", { blockingReason: "need input" });
      const mission = store.getMission()!;
      mission.status = "blocked";
      await store.persistMissionNow();

      // Resume from checkpoint
      const ok = await store.resumeMission(cp!.id);
      assert.equal(ok, true);
      assert.equal(store.getMission()!.status, "working");
      assert.equal(store.getMission()!.currentStepId, s2!.id);
    });

    it("resets a blocked step to working on resume, clearing blockingReason", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });

      await store.setCurrentStep(s1!.id);
      await store.updateMissionStepStatus(s1!.id, "blocked", { blockingReason: "waiting" });
      const cp = await store.addCheckpoint({ stepId: s1!.id });

      // Set mission to blocked
      const mission = store.getMission()!;
      mission.status = "blocked";
      await store.persistMissionNow();

      const ok = await store.resumeMission(cp!.id);
      assert.equal(ok, true);

      const step = store.getMission()!.steps[0];
      assert.equal(step.status, "working");
      assert.equal(step.blockingReason, null);
      assert.ok(step.attemptCount! >= 2);
    });

    it("records resumedFrom in mission metadata", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });
      await store.setCurrentStep(s1!.id);
      const cp = await store.addCheckpoint({ stepId: s1!.id });

      // Block the mission
      const mission = store.getMission()!;
      mission.status = "blocked";
      await store.persistMissionNow();

      await store.resumeMission(cp!.id);
      assert.equal(store.getMission()!.metadata.resumedFrom, cp!.id);
    });

    it("preserves passed steps across blocked resume", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });
      const s2 = await store.addMissionStep({ title: "Step 2" });
      const s3 = await store.addMissionStep({ title: "Step 3" });

      await store.setCurrentStep(s1!.id);
      await store.updateMissionStepStatus(s1!.id, "passed");
      await store.setCurrentStep(s2!.id);
      await store.updateMissionStepStatus(s2!.id, "blocked", { blockingReason: "stuck" });
      const cp = await store.addCheckpoint({ stepId: s2!.id });

      const mission = store.getMission()!;
      mission.status = "blocked";
      await store.persistMissionNow();

      const ok = await store.resumeMission(cp!.id);
      assert.equal(ok, true);

      const m = store.getMission()!;
      assert.equal(m.steps[0].status, "passed"); // s1 still passed
      assert.equal(m.steps[1].status, "working"); // s2 reset from blocked
      assert.equal(m.steps[2].status, "pending"); // s3 still pending
    });
  });

  // ─── resumeMission: non-blocked missions are rejected ────────────

  describe("resumeMission — non-blocked missions are rejected", () => {
    it("rejects resume of a failed mission and remains failed", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });
      await store.setCurrentStep(s1!.id);
      const cp = await store.addCheckpoint({ stepId: s1!.id });

      // Fail the mission (working → failed is valid)
      await store.failMission("crashed");
      assert.equal(store.getMission()!.status, "failed");

      const ok = await store.resumeMission(cp!.id);
      assert.equal(ok, false);
      // Mission remains failed — no revival
      assert.equal(store.getMission()!.status, "failed");
    });

    it("does not clear failure state from a failed mission", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });
      await store.setCurrentStep(s1!.id);
      await store.updateMissionStepStatus(s1!.id, "failed", { failureReason: "boom" });
      const cp = await store.addCheckpoint({ stepId: s1!.id });

      await store.failMission("step failed");
      const ok = await store.resumeMission(cp!.id);
      assert.equal(ok, false);

      // Step failure state is preserved (auditable)
      const step = store.getMission()!.steps[0];
      assert.equal(step.status, "failed");
      assert.equal(step.failureReason, "boom");
    });

    it("rejects resume of a complete mission", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });
      await store.setCurrentStep(s1!.id);
      await store.updateMissionStepStatus(s1!.id, "passed");
      const cp = await store.addCheckpoint({ stepId: s1!.id });

      await store.setMissionVerifying();
      await store.completeMission("done");

      const ok = await store.resumeMission(cp!.id);
      assert.equal(ok, false);
      assert.equal(store.getMission()!.status, "complete");
    });

    it("rejects resume of a cancelled mission", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });
      await store.setCurrentStep(s1!.id);
      const cp = await store.addCheckpoint({ stepId: s1!.id });

      await store.cancelMission("user cancelled");

      const ok = await store.resumeMission(cp!.id);
      assert.equal(ok, false);
      assert.equal(store.getMission()!.status, "cancelled");
    });

    it("rejects resume of a planning mission with no mutation and no event", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      await store.addMissionStep({ title: "Step 1" });
      // Do NOT call setCurrentStep — that would transition planning → working.
      // addCheckpoint with a null stepId is valid while still in planning.
      const cp = await store.addCheckpoint({ stepId: null });
      assert.ok(cp);

      // createMission leaves the mission in "planning"
      assert.equal(store.getMission()!.status, "planning");
      const before = store.getMission()!;
      const statusBefore = before.status;
      const currentStepIdBefore = before.currentStepId;
      const resumedFromBefore = before.metadata.resumedFrom;

      const events: string[] = [];
      store.setEmitter((e) => { if (e.subtype) events.push(e.subtype); });

      const ok = await store.resumeMission(cp!.id);
      assert.equal(ok, false);

      const after = store.getMission()!;
      assert.equal(after.status, statusBefore);            // unchanged
      assert.equal(after.currentStepId, currentStepIdBefore); // unchanged
      assert.equal(after.metadata.resumedFrom, resumedFromBefore); // unchanged
      assert.ok(!events.includes("mission:resumed"));      // no resume event
    });

    it("rejects resume of a working mission with no mutation and no event", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });
      await store.setCurrentStep(s1!.id);
      const cp = await store.addCheckpoint({ stepId: s1!.id });

      // setCurrentStep already promoted planning → working; assert it.
      assert.equal(store.getMission()!.status, "working");
      const before = store.getMission()!;
      const statusBefore = before.status;
      const currentStepIdBefore = before.currentStepId;
      const resumedFromBefore = before.metadata.resumedFrom;

      const events: string[] = [];
      store.setEmitter((e) => { if (e.subtype) events.push(e.subtype); });

      const ok = await store.resumeMission(cp!.id);
      assert.equal(ok, false);

      const after = store.getMission()!;
      assert.equal(after.status, statusBefore);
      assert.equal(after.currentStepId, currentStepIdBefore);
      assert.equal(after.metadata.resumedFrom, resumedFromBefore);
      assert.ok(!events.includes("mission:resumed"));
    });

    it("rejects resume of a verifying mission with no mutation and no event", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });
      await store.setCurrentStep(s1!.id);
      await store.updateMissionStepStatus(s1!.id, "passed");
      const cp = await store.addCheckpoint({ stepId: s1!.id });

      // working → verifying is valid
      await store.setMissionVerifying();
      assert.equal(store.getMission()!.status, "verifying");
      const before = store.getMission()!;
      const statusBefore = before.status;
      const currentStepIdBefore = before.currentStepId;
      const resumedFromBefore = before.metadata.resumedFrom;

      const events: string[] = [];
      store.setEmitter((e) => { if (e.subtype) events.push(e.subtype); });

      const ok = await store.resumeMission(cp!.id);
      assert.equal(ok, false);

      const after = store.getMission()!;
      assert.equal(after.status, statusBefore);
      assert.equal(after.currentStepId, currentStepIdBefore);
      assert.equal(after.metadata.resumedFrom, resumedFromBefore);
      assert.ok(!events.includes("mission:resumed"));
    });
  });

  // ─── resumeMission: edge cases ───────────────────────────────────

  describe("resumeMission — edge cases", () => {
    it("rejects an invalid checkpoint even when the mission is blocked", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Step 1" });
      await store.setCurrentStep(s1!.id);

      // Put the mission into blocked so the status guard passes and the
      // checkpoint lookup is what fails.
      const mission = store.getMission()!;
      mission.status = "blocked";
      await store.persistMissionNow();
      assert.equal(store.getMission()!.status, "blocked");

      const ok = await store.resumeMission("nonexistent_checkpoint");
      assert.equal(ok, false);
      // Mission stays blocked — no partial mutation
      assert.equal(store.getMission()!.status, "blocked");
    });

    it("returns false when there is no active mission", async () => {
      const ok = await store.resumeMission("any");
      assert.equal(ok, false);
    });
  });

  // ─── cancelMission ───────────────────────────────────────────────

  describe("cancelMission", () => {
    it("transitions the mission to cancelled with a reason", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      await store.addMissionStep({ title: "Step 1" });

      await store.cancelMission("user cancelled");

      const mission = store.getMission()!;
      assert.equal(mission.status, "cancelled");
      assert.equal(mission.blockingReason, "user cancelled");
      assert.ok(mission.completedAt);
    });

    it("is a no-op when there is no active mission", async () => {
      // Should not throw
      await store.cancelMission("no mission");
    });

    it("does not cancel an already-complete mission", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      await store.addMissionStep({ title: "Step 1" });
      const step = store.getMission()?.steps[0];
      await store.setCurrentStep(step!.id);
      await store.updateMissionStepStatus(step!.id, "passed");
      await store.setMissionVerifying();
      await store.completeMission("done");

      await store.cancelMission("late cancel");

      // Status should still be complete
      assert.equal(store.getMission()!.status, "complete");
    });
  });

  // ─── State machine: working→failed and verifying→failed ──────────

  describe("State machine — failure transitions", () => {
    it("working → failed is valid", () => {
      assert.equal(isValidMissionTransition("working", "failed"), true);
    });

    it("verifying → failed is valid", () => {
      assert.equal(isValidMissionTransition("verifying", "failed"), true);
    });

    it("failed → working is rejected (terminal)", () => {
      assert.equal(isValidMissionTransition("failed", "working"), false);
    });

    it("blocked → working is valid (resume from blocked)", () => {
      assert.equal(isValidMissionTransition("blocked", "working"), true);
    });
  });

  // ─── Integration: checkpoint → block → resume → continue ─────────

  describe("Integration: checkpoint → block → resume", () => {
    it("proves a blocked mission can be checkpointed, blocked, and resumed", async () => {
      await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
      const s1 = await store.addMissionStep({ title: "Inspect" });
      const s2 = await store.addMissionStep({ title: "Typecheck" });
      const s3 = await store.addMissionStep({ title: "Verify" });

      // Complete step 1
      await store.setCurrentStep(s1!.id);
      await store.updateMissionStepStatus(s1!.id, "passed");

      // Start step 2, checkpoint
      await store.setCurrentStep(s2!.id);
      const cp = await store.addCheckpoint({ stepId: s2!.id });
      assert.ok(cp);

      // Block step 2 and mission
      await store.updateMissionStepStatus(s2!.id, "blocked", { blockingReason: "need approval" });
      const mission = store.getMission()!;
      mission.status = "blocked";
      await store.persistMissionNow();

      // Verify mission is blocked
      assert.equal(store.getMission()!.status, "blocked");

      // Resume from checkpoint
      const resumed = await store.resumeMission(cp!.id);
      assert.equal(resumed, true);

      // Mission is back to working, step 2 is current and working
      const m = store.getMission()!;
      assert.equal(m.status, "working");
      assert.equal(m.currentStepId, s2!.id);

      // Step 1 is still passed (preserved across block/resume)
      assert.equal(m.steps[0].status, "passed");
      // Step 2 is working (reset from blocked)
      assert.equal(m.steps[1].status, "working");
      assert.equal(m.steps[1].blockingReason, null);
      // Step 3 is still pending
      assert.equal(m.steps[2].status, "pending");

      // Can continue: pass step 2, move to step 3
      await store.updateMissionStepStatus(s2!.id, "passed");
      await store.setCurrentStep(s3!.id);
      assert.equal(store.getMission()!.currentStepId, s3!.id);
    });
  });
});
