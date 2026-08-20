/**
 * MissionVerificationGate — read-only (inspection) mission verification.
 *
 * First-run acceptance failure #4: the inspection mission stayed RUNNING
 * forever. Root cause: the full VerificationGate (typecheck/test/build)
 * was run for a read-only inspection, taking minutes with no UI state
 * change. This gate proves read-only missions by their EVIDENCE — fast
 * and honest — and only runs the full gate when the mission mutated.
 */

import { describe, it, expect } from "vitest";
import { RuntimeStore } from "@litt/agent-core";
import type { VerificationGateLike, VerificationResult } from "@litt/agent-core";
import {
  MissionVerificationGate,
  createMissionEvidenceTracker,
  isShipCommitAllowed,
  markInspectionStepsComplete,
} from "../lib/mission-verification.js";

function makeFullGate(result?: Partial<VerificationResult>): VerificationGateLike & { called: () => number } {
  let calls = 0;
  return {
    called: () => calls,
    async verify(): Promise<VerificationResult> {
      calls++;
      return {
        proven: true,
        status: "proven",
        checks: [],
        totalDurationMs: 0,
        message: "full gate ran",
        runId: "full_gate",
        ranChecks: [],
        skippedChecks: [],
        ...result,
      };
    },
  };
}

describe("createMissionEvidenceTracker", () => {
  const MUTATION = new Set(["project.edit_file", "project.write_file", "project.run"]);

  it("starts read-only with no evidence", () => {
    const tracker = createMissionEvidenceTracker(MUTATION);
    expect(tracker.isReadOnly()).toBe(true);
    expect(tracker.hasSuccessfulEvidence()).toBe(false);
    expect(tracker.summary()).toContain("no tool evidence");
  });

  it("read-only tools do not mark the mission as mutating", () => {
    const tracker = createMissionEvidenceTracker(MUTATION);
    tracker.recordToolCall("project.status");
    tracker.recordToolResult("project.status", true, "clean");
    expect(tracker.isReadOnly()).toBe(true);
    expect(tracker.hasSuccessfulEvidence()).toBe(true);
  });

  it("a mutation tool marks the mission as mutating", () => {
    const tracker = createMissionEvidenceTracker(MUTATION);
    tracker.recordToolCall("project.edit_file");
    expect(tracker.isReadOnly()).toBe(false);
  });

  it("a failed tool never counts as evidence", () => {
    const tracker = createMissionEvidenceTracker(MUTATION);
    tracker.recordToolResult("project.status", false, "git status failed");
    expect(tracker.hasSuccessfulEvidence()).toBe(false);
    expect(tracker.summary()).toContain("failed");
  });
});

