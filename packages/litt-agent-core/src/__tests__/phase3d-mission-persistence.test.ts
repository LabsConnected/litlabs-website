/**
 * Phase 3D � MissionStore Persistence and Recovery Tests
 *
 * Tests durable MissionStore persistence integrated with RuntimeStore:
 * - save/load mission state
 * - restart recovery
 * - resume support
 * - corrupted/missing-state handling
 * - targeted persistence/recovery tests
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  MissionStore,
  createMissionStore,
  type Mission,
  type Checkpoint,
} from "../index.js";
import {
  RuntimeStore,
  createFilesystemMissionPersistence,
} from "../state.js";

// --- Test Helpers -----------------------------------------------------

function createTempDir(): string {
  const tmp = path.join(
    os.tmpdir(),
    `litt-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ok if already gone
  }
}

function createTestMission(
  overrides: Partial<Mission> = {}
): Mission {
  return {
    id: `mission_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    version: "1.0.0",
    goal: "Test mission for persistence",
    normalizedGoal: "test-mission",
    projectRoot: "/workspace/test",
    workspaceId: "workspace_123",
    sessionId: "session_123",
    mode: "auto",
    status: "working",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    currentStepId: "step_1",
    steps: [
      {
        id: "step_1",
        sequence: 1,
        title: "Test step",
        description: "A test step",
        status: "working",
        requiredEvidence: ["command_result"],
        dependencies: [],
        allowedActionScope: ["all"],
        toolHistory: ["project.status"],
        actionHistory: [],
        filesRead: [],
        filesChanged: [],
        verificationResults: [],
        attemptCount: 1,
        repairAttemptCount: 0,
        failureReason: null,
        blockingReason: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      },
    ],
    baseline: null,
    evidence: [],
    checkpoints: [],
    attemptCounters: {},
    retryBudgets: {},
    providerState: null,
    blockingReason: null,
    failureReason: null,
    completionReason: null,
    lastHeartbeatAt: Date.now(),
    metadata: {},
    ...overrides,
  };
}

// --- MissionStore Basic Persistence Tests -------------------------------

describe("Phase 3D � MissionStore Basic Persistence", () => {
  let tmpDir: string;
  let store: MissionStore;

  beforeEach(() => {
    tmpDir = createTempDir();
    store = createMissionStore(tmpDir);
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it("creates a mission and saves it to disk", () => {
    const mission = store.createMission({
      goal: "Build a feature",
      mode: "auto",
      sessionId: "session_1",
      workspaceId: "workspace_1",
      projectRoot: tmpDir,
    });

    assert.ok(mission.id.startsWith("mission_"));
    assert.equal(mission.status, "planning");
    
    // Verify file was created
    const missionsDir = path.join(tmpDir, ".litt");
    const missionFile = path.join(missionsDir, `${mission.id}.json`);
    assert.ok(fs.existsSync(missionFile));
  });

  it("loads a saved mission", () => {
    const mission = createTestMission();
    store.updateMission(mission);

    const loaded = store.getMission(mission.id);
    assert.ok(loaded !== null);
    assert.equal(loaded?.id, mission.id);
    assert.equal(loaded?.goal, mission.goal);
  });

  it("returns null for non-existent mission", () => {
    const loaded = store.getMission("nonexistent_mission");
    assert.equal(loaded, null);
  });

  it("lists missions with status filter", () => {
    store.createMission({
      goal: "Mission 1",
      mode: "plan",
      sessionId: null,
      workspaceId: null,
      projectRoot: tmpDir,
    });
    const m2 = store.createMission({
      goal: "Mission 2",
      mode: "auto",
      sessionId: null,
      workspaceId: null,
      projectRoot: tmpDir,
    });

    // Set m2 to working
    m2.status = "working";
    store.updateMission(m2);

    const all = store.listMissions();
    assert.equal(all.length, 2);

    const working = store.listMissions({ status: "working" });
    assert.equal(working.length, 1);
    assert.equal(working[0].id, m2.id);
  });

  it("deletes a mission", () => {
    const mission = store.createMission({
      goal: "To delete",
      mode: "plan",
      sessionId: null,
      workspaceId: null,
      projectRoot: tmpDir,
    });

    assert.ok(store.hasMission(mission.id));
    
    const deleted = store.deleteMission(mission.id);
    assert.equal(deleted, true);
    assert.ok(!store.hasMission(mission.id));
  });
});

// --- Corrupted/Missing State Handling Tests ---------------------------

describe("Phase 3D � Corrupted/Missing State Handling", () => {
  let tmpDir: string;
  let store: MissionStore;

  beforeEach(() => {
    tmpDir = createTempDir();
    store = createMissionStore(tmpDir);
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it("handles corrupted JSON file gracefully", () => {
    // Create a corrupted mission file manually
    const missionsDir = path.join(tmpDir, ".litt");
    fs.mkdirSync(missionsDir, { recursive: true });
    const corruptedPath = path.join(missionsDir, "corrupted_mission.json");
    fs.writeFileSync(corruptedPath, "{ not valid json }");

    // getMission should return null for corrupted file
    const loaded = store.getMission("corrupted_mission");
    assert.equal(loaded, null);
  });

  it("loadMissionWithRecovery reports errors for corrupted files", () => {
    const corruptedPath = path.join(tmpDir, ".litt", "corrupted_mission.json");
    fs.mkdirSync(path.dirname(corruptedPath), { recursive: true });
    fs.writeFileSync(corruptedPath, "{ not valid json }");

    const result = store.loadMissionWithRecovery("corrupted_mission");
    
    assert.equal(result.recoveryAttempted, true);
    assert.equal(result.recovered, null);
    assert.ok(result.error);
    assert.equal(result.error?.reason, "corrupted");
  });

  it("loadMissionWithRecovery reports errors for missing files", () => {
    const result = store.loadMissionWithRecovery("missing_mission");
    
    assert.equal(result.recoveryAttempted, true);
    assert.equal(result.recovered, null);
    assert.ok(result.error);
    assert.equal(result.error?.reason, "missing");
  });

  it("loadMissionWithRecovery returns valid mission for valid file", () => {
    const mission = createTestMission();
    store.updateMission(mission);

    const result = store.loadMissionWithRecovery(mission.id);
    
    assert.equal(result.recoveryAttempted, true);
    assert.ok(result.recovered);
    assert.equal(result.recovered?.id, mission.id);
    assert.equal(result.error, undefined);
  });

  it("recoverMissionFromBackup restores from backup file", () => {
    const mission = createTestMission();
    store.updateMission(mission);
    // Second save creates the backup per the backup contract
    store.updateMission(mission);
    
    // Corrupt the main file
    const mainPath = path.join(tmpDir, ".litt", `${mission.id}.json`);
    fs.writeFileSync(mainPath, "corrupted content");
    
    // Recovery should use backup
    const recovered = store.recoverMissionFromBackup(mission.id);
    assert.ok(recovered !== null);
    assert.equal(recovered?.id, mission.id);
    assert.ok(fs.existsSync(mainPath)); // File should be restored
  });

  it("returns null when no backup exists for recovery", () => {
    const result = store.loadMissionWithRecovery("nonexistent");
    assert.equal(result.recovered, null);
  });

  it("handles incomplete mission data with defaults", () => {
    const missionsDir = path.join(tmpDir, ".litt");
    const incompletePath = path.join(missionsDir, "incomplete.json");
    fs.mkdirSync(missionsDir, { recursive: true });
    
    // Write incomplete mission (missing optional fields)
    fs.writeFileSync(incompletePath, JSON.stringify({
      id: "incomplete_mission",
      version: "1.0.0",
      createdAt: new Date().toISOString(),
      // goal, status, etc. missing
    }));
    
    const loaded = store.getMission("incomplete");
    assert.ok(loaded !== null);
    assert.equal(loaded?.id, "incomplete_mission");
    assert.equal(loaded?.status, "planning"); // default
    assert.equal(loaded?.goal, ""); // default
  });
});

// --- Restart Recovery Tests -------------------------------------------

describe("Phase 3D � Restart Recovery", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it("RuntimeStore.load() restores mission state on restart", async () => {
    // Create store with persistence
    const store = new RuntimeStore({
      projectRoot: tmpDir,
      emitter: null,
    });

    // Set a mission
    const mission = createTestMission();
    await store.setMission(mission);

    // Simulate restart by creating new store instance
    const newStore = new RuntimeStore({
      projectRoot: tmpDir,
      emitter: null,
    });

    // Load should restore the mission
    await newStore.load();
    
    const state = newStore.getState();
    assert.ok(state.mission !== null);
    assert.equal(state.mission?.id, mission.id);
    assert.equal(state.mission?.goal, mission.goal);
  });

  it("RuntimeStore.loadWithRecovery() handles missing state", async () => {
    const store = new RuntimeStore({
      projectRoot: tmpDir,
      emitter: null,
    });

    const result = await store.loadWithRecovery();
    
    assert.equal(result.recovered, false);
    assert.equal(result.error?.reason, "missing");
  });

  it("RuntimeStore.loadWithRecovery() restores corrupted state from backup", async () => {
    // Create initial store and save a mission
    const store1 = new RuntimeStore({
      projectRoot: tmpDir,
      emitter: null,
    });
    
    const mission = createTestMission();
    await store1.setMission(mission);
    // Second save creates the backup per the backup contract
    await store1.setMission(mission);

    // Corrupt the mission file
    const missionPath = path.join(
      tmpDir,
      ".litt",
      `${mission.id}.json`
    );
    fs.writeFileSync(missionPath, "corrupted");

    // Create new store and attempt recovery
    const store2 = new RuntimeStore({
      projectRoot: tmpDir,
      emitter: null,
    });

    const result = await store2.loadWithRecovery();
    
    // Should have recovered the mission from backup
    assert.equal(result.recovered, true);
    assert.ok(result.resumedFrom === undefined); // Not a resume, just recovery
    assert.ok(store2.getState().mission !== null);
    assert.equal(store2.getState().mission?.id, mission.id);
  });

  it("preserves mission steps count on recovery", async () => {
    const store1 = new RuntimeStore({
      projectRoot: tmpDir,
      emitter: null,
    });

    const mission = createTestMission({
      steps: [
        { ...createTestMission().steps[0], status: "passed" },
        { ...createTestMission().steps[0], id: "step_2", status: "passed" },
        { ...createTestMission().steps[0], id: "step_3", status: "working" },
      ],
    });
    await store1.setMission(mission);

    // New store reloads
    const store2 = new RuntimeStore({
      projectRoot: tmpDir,
      emitter: null,
    });
    await store2.load();

    assert.equal(store2.getState().missionStepsCompleted, 2);
  });
});

// --- Resume Support Tests ----------------------------------------------

describe("Phase 3D � Resume Support", () => {
  let tmpDir: string;
  let store: MissionStore;

  beforeEach(() => {
    tmpDir = createTempDir();
    store = createMissionStore(tmpDir);
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it("creates and stores checkpoint", () => {
    const mission = createTestMission();
    
    const checkpoint: Checkpoint = {
      id: "checkpoint_1",
      missionId: mission.id,
      stepId: null,
      provenAt: [],
      changes: ["file1.ts", "file2.ts"],
      remaining: ["build", "test"],
      resumePoint: "step_1",
      retryBudgets: {
        modelRetries: 2,
        repairAttempts: 3,
        toolRetries: 3,
        providerFailureThreshold: 5,
      },
      runtimeVersion: "1.0.0",
      createdAt: new Date().toISOString(),
    };

    mission.checkpoints.push(checkpoint);
    store.updateMission(mission);

    const loaded = store.getMission(mission.id);
    assert.ok(loaded?.checkpoints.length === 1);
    assert.equal(loaded?.checkpoints[0].id, checkpoint.id);
  });

  it("getLatestCheckpoint returns most recent checkpoint", () => {
    const mission = createTestMission();
    const ts1 = new Date("2026-01-01").toISOString();
    const ts2 = new Date("2026-01-02").toISOString();
    
    mission.checkpoints = [
      {
        id: "old_checkpoint",
        missionId: mission.id,
        stepId: null,
        provenAt: [],
        changes: ["change1"],
        remaining: [],
        resumePoint: "step_1",
        retryBudgets: {},
        runtimeVersion: "1.0.0",
        createdAt: ts1,
      },
      {
        id: "new_checkpoint",
        missionId: mission.id,
        stepId: "step_2",
        provenAt: [],
        changes: ["change2"],
        remaining: [],
        resumePoint: "step_3",
        retryBudgets: {},
        runtimeVersion: "1.0.0",
        createdAt: ts2,
      },
    ];
    
    store.updateMission(mission);
    
    const latest = store.getLatestCheckpoint(mission.id);
    assert.equal(latest?.id, "new_checkpoint");
  });

  it("resumeFromCheckpoint creates a resumed mission", () => {
    const mission = createTestMission({
      steps: [
        {
          id: "step_1",
          sequence: 1,
          title: "Step 1",
          description: "First step",
          status: "passed",
          requiredEvidence: [],
          dependencies: [],
          allowedActionScope: [],
          toolHistory: [],
          actionHistory: [],
          filesRead: [],
          filesChanged: [],
          verificationResults: [],
          attemptCount: 1,
          repairAttemptCount: 0,
          failureReason: null,
          blockingReason: null,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
        {
          id: "step_2",
          sequence: 2,
          title: "Step 2",
          description: "Second step",
          status: "working",
          requiredEvidence: [],
          dependencies: [],
          allowedActionScope: [],
          toolHistory: [],
          actionHistory: [],
          filesRead: [],
          filesChanged: [],
          verificationResults: [],
          attemptCount: 1,
          repairAttemptCount: 0,
          failureReason: null,
          blockingReason: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
        },
      ],
    });
    
    mission.checkpoints = [
      {
        id: "checkpoint_1",
        missionId: mission.id,
        stepId: null,
        provenAt: [],
        changes: ["file1.ts"],
        remaining: ["build", "test"],
        resumePoint: "step_1",
        retryBudgets: {},
        runtimeVersion: "1.0.0",
        createdAt: new Date().toISOString(),
      },
    ];
    
    store.updateMission(mission);
    
    const resumed = store.resumeFromCheckpoint(mission.id, "checkpoint_1");
    
    assert.ok(resumed !== null);
    assert.equal(resumed?.status, "working");
    assert.equal(resumed?.currentStepId, "step_1");
    assert.ok(resumed?.metadata.resumedFrom === "checkpoint_1");
    assert.ok(resumed?.startedAt !== null);
  });

  it("returns null when checkpoint not found", () => {
    const mission = createTestMission();
    store.updateMission(mission);
    
    const result = store.resumeFromCheckpoint(mission.id, "nonexistent_checkpoint");
    assert.equal(result, null);
  });
});

// --- RuntimeStore Persistence Integration Tests -----------------------

describe("Phase 3D � RuntimeStore Persistence Integration", () => {
  let tmpDir: string;
  let runtimeStore: RuntimeStore;

  beforeEach(() => {
    tmpDir = createTempDir();
    runtimeStore = new RuntimeStore({
      projectRoot: tmpDir,
      emitter: null,
    });
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it("isPersistenceEnabled returns true when persistence configured", () => {
    assert.equal(runtimeStore.isPersistenceEnabled(), true);
  });

  it("getPersistence returns the persistence adapter", () => {
    const persistence = runtimeStore.getPersistence();
    assert.ok(persistence !== null);
  });

  it("persistence adapter is FilesystemMissionPersistence", () => {
    const persistence = runtimeStore.getPersistence();
    assert.equal(persistence?.constructor.name, "FilesystemMissionPersistence");
  });

  it("setMission persists mission", async () => {
    const mission = createTestMission();
    await runtimeStore.setMission(mission);
    
    // Verify file exists
    const missionPath = path.join(
      tmpDir,
      ".litt",
      `${mission.id}.json`
    );
    assert.ok(fs.existsSync(missionPath));
  });

  it("updateMissionStatus persists change", async () => {
    const mission = createTestMission();
    await runtimeStore.setMission(mission);
    await runtimeStore.updateMissionStatus(mission.id, "working");
    
    const loaded = runtimeStore.getState().mission;
    assert.equal(loaded?.status, "working");
  });

  it("clearMission deletes mission from persistence", async () => {
    const mission = createTestMission();
    await runtimeStore.setMission(mission);
    
    const missionPath = path.join(
      tmpDir,
      ".litt",
      `${mission.id}.json`
    );
    assert.ok(fs.existsSync(missionPath));
    
    await runtimeStore.clearMission(mission.id);
    
    assert.equal(runtimeStore.getState().mission, null);
    assert.ok(!fs.existsSync(missionPath));
  });
});

// --- Atomic Write and Backup Tests -----------------------------------

describe("Phase 3D � Atomic Write and Backup", () => {
  let tmpDir: string;
  let store: MissionStore;

  beforeEach(() => {
    tmpDir = createTempDir();
    store = createMissionStore(tmpDir);
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it("creates atomic write with temp file", () => {
    const mission = createTestMission();
    store.updateMission(mission);
    
    const missionsDir = path.join(tmpDir, ".litt");
    
    // No .tmp file should remain after successful write
    const tmpFiles = fs.readdirSync(missionsDir).filter(f => f.endsWith('.tmp'));
    assert.equal(tmpFiles.length, 0);
  });

  it("creates backup file on subsequent saves", () => {
    const mission = createTestMission();
    store.updateMission(mission);
    // Second save creates the backup per the backup contract
    store.updateMission(mission);
    
    const backupPath = path.join(tmpDir, ".litt", `${mission.id}.json.backup`);
    assert.ok(fs.existsSync(backupPath));
  });
});

// --- Open Mission IDs for Recovery -------------------------------------

describe("Phase 3D � Open Mission IDs Recovery", () => {
  let tmpDir: string;
  let store: MissionStore;

  beforeEach(() => {
    tmpDir = createTempDir();
    store = createMissionStore(tmpDir);
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it("getOpenMissionIds returns non-terminal missions", () => {
    const planningM = store.createMission({
      goal: "Planning",
      mode: "plan",
      sessionId: null,
      workspaceId: null,
      projectRoot: tmpDir,
    });
    
    const workingM = store.createMission({
      goal: "Working",
      mode: "auto",
      sessionId: null,
      workspaceId: null,
      projectRoot: tmpDir,
    });
    workingM.status = "working";
    store.updateMission(workingM);
    
    const completedM = store.createMission({
      goal: "Completed",
      mode: "auto",
      sessionId: null,
      workspaceId: null,
      projectRoot: tmpDir,
    });
    completedM.status = "complete";
    store.updateMission(completedM);

    const openIds = store.getOpenMissionIds();
    
    assert.ok(openIds.includes(planningM.id));
    assert.ok(openIds.includes(workingM.id));
    assert.ok(!openIds.includes(completedM.id));
  });
});
