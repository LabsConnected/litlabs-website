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
import {
  RuntimeStore,
  normalizeSemanticPlan,
} from "@litt/agent-core";
import type { VerificationGateLike, VerificationResult } from "@litt/agent-core";
import {
  MissionVerificationGate,
  createMissionEvidenceTracker,
  isShipCommitAllowed,
  markInspectionStepsComplete,
  requiresProjectHealth,
  isHealthCheckTool,
  isMutatingToolCall,
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
    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
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
      hasFailedEvidence: () => false,
      failedSummary: () => "",
    });

    const result = await gate.verify();

    expect(result.proven).toBe(true);
    expect(result.status).toBe("proven");
    expect(result.checks[0].id).toBe("evidence");
    expect(result.message).toContain("Evidence collected");
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
      hasFailedEvidence: () => false,
      failedSummary: () => "",
    });

    const result = await gate.verify();

    expect(result.proven).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("No successful tool evidence");
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
      hasFailedEvidence: () => false,
      failedSummary: () => "",
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
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
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

    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
    tracker.recordToolCall("project.status");
    tracker.recordToolResult(
      "project.status",
      true,
      "project.status: ok",
      mission0!.steps[0].id,
    );

    const fullGate = makeFullGate();
    const gate = new MissionVerificationGate({
      fullGate,
      store,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      evidenceSummary: tracker.summary,
      hasFailedEvidence: tracker.hasFailedEvidence,
      failedSummary: tracker.failedSummary,
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
      hasFailedEvidence: () => false,
      failedSummary: () => "",
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
      hasFailedEvidence: () => false,
      failedSummary: () => "",
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
      hasFailedEvidence: () => false,
      failedSummary: () => "",
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
      hasFailedEvidence: () => false,
      failedSummary: () => "",
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

// ─── Verification scope ────────────────────────────────────────────
//
// Regression coverage for the verification-SCOPE defect.
//
// A live REMOTE mission asked only for repository facts (project, root,
// branch, HEAD, clean/dirty, remote, latest commit, HEAD vs origin/main)
// and proved every one of them through project.status/project.log/
// project.run evidence — yet the mission was marked FAILED because
// verification escalated to `pnpm run test`, which exited 1. The same
// ~2-minute command ran three times, pushing the mission to ~472s.
//
// Root cause: `project.run` was classified as a MUTATION tool by tool id.
// The inspection used project.run for six read-only git commands, which
// flipped isReadOnly() to false and routed verification to the full
// typecheck/test/build gate.

const MUTATION_TOOLS = new Set(["project.edit_file", "project.write_file", "project.run"]);

/** The six read-only git commands from the observed live mission. */
const INSPECTION_RUNS: { command: string; args: string[] }[] = [
  { command: "git", args: ["rev-parse", "HEAD"] },
  { command: "git", args: ["branch", "--show-current"] },
  { command: "git", args: ["remote", "-v"] },
  { command: "git", args: ["status", "--porcelain"] },
  { command: "git", args: ["rev-parse", "origin/main"] },
  { command: "git", args: ["log", "-1", "--format=%H"] },
];

describe("isMutatingToolCall", () => {
  it("does not treat read-only git commands through project.run as mutations", () => {
    for (const run of INSPECTION_RUNS) {
      expect(isMutatingToolCall("project.run", MUTATION_TOOLS, run)).toBe(false);
    }
  });

  it("still treats a genuinely mutating command as a mutation", () => {
    expect(
      isMutatingToolCall("project.run", MUTATION_TOOLS, { command: "git", args: ["commit", "-m", "x"] }),
    ).toBe(true);
    expect(
      isMutatingToolCall("project.run", MUTATION_TOOLS, { command: "rm", args: ["-rf", "src"] }),
    ).toBe(true);
  });

  it("file-writing tools remain mutations regardless of inputs", () => {
    expect(isMutatingToolCall("project.edit_file", MUTATION_TOOLS, { file: "a.ts" })).toBe(true);
    expect(isMutatingToolCall("project.write_file", MUTATION_TOOLS, { path: "a.ts" })).toBe(true);
  });

  it("falls back to the static set when inputs are unavailable (unknown = mutating)", () => {
    expect(isMutatingToolCall("project.run", MUTATION_TOOLS)).toBe(true);
    expect(isMutatingToolCall("project.run", MUTATION_TOOLS, { args: [] })).toBe(true);
  });

  it("read-only inspection tools are never mutations", () => {
    expect(isMutatingToolCall("project.status", MUTATION_TOOLS, {})).toBe(false);
    expect(isMutatingToolCall("project.log", MUTATION_TOOLS, {})).toBe(false);
  });
});

describe("requiresProjectHealth", () => {
  it("a read-only inspection request does NOT require the full suite", () => {
    for (const request of [
      "what branch am I on?",
      "tell me the project root, branch, HEAD and whether the tree is clean",
      "show me the remote and the latest commit",
      "does local HEAD match origin/main?",
      "git status please",
      "inspect the repository and report the current state",
    ]) {
      expect(requiresProjectHealth(request)).toBe(false);
    }
  });

  it("does not false-positive on 'latest' containing 'test'", () => {
    // Without word boundaries, "run ... latest commit" matches /test/.
    expect(requiresProjectHealth("run git log -1 to get the latest commit")).toBe(false);
  });

  it("an explicit health request DOES require the full suite", () => {
    for (const request of [
      "verify full project health",
      "run the tests",
      "do the tests pass?",
      "run a health check",
      "is the build green?",
      "verify the build",
      "does it compile cleanly?",
    ]) {
      expect(requiresProjectHealth(request)).toBe(true);
    }
  });

  it("handles empty/missing request text", () => {
    expect(requiresProjectHealth("")).toBe(false);
    expect(requiresProjectHealth(null)).toBe(false);
    expect(requiresProjectHealth(undefined)).toBe(false);
  });
});

describe("isHealthCheckTool", () => {
  it("classifies the dedicated health tools", () => {
    expect(isHealthCheckTool("project.test")).toBe(true);
    expect(isHealthCheckTool("project.build")).toBe(true);
    expect(isHealthCheckTool("project.typecheck")).toBe(true);
  });

  it("classifies health commands run through project.run", () => {
    expect(isHealthCheckTool("project.run", { command: "pnpm", args: ["run", "test"] })).toBe(true);
    expect(isHealthCheckTool("project.run", { command: "pnpm", args: ["test"] })).toBe(true);
    expect(isHealthCheckTool("project.run", { command: "npx", args: ["tsc", "--noEmit"] })).toBe(true);
  });

  it("does not classify git inspection as a health check", () => {
    for (const run of INSPECTION_RUNS) {
      expect(isHealthCheckTool("project.run", run)).toBe(false);
    }
    expect(isHealthCheckTool("project.status")).toBe(false);
  });
});

describe("verification scope — mission outcomes", () => {
  const inspectionTracker = () => {
    const t = createMissionEvidenceTracker(MUTATION_TOOLS);
    t.recordToolCall("project.status", {});
    t.recordToolResult("project.status", true, "on main, tree clean");
    for (const run of INSPECTION_RUNS) {
      t.recordToolCall("project.run", run);
      t.recordToolResult("project.run", true, "exit 0");
    }
    return t;
  };

  // ── A. Read-only Git inspection => PASS without pnpm test ──
  it("A. a read-only git inspection is proven by evidence and never runs the full gate", async () => {
    const tracker = inspectionTracker();
    expect(tracker.isReadOnly()).toBe(true);

    const fullGate = makeFullGate();
    const gate = new MissionVerificationGate({
      fullGate,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
      healthRequested: () => requiresProjectHealth("what branch am I on and is the tree clean?"),
      hasFailedHealthCheck: tracker.hasFailedHealthCheck,
      healthSummary: tracker.healthSummary,
    });

    const result = await gate.verify();
    expect(result.proven).toBe(true);
    expect(result.ranChecks).toEqual(["evidence"]);
    expect(fullGate.called()).toBe(0); // the whole point: no pnpm test
  });

  // ── B. Code modification => still requires the full gate ──
  it("B. a code-modification mission still requires full test/typecheck verification", async () => {
    const tracker = createMissionEvidenceTracker(MUTATION_TOOLS);
    tracker.recordToolCall("project.edit_file", { file: "src/a.ts" });
    tracker.recordToolResult("project.edit_file", true, "edited");
    expect(tracker.isReadOnly()).toBe(false);

    const fullGate = makeFullGate();
    const gate = new MissionVerificationGate({
      fullGate,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
      hasFailedHealthCheck: tracker.hasFailedHealthCheck,
      healthSummary: tracker.healthSummary,
    });

    await gate.verify();
    expect(fullGate.called()).toBe(1);
  });

  it("B2. a mutating shell command through project.run still requires the full gate", async () => {
    const tracker = createMissionEvidenceTracker(MUTATION_TOOLS);
    tracker.recordToolCall("project.run", { command: "git", args: ["commit", "-m", "wip"] });
    tracker.recordToolResult("project.run", true, "exit 0");
    expect(tracker.isReadOnly()).toBe(false);

    const fullGate = makeFullGate();
    const gate = new MissionVerificationGate({
      fullGate,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
    });
    await gate.verify();
    expect(fullGate.called()).toBe(1);
  });

  // ── C. Explicit health request => full suite may be required ──
  it("C. an explicit 'verify full project health' request runs the full gate", async () => {
    const tracker = inspectionTracker();
    expect(tracker.isReadOnly()).toBe(true);

    const fullGate = makeFullGate();
    const gate = new MissionVerificationGate({
      fullGate,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
      healthRequested: () => requiresProjectHealth("verify full project health"),
      hasFailedHealthCheck: tracker.hasFailedHealthCheck,
      healthSummary: tracker.healthSummary,
    });

    await gate.verify();
    expect(fullGate.called()).toBe(1);
  });

  // ── E. An optional health check failing does not invalidate ──
  it("E. a failed OPTIONAL health check does not invalidate a fully-proven inspection", async () => {
    const tracker = inspectionTracker();
    // The model volunteered the suite; nobody asked for it. It failed.
    tracker.recordToolCall("project.test", {});
    tracker.recordToolResult("project.test", false, "pnpm run test — exit 1");

    expect(tracker.hasFailedEvidence()).toBe(false); // not an objective
    expect(tracker.hasFailedHealthCheck()).toBe(true);

    const fullGate = makeFullGate();
    const gate = new MissionVerificationGate({
      fullGate,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
      healthRequested: () => false,
      hasFailedHealthCheck: tracker.hasFailedHealthCheck,
      healthSummary: tracker.healthSummary,
    });

    const result = await gate.verify();
    expect(result.proven).toBe(true);
    expect(fullGate.called()).toBe(0);
    // Requirement 7: report both facts, never conflate them.
    expect(result.message).toContain("REQUESTED TASK VERIFIED");
    expect(result.message).toContain("OPTIONAL PROJECT HEALTH CHECK FAILED");
    expect(result.message).toContain("exit 1");
  });

  it("a failed OBJECTIVE still blocks completion (no weakening)", async () => {
    const tracker = createMissionEvidenceTracker(MUTATION_TOOLS);
    tracker.recordToolCall("project.status", {});
    tracker.recordToolResult("project.status", true, "ok");
    tracker.recordToolCall("realtime.search", {});
    tracker.recordToolResult("realtime.search", false, "network unreachable");

    const gate = new MissionVerificationGate({
      fullGate: makeFullGate(),
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
      hasFailedHealthCheck: tracker.hasFailedHealthCheck,
      healthSummary: tracker.healthSummary,
    });

    const result = await gate.verify();
    expect(result.proven).toBe(false);
    expect(result.message).toContain("network unreachable");
  });

  it("a mutation invalidates cached verification evidence via onMutation", () => {
    let invalidations = 0;
    const tracker = createMissionEvidenceTracker(MUTATION_TOOLS, {
      onMutation: () => { invalidations += 1; },
    });
    tracker.recordToolCall("project.run", { command: "git", args: ["status"] });
    expect(invalidations).toBe(0);
    tracker.recordToolCall("project.edit_file", { file: "a.ts" });
    expect(invalidations).toBe(1);
    // Already mutated — no repeat notification.
    tracker.recordToolCall("project.write_file", { path: "b.ts" });
    expect(invalidations).toBe(1);
  });
});

// ── CASE A: MUST FAIL VERIFICATION
describe("CASE A: MUST FAIL VERIFICATION", () => {
  it("A. Run tests with empty requiredEvidence must NOT pass", async () => {
    const fullGate = makeFullGate();
    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
    // Record branch evidence (not test_result)
    tracker.recordToolCall("project.status");
    tracker.recordToolResult("project.status", true, "on main, tree clean");

    const gate = new MissionVerificationGate({
      fullGate,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
      stepRequiredEvidence: () => ["test_result"],
      hasFailedHealthCheck: tracker.hasFailedHealthCheck,
      healthSummary: tracker.healthSummary,
    });

    const result = await gate.verify();
    // Should NOT be proven because test_result evidence is missing
    expect(result.proven).toBe(false);
    expect(result.message).toContain("Missing required evidence");
    expect(fullGate.called()).toBe(0);
  });
});

// ── CASE B: MUST PASS
describe("CASE B: MUST PASS", () => {
  it("B. Run tests with test_result evidence should pass", async () => {
    const fullGate = makeFullGate();
    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
    // Record test_result evidence
    tracker.recordToolCall("project.test");
    tracker.recordToolResult("project.test", true, "All tests passed");

    const gate = new MissionVerificationGate({
      fullGate,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
      stepRequiredEvidence: () => ["test_result"],
      hasFailedHealthCheck: tracker.hasFailedHealthCheck,
      healthSummary: tracker.healthSummary,
    });

    const result = await gate.verify();
    // Should be proven because test_result evidence is present
    expect(result.proven).toBe(true);
    expect(fullGate.called()).toBe(0);
  });
});

// ── CASE C: INSPECTION STILL WORKS
describe("CASE C: INSPECTION STILL WORKS", () => {
  it("C. Branch inspection should pass without test evidence", async () => {
    const fullGate = makeFullGate();
    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
    // Record branch inspection evidence
    tracker.recordToolCall("project.status");
    tracker.recordToolResult("project.status", true, "on main, tree clean");

    const gate = new MissionVerificationGate({
      fullGate,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
      stepRequiredEvidence: () => [],  // No required evidence for inspection
      hasFailedHealthCheck: tracker.hasFailedHealthCheck,
      healthSummary: tracker.healthSummary,
    });

    const result = await gate.verify();
    // Branch inspection should still pass
    expect(result.proven).toBe(true);
    expect(fullGate.called()).toBe(0);
  });
});

// ── CASE D: WRONG EVIDENCE TYPE
describe("CASE D: WRONG EVIDENCE TYPE", () => {
  it("D. Typecheck with test_result evidence must NOT pass", async () => {
    const fullGate = makeFullGate();
    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
    // Record test_result evidence (wrong type for typecheck step)
    tracker.recordToolCall("project.test");
    tracker.recordToolResult("project.test", true, "All tests passed");

    const gate = new MissionVerificationGate({
      fullGate,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: tracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
      stepRequiredEvidence: () => ["typecheck_result"],  // typecheck requires typecheck_result
      hasFailedHealthCheck: tracker.hasFailedHealthCheck,
      healthSummary: tracker.healthSummary,
    });

    const result = await gate.verify();
    // Should NOT be proven because typecheck_result is missing
    expect(result.proven).toBe(false);
    expect(result.message).toContain("Missing required evidence");
  });
});

// ── CASE E: MODEL PLAN NORMALIZATION
describe("CASE E: MODEL PLAN NORMALIZATION", () => {
  it("E. normalizeSemanticPlan infers requiredEvidence from titles", () => {

    // Test "Run tests" step
    const steps1 = normalizeSemanticPlan([
      { title: "Run tests", description: "Execute the test suite" }
    ]);
    expect(steps1[0].requiredEvidence).toEqual(["test_result"]);

    // Test "Typecheck" step
    const steps2 = normalizeSemanticPlan([
      { title: "Typecheck", description: "Run the type checker" }
    ]);
    expect(steps2[0].requiredEvidence).toEqual(["typecheck_result"]);

    // Test "Production build" step
    const steps3 = normalizeSemanticPlan([
      { title: "Production build", description: "Run the build" }
    ]);
    expect(steps3[0].requiredEvidence).toEqual(["build_result"]);

    // Test that explicit requiredEvidence is preserved
    const steps4 = normalizeSemanticPlan([
      { title: "Custom step", requiredEvidence: ["diff"], description: "" }
    ]);
    expect(steps4[0].requiredEvidence).toEqual(["diff"]);
  });
});

describe("inspection completion evidence isolation", () => {
  it("does not auto-pass a later step with its own requiredEvidence", async () => {
    const store = new RuntimeStore(() => {});

    await store.createMission({
      goal: "Inspect and then run tests",
      mode: "act",
      projectRoot: process.cwd(),
      sessionId: null,
      workspaceId: null,
      metadata: {},
    });

    await store.addMissionStep({
      title: "Inspect repository",
      requiredEvidence: ["repository_status"],
    });

    await store.addMissionStep({
      title: "Report inspection",
      requiredEvidence: [],
    });

    await store.addMissionStep({
      title: "Run tests",
      requiredEvidence: ["test_result"],
    });

    const mission = store.getMission()!;
    await store.setCurrentStep(mission.steps[0].id);

    await markInspectionStepsComplete(
      store,
      "Repository inspection verified",
    );

    const steps = store.getMission()!.steps;

    expect(steps[0].status).toBe("passed");
    expect(steps[1].status).toBe("passed");

    // Critical invariant: inspection evidence cannot satisfy or bypass
    // a later test contract.
    expect(steps[2].status).toBe("pending");
    expect(steps[2].requiredEvidence).toEqual(["test_result"]);
  });
});
