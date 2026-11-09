/**
 * P0 regression — read-only verifier truth + mission finalization.
 */
import { describe, it, expect } from "vitest";
import {
  MissionVerificationGate,
  createMissionEvidenceTracker,
  isSynthesisStep,
  uncoveredMissionSteps,
} from "../lib/mission-verification.js";
import { finalizeMissionRun } from "../lib/mission-finalize.js";
import { RuntimeStore } from "@litt/agent-core";
import type { VerificationResult } from "@litt/agent-core";

const MUTATING = new Set(["project.edit_file", "project.write_file", "project.run"]);

function baseResult(over: Partial<VerificationResult>): VerificationResult {
  return {
    proven: false, status: "failed", checks: [], totalDurationMs: 1,
    message: "", runId: "r", ranChecks: [], skippedChecks: [], ...over,
  };
}

function makeGate(tracker: ReturnType<typeof createMissionEvidenceTracker>, store: RuntimeStore) {
  return new MissionVerificationGate({
    fullGate: { verify: async () => baseResult({ message: "full gate" }) },
    store,
    isReadOnly: tracker.isReadOnly,
    hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
    hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
    hasFailedEvidence: tracker.hasFailedEvidence,
    evidenceTypeState: tracker.evidenceTypeState,
    uncoveredStepTitles: () => uncoveredMissionSteps(store.getMission()),
    evidenceSummary: tracker.summary,
    failedSummary: tracker.failedSummary,
  });
}

