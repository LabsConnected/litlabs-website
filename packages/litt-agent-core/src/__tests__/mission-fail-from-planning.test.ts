/**
 * failMission from "planning" — acceptance regression.
 *
 * First-run acceptance failure-path finding: a read-only inspection
 * mission whose model FABRICATES a verified answer with ZERO tool calls
 * never triggers setCurrentStep (that only happens on tool calls), so the
 * canonical mission stays "planning". failMission() then silently no-opped
 * (planning → failed is not a valid transition), leaving the persisted
 * mission non-terminal and marked active — it would resurrect on restart.
 *
 * Fix: failMission() routes "planning" through the legal path
 * (planning → working → failed), mirroring the existing "verifying"
 * special case. This test locks the contract:
 *   - failMission from planning reaches canonical "failed"
 *   - failure evidence is recorded
 *   - a failed-from-planning mission is NOT restored by recovery
 *   - direct working → failed behavior is unchanged
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { RuntimeStore } from "../state.js";

function createTempDir(): string {
  const tmp = path.join(os.tmpdir(), `litt-fail-planning-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "test-project", version: "1.0.0" }),
  );
  return tmp;
}

function cleanupTempDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
}

describe("failMission from planning (zero-tool acceptance regression)", () => {
  let tmpDir: string;
  let store: RuntimeStore;

  beforeEach(() => {
    tmpDir = createTempDir();
    store = new RuntimeStore({ projectRoot: tmpDir });
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  async function createPlanningOnlyMission(): Promise<string> {
    await store.createMission({
      goal: "Inspect this repository",
      mode: "act",
      projectRoot: tmpDir,
      sessionId: null,
      workspaceId: null,
      metadata: {},
    });
    await store.addMissionStep({ title: "Inspect repository metadata", requiredEvidence: ["repository_status"] });
    await store.addMissionStep({ title: "Report current status", requiredEvidence: [] });
    // NOTE: NO setCurrentStep — simulates a model that fabricated a
    // verified answer with zero tool calls. The mission never leaves
    // "planning", exactly like the first-run failure path.
    const mission = store.getMission();
    assert.equal(mission?.status, "planning");
    return mission!.id;
  }

  it("failMission from planning reaches canonical failed (no silent no-op)", async () => {
    const missionId = await createPlanningOnlyMission();

    await store.failMission("Verification not proven: no successful tool evidence was collected.");

    const mission = store.getMission();
    assert.equal(mission?.id, missionId);
    assert.equal(mission?.status, "failed");
    assert.match(mission?.failureReason ?? "", /no successful tool evidence/);
    assert.ok(mission?.completedAt, "completedAt must be set");
  });

  it("records failed verification evidence on the mission", async () => {
    await createPlanningOnlyMission();

    await store.failMission("not proven", "Repository inspection did not complete (max_rounds)");

    const mission = store.getMission();
    const verificationEvidence = mission?.evidence.find((e) => e.type === "verification_result");
    assert.ok(verificationEvidence, "verification_result evidence must be recorded");
    assert.equal(verificationEvidence?.success, false);
    assert.match(verificationEvidence?.summary ?? "", /max_rounds/);
  });

  it("a mission failed from planning is NOT restored by recovery (no resurrection)", async () => {
    await createPlanningOnlyMission();
    await store.failMission("not proven");

    // Fresh store on the same project root — simulates a cockpit restart.
    const fresh = new RuntimeStore({ projectRoot: tmpDir });
    const recovery = await fresh.loadWithRecovery();

    assert.equal(recovery.recovered, false);
    assert.equal(recovery.mission, null);
    assert.equal(fresh.getMission(), null);
  });

  it("direct working → failed behavior is unchanged", async () => {
    await store.createMission({
      goal: "mutate",
      mode: "act",
      projectRoot: tmpDir,
      sessionId: null,
      workspaceId: null,
      metadata: {},
    });
    const step = await store.addMissionStep({ title: "Do work" });
    await store.setCurrentStep(step!.id); // planning → working
    assert.equal(store.getMission()?.status, "working");

    await store.failMission("boom");
    assert.equal(store.getMission()?.status, "failed");
  });

  it("completeMission from planning still refuses (unchanged)", async () => {
    await createPlanningOnlyMission();

    await store.completeMission("should not complete");
    assert.equal(store.getMission()?.status, "planning");
  });
});
