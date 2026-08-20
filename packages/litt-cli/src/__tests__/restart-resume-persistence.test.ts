/**
 * Restart/resume persistence proof — proves a mission survives a process
 * restart and resumes in a separate RuntimeStore with the same missionId
 * and current step.
 *
 * This is a deterministic filesystem-persistence test (no network, no
 * provider credits). It proves the nonterminal restart/resume contract:
 *   1. Store A: create a mission, plan steps, advance to a middle step,
 *      persist to disk. This simulates "start a mission, reach a middle
 *      semantic step, then the process exits."
 *   2. Store B: create a NEW RuntimeStore with the SAME projectRoot
 *      (same .litt/ dir), call load(), and prove the mission restored
 *      with the same missionId, same currentStepId, and can continue
 *      (advance the next step).
 *
 * NOTE: This does NOT perform a true OS process kill. The two RuntimeStore
 * instances are independent objects with no shared in-memory state — only
 * the filesystem persistence connects them, which is the same durability
 * boundary a real process restart would cross. The proof is about
 * persistence-layer restore semantics, not OS signal handling.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { RuntimeStore } from "@litt/agent-core";

describe("restart/resume persistence — mission survives process restart and resumes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-resume-"));
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("restores same missionId + currentStepId in a separate RuntimeStore and continues", async () => {
    // ─── PROCESS A: start mission, plan steps, advance to middle ───
    const storeA = new RuntimeStore({ projectRoot: tempDir });
    await storeA.load(); // no active mission yet

    const mission = await storeA.createMission({
      goal: "Fix the typecheck error in utils.ts",
      mode: "act",
      projectRoot: tempDir,
      sessionId: null,
      workspaceId: null,
      metadata: { source: "restart-resume-proof" },
    });
    const missionId = mission.id;
    expect(missionId).toBeTruthy();

    // Plan 3 semantic steps via addMissionStep
    await storeA.addMissionStep({ title: "Read utils.ts", description: "Read the file" });
    await storeA.addMissionStep({ title: "Edit utils.ts", description: "Apply the fix" });
    await storeA.addMissionStep({ title: "Verify typecheck", description: "Run the gate" });

    // Advance: step-1 passed, step-2 working (middle semantic step)
    const stepsA = storeA.getMission()!.steps;
    const step1Id = stepsA[0].id;
    const step2Id = stepsA[1].id;
    const step3Id = stepsA[2].id;
    // Valid transition: pending → working → passed
    await storeA.setCurrentStep(step1Id);
    await storeA.updateMissionStepStatus(step1Id, "working");
    await storeA.updateMissionStepStatus(step1Id, "passed", {
      verificationPassed: true,
      verificationEvidence: "File read",
    });
    await storeA.setCurrentStep(step2Id);
    await storeA.updateMissionStepStatus(step2Id, "working");
    // Persist the mid-step state
    await storeA.persistMissionNow();

    // Verify process A state
    const midA = storeA.getMission();
    expect(midA).not.toBeNull();
    expect(midA!.id).toBe(missionId);
    expect(midA!.currentStepId).toBe(step2Id);
    expect(midA!.steps[1].status).toBe("working");

    // ─── KILL PROCESS A (implicit — we just drop the reference) ───
    // No more calls to storeA. In a real restart, the process exits here.

    // ─── PROCESS B: relaunch — new RuntimeStore, same .litt/ dir ───
    const storeB = new RuntimeStore({ projectRoot: tempDir });
    await storeB.load(); // restores active mission from disk

    const restored = storeB.getMission();
    expect(restored).not.toBeNull();
    // SAME missionId — the mission identity survived the restart
    expect(restored!.id).toBe(missionId);
    // SAME currentStepId — the semantic position survived the restart
    expect(restored!.currentStepId).toBe(step2Id);
    // The step state survived
    expect(restored!.steps.length).toBe(3);
    expect(restored!.steps[0].status).toBe("passed");
    expect(restored!.steps[1].status).toBe("working");
    expect(restored!.steps[2].status).toBe("pending");

    // ─── CONTINUE — advance from step-2 to step-3 in process B ───
    // step2 is already "working" (restored). Transition to passed.
    await storeB.updateMissionStepStatus(step2Id, "passed", {
      verificationPassed: true,
      verificationEvidence: "Edit applied",
    });
    await storeB.setCurrentStep(step3Id);
    await storeB.persistMissionNow();

    const continued = storeB.getMission();
    expect(continued!.currentStepId).toBe(step3Id);
    expect(continued!.steps[1].status).toBe("passed");
    // missionId unchanged across the continue
    expect(continued!.id).toBe(missionId);
  });
});