describe("read-only evidence gate", () => {
  it("proves when investigation steps have evidence and report is synthesis", async () => {
    const store = new RuntimeStore({});
    const mission = await store.createMission({ goal: "inspect", mode: "act", projectRoot: "/tmp/x" });
    const s1 = await store.addMissionStep({ title: "Inspect repository baseline", allowedActionScope: ["inspect"] });
    await store.addMissionStep({ title: "Report findings and recommendations", allowedActionScope: ["report"] });
    const tracker = createMissionEvidenceTracker(MUTATING);
    tracker.recordToolCall("project.status", {});
    tracker.recordToolResult("project.status", true, "ok", s1?.id);
    await store.addMissionEvidence({ stepId: s1?.id ?? null, type: "repository_status", source: "project.status", summary: "ok", success: true, metadata: {} });
    const result = await makeGate(tracker, store).verify();
    expect(result.proven).toBe(true);
    expect(mission).toBeTruthy();
  });

  it("mission E replay: only project.status + narration → uncovered steps, not proven", async () => {
    const store = new RuntimeStore({});
    await store.createMission({ goal: "audit", mode: "act", projectRoot: "/tmp/x" });
    const s1 = await store.addMissionStep({ title: "Inspect CLI architecture and model routing", allowedActionScope: ["inspect"] });
    await store.addMissionStep({ title: "Analyze Ollama response times", allowedActionScope: ["investigate"] });
    await store.addMissionStep({ title: "Report optimizations", allowedActionScope: ["report"] });
    const tracker = createMissionEvidenceTracker(MUTATING);
    tracker.recordToolCall("project.status", {});
    tracker.recordToolResult("project.status", true, "ok", s1?.id);
    await store.addMissionEvidence({ stepId: s1?.id ?? null, type: "repository_status", source: "project.status", summary: "ok", success: true, metadata: {} });
    const result = await makeGate(tracker, store).verify();
    expect(result.proven).toBe(false);
    expect(result.uncoveredSteps).toEqual(["Analyze Ollama response times"]);
    expect(result.message).toContain("Steps without evidence");
  });

  it("successful project.check produces typecheck_result", async () => {
    const store = new RuntimeStore({});
    await store.createMission({ goal: "check", mode: "act", projectRoot: "/tmp/x" });
    const s1 = await store.addMissionStep({ title: "Typecheck", allowedActionScope: ["check"], requiredEvidence: ["typecheck_result"] });
    const tracker = createMissionEvidenceTracker(MUTATING);
    tracker.recordToolCall("project.check", {});
    tracker.recordToolResult("project.check", true, "0 errors", s1?.id);
    await store.addMissionEvidence({ stepId: s1?.id ?? null, type: "typecheck_result", source: "project.check", summary: "0 errors", success: true, metadata: {} });
    const result = await makeGate(tracker, store).verify();
    expect(result.proven).toBe(true);
  });

  it("failed typecheck evidence → failedEvidence + 'Required check failed'", async () => {
    const store = new RuntimeStore({});
    await store.createMission({ goal: "check", mode: "act", projectRoot: "/tmp/x" });
    const s1 = await store.addMissionStep({ title: "Typecheck", allowedActionScope: ["check"], requiredEvidence: ["typecheck_result"] });
    const tracker = createMissionEvidenceTracker(MUTATING);
    tracker.recordToolCall("project.check", {});
    tracker.recordToolResult("project.check", false, "3 errors", s1?.id);
    await store.addMissionEvidence({ stepId: s1?.id ?? null, type: "typecheck_result", source: "project.check", summary: "3 errors", success: false, metadata: {} });
    const result = await makeGate(tracker, store).verify();
    expect(result.proven).toBe(false);
    expect(result.failedEvidence).toEqual(["typecheck_result"]);
    expect(result.message).toContain("Required check failed: typecheck_result");
  });

  it("never-attempted required evidence → missingEvidence", async () => {
    const store = new RuntimeStore({});
    await store.createMission({ goal: "check", mode: "act", projectRoot: "/tmp/x" });
    await store.addMissionStep({ title: "Typecheck", allowedActionScope: ["check"], requiredEvidence: ["typecheck_result"] });
    const tracker = createMissionEvidenceTracker(MUTATING);
    tracker.recordToolCall("project.status", {});
    tracker.recordToolResult("project.status", true, "ok", null);
    const result = await makeGate(tracker, store).verify();
    expect(result.proven).toBe(false);
    expect(result.missingEvidence).toEqual(["typecheck_result"]);
    expect(result.message).toContain("Missing required evidence: typecheck_result");
  });

  it("unrecovered objective failure blocks proven; recovered failure does not", async () => {
    const store = new RuntimeStore({});
    await store.createMission({ goal: "inspect", mode: "act", projectRoot: "/tmp/x" });
    const tracker = createMissionEvidenceTracker(MUTATING);
    tracker.recordToolCall("project.read_file", { path: "a" });
    tracker.recordToolResult("project.read_file", false, "nope", null);
    tracker.recordToolCall("project.status", {});
    tracker.recordToolResult("project.status", true, "ok", null);
    let result = await makeGate(tracker, store).verify();
    expect(result.proven).toBe(false);

    // same tool fails then succeeds → recovered
    const tracker2 = createMissionEvidenceTracker(MUTATING);
    tracker2.recordToolCall("project.read_file", { path: "a" });
    tracker2.recordToolResult("project.read_file", false, "nope", null);
    tracker2.recordToolCall("project.read_file", { path: "a" });
    tracker2.recordToolResult("project.read_file", true, "ok", null);
    result = await makeGate(tracker2, store).verify();
    expect(result.proven).toBe(true);
  });

  it("health-requested mission with declared check evidence uses the evidence gate, not the full gate", async () => {
    const store = new RuntimeStore({});
    await store.createMission({ goal: "Run an authorized typecheck and report the result", mode: "act", projectRoot: "/tmp/x" });
    const s1 = await store.addMissionStep({ title: "Run typecheck", allowedActionScope: ["check"], requiredEvidence: ["typecheck_result"] });
    const tracker = createMissionEvidenceTracker(MUTATING);
    tracker.recordToolCall("project.check", {});
    tracker.recordToolResult("project.check", true, "0 errors", s1?.id);
    await store.addMissionEvidence({ stepId: s1?.id ?? null, type: "typecheck_result", source: "project.check", summary: "0 errors", success: true, metadata: {} });
    let fullGateCalls = 0;
    const gate = new MissionVerificationGate({
      fullGate: { verify: async () => { fullGateCalls++; return baseResult({ message: "full gate ran" }); } },
      store,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceTypeState: tracker.evidenceTypeState,
      uncoveredStepTitles: () => uncoveredMissionSteps(store.getMission()),
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
      healthRequested: () => true, // the user asked to run a check
    });
    const result = await gate.verify();
    expect(fullGateCalls).toBe(0);
    expect(result.proven).toBe(true);
  });

  it("health-requested mission with a failing check reports the record's own message", async () => {
    const store = new RuntimeStore({});
    await store.createMission({ goal: "Run the typecheck", mode: "act", projectRoot: "/tmp/x" });
    const s1 = await store.addMissionStep({ title: "Run typecheck", allowedActionScope: ["check"], requiredEvidence: ["typecheck_result"] });
    const tracker = createMissionEvidenceTracker(MUTATING);
    tracker.recordToolCall("project.check", {});
    tracker.recordToolResult("project.check", false, "error TS2322: type mismatch", s1?.id);
    const result = await makeGate(tracker, store).verify();
    expect(result.proven).toBe(false);
    expect(result.message).toContain("Required check failed: typecheck_result — project.check: error TS2322");
  });

  it("verification_result is ignored as a step contract", async () => {
    const store = new RuntimeStore({});
    await store.createMission({ goal: "inspect", mode: "act", projectRoot: "/tmp/x" });
    const s1 = await store.addMissionStep({ title: "Inspect", allowedActionScope: ["inspect"] });
    await store.addMissionStep({ title: "Verify", allowedActionScope: ["verify"], requiredEvidence: ["verification_result"] });
    const tracker = createMissionEvidenceTracker(MUTATING);
    tracker.recordToolCall("project.status", {});
    tracker.recordToolResult("project.status", true, "ok", s1?.id);
    await store.addMissionEvidence({ stepId: s1?.id ?? null, type: "repository_status", source: "project.status", summary: "ok", success: true, metadata: {} });
    const result = await makeGate(tracker, store).verify();
    expect(result.proven).toBe(true);
  });
});

