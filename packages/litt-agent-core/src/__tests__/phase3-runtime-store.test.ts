/**
 * Phase 3 — RuntimeStore Mission State Tests
 *
 * Verifies that RuntimeStore correctly manages mission state:
 *   - setMission creates mission and emits mission:created event
 *   - updateMissionStatus transitions state and emits events
 *   - setMission status transitions work correctly
 *   - clearMission resets state and clears mission
 *   - Mission state persists through toJSON/getState
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RuntimeStore,
  createInitialState,
  type Mission,
  type RuntimeEvent,
} from "../index.js";

const CREATE_MISSION_DATE = new Date("2026-08-16T10:00:00.000Z").toISOString();

function createTestMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mission_test_123456",
    version: "1.0.0",
    goal: "Test mission for autopilot",
    normalizedGoal: "test-mission",
    projectRoot: "/workspace/test",
    workspaceId: "workspace_123",
    sessionId: "session_123",
    mode: "auto",
    status: "planning",
    createdAt: CREATE_MISSION_DATE,
    updatedAt: CREATE_MISSION_DATE,
    startedAt: null,
    completedAt: null,
    currentStepId: null,
    steps: [],
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

describe("Phase 3 — RuntimeStore Mission State", () => {
  describe("createInitialState has mission fields", () => {
    it("mission field is null", () => {
      const state = createInitialState();
      assert.equal(state.mission, null);
    });

    it("lastMissionHeartbeatAt is 0", () => {
      const state = createInitialState();
      assert.equal(state.lastMissionHeartbeatAt, 0);
    });

    it("missionStepsCompleted is 0", () => {
      const state = createInitialState();
      assert.equal(state.missionStepsCompleted, 0);
    });
  });

  describe("setMission", () => {
    it("sets mission and emits mission:created event on first mission", () => {
      const events: RuntimeEvent[] = [];
      const store = new RuntimeStore((e) => events.push(e));

      const mission = createTestMission();
      store.setMission(mission);

      assert.equal(store.getState().mission?.id, "mission_test_123456");
      const createdEvent = events.find((e) => e.subtype === "mission:created");
      assert.ok(createdEvent, "should emit mission:created event");
      assert.equal(createdEvent?.data.missionId, "mission_test_123456");
      assert.equal(createdEvent?.data.mode, "auto");
    });

    it("emits mission:working when status updated via updateMissionStatus", () => {
      const events: RuntimeEvent[] = [];
      const store = new RuntimeStore((e) => events.push(e));

      const mission = createTestMission({ status: "planning" });
      store.setMission(mission);

      // Update status to working
      store.updateMissionStatus("mission_test_123456", "working");

      const workingEvent = events.find((e) => e.subtype === "mission:working");
      assert.ok(workingEvent, "should emit mission:working event after status update");
    });

    it("does not emit mission:started if status is planning", () => {
      const events: RuntimeEvent[] = [];
      const store = new RuntimeStore((e) => events.push(e));

      const mission = createTestMission({ status: "planning" });
      store.setMission(mission);

      const startedEvent = events.find((e) => e.subtype === "mission:started");
      assert.equal(startedEvent, undefined, "should NOT emit mission:started when status is planning");
    });

    it("updates lastMissionHeartbeatAt", () => {
      const store = new RuntimeStore();
      const before = Date.now();

      store.setMission(createTestMission());

      const after = Date.now();
      assert.ok(store.getState().lastMissionHeartbeatAt >= before);
      assert.ok(store.getState().lastMissionHeartbeatAt <= after);
    });
  });

  describe("updateMissionStatus", () => {
    it("updates mission status", () => {
      const store = new RuntimeStore();
      store.setMission(createTestMission({ status: "planning" }));

      store.updateMissionStatus("mission_test_123456", "working");

      assert.equal(store.getState().mission?.status, "working");
    });

    it("emits mission:status event", () => {
      const events: RuntimeEvent[] = [];
      const store = new RuntimeStore((e) => events.push(e));
      store.setMission(createTestMission());

      store.updateMissionStatus("mission_test_123456", "working");

      const statusEvent = events.find((e) => e.type === "litt_event" && e.subtype === "mission:working");
      assert.ok(statusEvent, "should emit mission:working event");
    });

    it("does not emit event if status unchanged", () => {
      const events: RuntimeEvent[] = [];
      const store = new RuntimeStore((e) => events.push(e));
      store.setMission(createTestMission({ status: "working" }));

      store.updateMissionStatus("mission_test_123456", "working");

      const workingEvents = events.filter((e) => e.subtype === "mission:working");
      assert.equal(workingEvents.length, 0, "should not emit duplicate mission:working event");
    });

    it("returns silently if mission ID mismatched", () => {
      const store = new RuntimeStore();
      store.setMission(createTestMission());

      store.updateMissionStatus("different_mission", "working");

      assert.equal(store.getState().mission?.status, "planning");
    });
  });

  describe("incrementMissionStepsCompleted", () => {
    it("increments step count", () => {
      const store = new RuntimeStore();
      store.setMission(createTestMission());

      assert.equal(store.getState().missionStepsCompleted, 0);

      store.incrementMissionStepsCompleted();
      assert.equal(store.getState().missionStepsCompleted, 1);

      store.incrementMissionStepsCompleted();
      assert.equal(store.getState().missionStepsCompleted, 2);
    });
  });

  describe("emitMissionHeartbeat", () => {
    it("emits mission:heartbeat event", () => {
      const events: RuntimeEvent[] = [];
      const store = new RuntimeStore((e) => events.push(e));
      store.setMission(createTestMission());

      store.emitMissionHeartbeat();

      const hbEvent = events.find((e) => e.subtype === "mission:heartbeat");
      assert.ok(hbEvent, "should emit mission:heartbeat event");
      assert.equal(hbEvent?.data.missionId, "mission_test_123456");
    });

    it("does not emit if no mission", () => {
      const events: RuntimeEvent[] = [];
      const store = new RuntimeStore((e) => events.push(e));

      store.emitMissionHeartbeat();

      const hbEvent = events.find((e) => e.subtype === "mission:heartbeat");
      assert.equal(hbEvent, undefined, "should not emit mission:heartbeat when no mission");
    });

    it("updates lastMissionHeartbeatAt", () => {
      const store = new RuntimeStore();
      store.setMission(createTestMission());

      const before = store.getState().lastMissionHeartbeatAt;
      store.emitMissionHeartbeat();
      const after = store.getState().lastMissionHeartbeatAt;

      assert.ok(after >= before);
    });
  });

  describe("clearMission", () => {
    it("clears mission state", () => {
      const store = new RuntimeStore();
      store.setMission(createTestMission());
      assert.ok(store.getState().mission !== null);

      store.clearMission("mission_test_123456");

      assert.equal(store.getState().mission, null);
      assert.equal(store.getState().lastMissionHeartbeatAt, 0);
      assert.equal(store.getState().missionStepsCompleted, 0);
    });

    it("does not clear wrong mission", () => {
      const store = new RuntimeStore();
      store.setMission(createTestMission());

      store.clearMission("wrong_mission_id");

      assert.ok(store.getState().mission !== null);
    });
  });

  describe("getState serialization", () => {
    it("includes mission in state", () => {
      const store = new RuntimeStore();
      store.setMission(createTestMission());

      const state = store.getState();

      assert.ok(state.mission !== null);
      assert.equal(state.mission?.id, "mission_test_123456");
      assert.equal(state.lastMissionHeartbeatAt, state.mission?.lastHeartbeatAt);
    });

    it("toJSON includes mission", () => {
      const store = new RuntimeStore();
      store.setMission(createTestMission());

      const json = store.toJSON();
      const parsed = JSON.parse(json);

      assert.ok(parsed.mission !== null);
      assert.equal(parsed.mission.id, "mission_test_123456");
    });
  });
});