describe("MissionVerificationGate", () => {
  it("read-only + successful evidence → proven (no full gate)", async () => {
    const fullGate = makeFullGate();
    const store = new RuntimeStore(() => {});
    const gate = new MissionVerificationGate({
      fullGate,
      store,
      isReadOnly: () => true,
      hasSuccessfulEvidence: () => true,
      evidenceSummary: () => "project.status: ok",
    });

    const result = await gate.verify();

    expect(result.proven).toBe(true);
    expect(result.status).toBe("proven");
    expect(result.checks[0].id).toBe("evidence");
    expect(result.message).toContain("verified");
    expect(fullGate.called()).toBe(0);
    expect(store.getState().phase).toBe("complete");
  });

  it("read-only + no evidence → NOT proven (no full gate)", async () => {
    const fullGate = makeFullGate();
    const store = new RuntimeStore(() => {});
    const gate = new MissionVerificationGate({
      fullGate,
      store,
      isReadOnly: () => true,
      hasSuccessfulEvidence: () => false,
      evidenceSummary: () => "no tool evidence collected",
    });

    const result = await gate.verify();

    expect(result.proven).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("could not be verified");
    expect(fullGate.called()).toBe(0);
    expect(store.getState().phase).toBe("failed");
  });

  it("mutating mission delegates to the full gate", async () => {
    const fullGate = makeFullGate();
    const store = new RuntimeStore(() => {});
    const gate = new MissionVerificationGate({
      fullGate,
      store,
      isReadOnly: () => false,
      hasSuccessfulEvidence: () => false,
      evidenceSummary: () => "irrelevant",
    });

    const result = await gate.verify();

    expect(fullGate.called()).toBe(1);
    expect(result.message).toBe("full gate ran");
  });

  it("end-to-end: inspection mission with a successful status tool is proven", async () => {
    // Simulates the controller wiring: the tracker is fed from
    // agent_tool_call / agent_tool_result, then the gate decides.
    const fullGate = makeFullGate();
    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
    tracker.recordToolCall("project.status");
    tracker.recordToolResult("project.status", true, "litlabs-website on feat/x — clean");

    const gate = new MissionVerificationGate({
      fullGate,
      store: new RuntimeStore(() => {}),
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      evidenceSummary: tracker.summary,
    });

    const result = await gate.verify();
    expect(result.proven).toBe(true);
    expect(fullGate.called()).toBe(0);
  });

  it("read-only inspection mission reaches canonical status complete", async () => {
    // Mirrors the controller flow: mission created → plan steps added →
    // one step started (planning → working) → evidence gate proves →
    // markInspectionStepsComplete → completeMission succeeds.
    const store = new RuntimeStore(() => {});
    await store.createMission({
      goal: "Inspect this repository",
      mode: "act",
      projectRoot: process.cwd(),
      sessionId: null,
      workspaceId: null,
      metadata: {},
    });
    await store.addMissionStep({ title: "Inspect repository metadata", requiredEvidence: ["repository_status"] });
    await store.addMissionStep({ title: "Report current status", requiredEvidence: [] });
    await store.addMissionStep({ title: "Verify inspection completeness", requiredEvidence: [] });
    const mission0 = store.getMission();
    await store.setCurrentStep(mission0!.steps[0].id); // planning → working

    const fullGate = makeFullGate();
    const gate = new MissionVerificationGate({
      fullGate,
      store,
      isReadOnly: () => true,
      hasSuccessfulEvidence: () => true,
      evidenceSummary: () => "project.status: ok",
    });
    const verification = await gate.verify();
    expect(verification.proven).toBe(true);

    await markInspectionStepsComplete(store, "Inspection verified");
    await store.setMissionVerifying();
    await store.completeMission("Verified by evidence gate", verification.message);

    const mission = store.getMission();
    expect(mission?.status).toBe("complete");
    for (const step of mission?.steps ?? []) {
      expect(step.status).toBe("passed");
    }
  });

  it("emits canonical verification lifecycle events (event-bus parity)", async () => {
    const events: string[] = [];
    const gate = new MissionVerificationGate({
      fullGate: makeFullGate(),
      emitter: (event) => {
        if (event.type === "litt_event") events.push(event.subtype ?? "");
      },
      isReadOnly: () => true,
      hasSuccessfulEvidence: () => true,
      evidenceSummary: () => "project.status: ok",
    });

    await gate.verify();

    expect(events).toContain("verification_start");
    expect(events).toContain("verification_check_start");
    expect(events).toContain("verification_check_result");
    expect(events).toContain("verification_result");
  });

  it("emits no events for mutating missions (full gate owns the bus)", async () => {
    const fullGate = makeFullGate();
    const events: string[] = [];
    const gate = new MissionVerificationGate({
      fullGate,
      emitter: (event) => {
        if (event.type === "litt_event") events.push(event.subtype ?? "");
      },
      isReadOnly: () => false,
      hasSuccessfulEvidence: () => true,
      evidenceSummary: () => "irrelevant",
    });

    await gate.verify();
    expect(fullGate.called()).toBe(1);
    expect(events).toEqual([]);
  });

  it("markInspectionStepsComplete recovers a failed step so the mission can complete", async () => {
    const store = new RuntimeStore(() => {});
    await store.createMission({
      goal: "Inspect this repository",
      mode: "act",
      projectRoot: process.cwd(),
      sessionId: null,
      workspaceId: null,
      metadata: {},
    });
    await store.addMissionStep({ title: "Inspect repository metadata", requiredEvidence: ["repository_status"] });
    await store.addMissionStep({ title: "Report current status", requiredEvidence: [] });
    const m0 = store.getMission();
    await store.setCurrentStep(m0!.steps[0].id); // planning → working

    // A read-only tool attempt fails → the controller marks the step failed.
    await store.updateMissionStepStatus(m0!.steps[0].id, "failed", {
      failureReason: "git status failed: inspection tool unavailable",
      verificationPassed: false,
    });

    // The gate proves via other evidence, then steps are recovered.
    const fullGate = makeFullGate();
    const gate = new MissionVerificationGate({
      fullGate,
      store,
      isReadOnly: () => true,
      hasSuccessfulEvidence: () => true,
      evidenceSummary: () => "project.list_files: ok",
    });
    const verification = await gate.verify();
    expect(verification.proven).toBe(true);

    await markInspectionStepsComplete(store, "Inspection verified");
    await store.setMissionVerifying();
    await store.completeMission("Verified by evidence gate", verification.message);

    const mission = store.getMission();
    expect(mission?.status).toBe("complete");
    for (const step of mission?.steps ?? []) {
      expect(step.status).toBe("passed");
    }
  });

  it("bounds the evidence tracker history (memory safety)", () => {
    const tracker = createMissionEvidenceTracker(new Set(["project.run"]));
    for (let i = 0; i < 500; i++) {
      tracker.recordToolResult("project.status", i % 2 === 0, `result ${i}`);
    }
    // The history is capped at 200 entries — the summary cannot grow
    // unbounded with the mission, and success detection still works.
    expect(tracker.hasSuccessfulEvidence()).toBe(true);
    expect(tracker.summary().length).toBeLessThan(200 * 40);
    expect(tracker.summary()).toContain("ok");
    expect(tracker.summary()).toContain("failed");
  });

  it("respects the VerificationGateLike contract (typed verify)", async () => {
    const fullGate = makeFullGate();
    const gate: VerificationGateLike = new MissionVerificationGate({
      fullGate,
      isReadOnly: () => true,
      hasSuccessfulEvidence: () => true,
      evidenceSummary: () => "ok",
    });
    // Verifies the loop can consume it as a VerificationGate.
    await expect(gate.verify()).resolves.toMatchObject({ proven: true });
  });
});

describe("isShipCommitAllowed (the /ship commit gate)", () => {
  const proven: VerificationResult = {
    proven: true,
    status: "proven",
    checks: [],
    totalDurationMs: 0,
    message: "proven",
    runId: "r1",
    ranChecks: [],
    skippedChecks: [],
  };

  it("rejects when no verification ever ran (missing gate)", () => {
    expect(isShipCommitAllowed(null)).toBe(false);
  });

  it("rejects when the last verification failed", () => {
    expect(isShipCommitAllowed({ ...proven, proven: false, status: "failed" })).toBe(false);
  });

  it("allows commit only when the last verification proven the work", () => {
    expect(isShipCommitAllowed(proven)).toBe(true);
  });

  it("a later failed verification revokes the commit right", () => {
    expect(isShipCommitAllowed(proven)).toBe(true);
    expect(isShipCommitAllowed({ ...proven, proven: false, status: "failed" })).toBe(false);
  });
});
