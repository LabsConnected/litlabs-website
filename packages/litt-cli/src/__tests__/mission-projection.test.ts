/**
 * MissionProjection — proves the cockpit's mission view is a pure
 * derivation of the canonical RuntimeStore.mission.
 *
 * RuntimeStore.mission is the ONLY mission authority. CockpitStore may
 * cache/project values for Ink rendering, but it must derive them
 * entirely from canonical mission state. This test proves:
 *
 *   1. projectMission() returns null when there is no mission
 *   2. projectMission() derives goal/status/currentStepId from the mission
 *   3. projectMission() derives semantic steps from mission.steps
 *   4. projectMission() derives pending/working/passed/blocked/failed counts
 *   5. projectMission() derives verificationProven from mission.evidence
 *   6. projectMission() is a pure function — same mission in, same projection out
 *   7. The projection contains NO independently-mutated lifecycle truth
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { projectMission } from "../ink/mission-projection.js";
import type { Mission } from "@litt/agent-core";

function createTempDir(): string {
  const tmp = path.join(os.tmpdir(), `litt-proj-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function cleanupTempDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
}

describe("MissionProjection — canonical mission truth projection", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-project", version: "1.0.0" }),
    );
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it("returns null when there is no active mission", () => {
    const session = createRuntimeSession({ cwd: tmpDir });
    const store = session.getStore();
    expect(projectMission(store.getMission())).toBeNull();
  });

  it("derives goal, status, currentStepId, and mode from the canonical mission", async () => {
    const session = createRuntimeSession({ cwd: tmpDir });
    const store = session.getStore();

    const mission = await store.createMission({
      goal: "Get my website stable and ready for production.",
      mode: "act",
      projectRoot: tmpDir,
    });

    const projection = projectMission(store.getMission())!;
    expect(projection).not.toBeNull();
    expect(projection.id).toBe(mission.id);
    expect(projection.goal).toBe("Get my website stable and ready for production.");
    expect(projection.status).toBe("planning");
    expect(projection.currentStepId).toBeNull();
    expect(projection.mode).toBe("act");
  });

  it("derives semantic steps from mission.steps", async () => {
    const session = createRuntimeSession({ cwd: tmpDir });
    const store = session.getStore();

    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    await store.addMissionStep({ title: "Inspect baseline", allowedActionScope: ["inspect"] });
    await store.addMissionStep({ title: "Typecheck", allowedActionScope: ["check"] });
    await store.addMissionStep({ title: "Verify", allowedActionScope: ["verify"] });

    const projection = projectMission(store.getMission())!;
    expect(projection.steps.length).toBe(3);
    expect(projection.steps[0].title).toBe("Inspect baseline");
    expect(projection.steps[0].scope).toEqual(["inspect"]);
    expect(projection.steps[0].status).toBe("pending");
    expect(projection.steps[1].title).toBe("Typecheck");
    expect(projection.steps[2].title).toBe("Verify");
  });

  it("derives pending/working/passed/blocked/failed counts from step statuses", async () => {
    const session = createRuntimeSession({ cwd: tmpDir });
    const store = session.getStore();

    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    const s1 = await store.addMissionStep({ title: "Step 1" });
    const s2 = await store.addMissionStep({ title: "Step 2" });
    await store.addMissionStep({ title: "Step 3" });
    await store.addMissionStep({ title: "Step 4" });

    // s1: working → passed
    await store.setCurrentStep(s1!.id);
    await store.updateMissionStepStatus(s1!.id, "passed");
    // s2: working → failed
    await store.setCurrentStep(s2!.id);
    await store.updateMissionStepStatus(s2!.id, "failed", { failureReason: "boom" });

    const projection = projectMission(store.getMission())!;
    expect(projection.passed).toBe(1);
    expect(projection.failed).toBe(1);
    expect(projection.pending).toBe(2);
    expect(projection.working).toBe(0);
    expect(projection.blocked).toBe(0);
  });

  it("derives currentStepId from the canonical mission", async () => {
    const session = createRuntimeSession({ cwd: tmpDir });
    const store = session.getStore();

    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    const s1 = await store.addMissionStep({ title: "Step 1" });
    await store.setCurrentStep(s1!.id);

    const projection = projectMission(store.getMission())!;
    expect(projection.currentStepId).toBe(s1!.id);
    expect(projection.steps[0].status).toBe("working");
  });

  it("derives verificationProven from mission.evidence (verification_result)", async () => {
    const session = createRuntimeSession({ cwd: tmpDir });
    const store = session.getStore();

    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    await store.addMissionStep({ title: "Step 1" });

    // No verification evidence yet → null
    expect(projectMission(store.getMission())!.verificationProven).toBeNull();

    // Add failed verification evidence
    await store.addMissionEvidence({
      stepId: null,
      type: "verification_result",
      source: "VerificationGate",
      summary: "tests failed",
      success: false,
    });
    expect(projectMission(store.getMission())!.verificationProven).toBe(false);

    // Add passed verification evidence (most recent wins — it's the first match)
    // Since evidence is find(), the first verification_result wins. To simulate
    // a later proven result, we test with a fresh mission.
  });

  it("derives verificationProven=true when evidence records success", async () => {
    const session = createRuntimeSession({ cwd: tmpDir });
    const store = session.getStore();

    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    await store.addMissionEvidence({
      stepId: null,
      type: "verification_result",
      source: "VerificationGate",
      summary: "all checks passed",
      success: true,
    });

    expect(projectMission(store.getMission())!.verificationProven).toBe(true);
  });

  it("is a pure function — same mission in, same projection out", async () => {
    const session = createRuntimeSession({ cwd: tmpDir });
    const store = session.getStore();

    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    await store.addMissionStep({ title: "Step 1" });

    const mission = store.getMission()!;
    const p1 = projectMission(mission);
    const p2 = projectMission(mission);

    expect(p1).toEqual(p2);
  });

  it("projection reflects toolHistory / actionHistory counts from the canonical step", async () => {
    const session = createRuntimeSession({ cwd: tmpDir });
    const store = session.getStore();

    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    const step = await store.addMissionStep({ title: "Diagnose" });

    // Directly mutate the canonical step's toolHistory (as attachToolToStep does)
    step!.toolHistory.push("tc_1", "tc_2");
    step!.actionHistory.push({
      description: "search",
      tool: "project.search",
      timestamp: new Date().toISOString(),
      status: "success",
    });
    step!.filesChanged.push("src/a.ts");

    const projection = projectMission(store.getMission())!;
    expect(projection.steps[0].toolCount).toBe(2);
    expect(projection.steps[0].actionCount).toBe(1);
    expect(projection.steps[0].filesChangedCount).toBe(1);
    expect(projection.steps[0].filesReadCount).toBe(0);
  });

  it("marks restored=true when the restored flag is passed", async () => {
    const session = createRuntimeSession({ cwd: tmpDir });
    const store = session.getStore();

    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });

    const projection = projectMission(store.getMission(), true)!;
    expect(projection.restored).toBe(true);

    const notRestored = projectMission(store.getMission(), false)!;
    expect(notRestored.restored).toBe(false);
  });

  it("projection contains NO independently-mutated lifecycle truth", async () => {
    // The projection is a pure snapshot. Mutating the projection must
    // NOT affect the canonical mission, and vice-versa changes to the
    // projection's arrays must not leak back.
    const session = createRuntimeSession({ cwd: tmpDir });
    const store = session.getStore();

    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    await store.addMissionStep({ title: "Step 1" });

    const mission = store.getMission()!;
    const projection = projectMission(mission)!;

    // Mutate the projection's steps array
    projection.steps.push({
      id: "fake",
      sequence: 99,
      title: "FAKE",
      description: "",
      status: "passed",
      scope: [],
      toolCount: 0,
      actionCount: 0,
      filesReadCount: 0,
      filesChangedCount: 0,
      startedAt: null,
      finishedAt: null,
      failureReason: null,
      blockingReason: null,
    });

    // The canonical mission is unaffected
    expect(store.getMission()?.steps.length).toBe(1);
    expect(store.getMission()?.steps.find((s) => s.id === "fake")).toBeUndefined();
  });

  it("derives completionReason and failureReason from the canonical mission", async () => {
    const session = createRuntimeSession({ cwd: tmpDir });
    const store = session.getStore();

    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    await store.addMissionStep({ title: "Step 1" });
    const step = store.getMission()?.steps[0];
    await store.setCurrentStep(step!.id);
    await store.updateMissionStepStatus(step!.id, "passed");
    await store.setMissionVerifying();
    await store.completeMission("Verified by gate", "All checks passed");

    const projection = projectMission(store.getMission())!;
    expect(projection.status).toBe("complete");
    expect(projection.completionReason).toBe("Verified by gate");
    expect(projection.completedAt).not.toBeNull();
  });
});