describe("synthesis-step coverage", () => {
  it("report/verify steps are exempt; investigation steps are not", () => {
    expect(isSynthesisStep({ title: "Report findings", allowedActionScope: ["report"] })).toBe(true);
    expect(isSynthesisStep({ title: "Verify the result", allowedActionScope: [] })).toBe(true);
    expect(isSynthesisStep({ title: "Investigate failures", allowedActionScope: ["investigate"] })).toBe(false);
    const uncovered = uncoveredMissionSteps({
      steps: [
        { id: "a", title: "Inspect baseline", allowedActionScope: ["inspect"] },
        { id: "b", title: "Report findings", allowedActionScope: ["report"] },
      ],
      evidence: [{ stepId: "a", success: true }],
    });
    expect(uncovered).toEqual([]);
  });
});

describe("finalizeMissionRun", () => {
  it("cancelled termination → mission cancelled, verification not judged", async () => {
    const store = new RuntimeStore({});
    await store.createMission({ goal: "x", mode: "act", projectRoot: "/tmp/x" });
    const out = await finalizeMissionRun({
      store,
      termination: "cancelled",
      verification: baseResult({ proven: true, status: "proven", message: "fake proven" }),
      readOnly: true,
    });
    expect(out.outcome).toBe("cancelled");
    expect(store.getMission()?.status).toBe("cancelled");
  });

  it("unproven → working steps failed, pending left pending, mission failed", async () => {
    const store = new RuntimeStore({});
    await store.createMission({ goal: "x", mode: "act", projectRoot: "/tmp/x" });
    const s1 = await store.addMissionStep({ title: "Work", allowedActionScope: ["investigate"] });
    await store.addMissionStep({ title: "Later", allowedActionScope: ["report"] });
    if (s1) await store.updateMissionStepStatus(s1.id, "working").catch(() => {});
    const out = await finalizeMissionRun({
      store,
      termination: "verification_failed",
      verification: baseResult({ message: "Missing required evidence: typecheck_result" }),
      readOnly: true,
    });
    expect(out.outcome).toBe("failed");
    const mission = store.getMission();
    expect(mission?.status).toBe("failed");
    expect(mission?.steps.find((s) => s.id === s1?.id)?.status).toBe("failed");
    expect(mission?.steps.filter((s) => s.status === "pending").length).toBeGreaterThan(0);
  });

  it("never marks a step passed without evidence on the failed path", async () => {
    const store = new RuntimeStore({});
    await store.createMission({ goal: "x", mode: "act", projectRoot: "/tmp/x" });
    const s1 = await store.addMissionStep({ title: "Work", allowedActionScope: ["investigate"] });
    if (s1) await store.updateMissionStepStatus(s1.id, "working").catch(() => {});
    await finalizeMissionRun({ store, termination: "max_rounds", verification: null, readOnly: true });
    expect(store.getMission()?.steps.every((s) => s.status !== "passed")).toBe(true);
  });
});
