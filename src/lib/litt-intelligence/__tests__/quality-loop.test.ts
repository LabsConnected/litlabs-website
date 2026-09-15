/**
 * Regression tests for the LiTT quality-loop gated stage machine.
 *
 * The hard product rule under test: the loop can never advance past a
 * stage, and can never declare success, without that stage's required
 * evidence recorded.
 */
import { describe, expect, it } from "vitest";
import {
  QUALITY_STAGES,
  STAGE_REQUIREMENTS,
  StageGateError,
  beginStage,
  createQualityLoop,
  currentStage,
  declareSuccess,
  failStage,
  passStage,
  recordEvidence,
  skipStage,
  summarizeLoop,
} from "../quality-loop";

function makeLoop() {
  return createQualityLoop({ runId: "run-1", projectId: "proj-1", userId: "user-1" });
}

function evidence(summary = "did the thing") {
  return { summary, by: "agent" as const };
}

describe("createQualityLoop", () => {
  it("starts with every stage pending and no evidence", () => {
    const state = makeLoop();
    expect(QUALITY_STAGES).toHaveLength(13);
    for (const stage of QUALITY_STAGES) {
      expect(state.stages[stage].status).toBe("pending");
      expect(state.stages[stage].evidence).toHaveLength(0);
    }
    expect(state.designPasses).toBe(0);
    expect(state.version).toBe(1);
  });

  it("reports the first stage as current", () => {
    expect(currentStage(makeLoop())).toBe("understand");
  });
});

describe("stage ordering", () => {
  it("refuses to begin a stage out of order", () => {
    const state = makeLoop();
    expect(() => beginStage(state, "plan")).toThrow(StageGateError);
    beginStage(state, "understand");
    expect(state.stages.understand.status).toBe("active");
  });

  it("refuses evidence for a future stage", () => {
    const state = makeLoop();
    expect(() => recordEvidence(state, "build", evidence())).toThrow(StageGateError);
  });

  it("allows evidence for the current and earlier stages", () => {
    const state = makeLoop();
    recordEvidence(state, "understand", evidence("brief done"));
    passStage(state, "understand");
    // "understand" is now earlier than current ("research"): late evidence ok.
    recordEvidence(state, "understand", evidence("late note"));
    expect(state.stages.understand.evidence).toHaveLength(2);
    expect(currentStage(state)).toBe("research");
  });
});

describe("passStage gate", () => {
  it("refuses to pass a stage with no evidence", () => {
    const state = makeLoop();
    expect(() => passStage(state, "understand")).toThrow(/without evidence/);
    expect(state.stages.understand.status).not.toBe("passed");
  });

  it("passes a stage once evidence is recorded", () => {
    const state = makeLoop();
    recordEvidence(state, "understand", evidence());
    passStage(state, "understand");
    expect(state.stages.understand.status).toBe("passed");
    expect(currentStage(state)).toBe("research");
  });

  it("refuses to pass a stage that is not current", () => {
    const state = makeLoop();
    expect(() => passStage(state, "plan")).toThrow(StageGateError);
  });
});

describe("stage progression", () => {
  it("moves past passed and skipped stages in order", () => {
    const state = makeLoop();
    recordEvidence(state, "understand", evidence());
    passStage(state, "understand");
    expect(currentStage(state)).toBe("research");
    skipStage(state, "research", "No external research needed for this trivial change.");
    expect(currentStage(state)).toBe("plan");
    expect(state.stages.research.status).toBe("skipped");
    expect(state.stages.research.skipReason).toMatch(/trivial change/);
  });
});

describe("skipStage", () => {
  it("refuses to skip a non-skippable stage", () => {
    const state = makeLoop();
    expect(() => skipStage(state, "understand", "wanted to")).toThrow(/not skippable/);
  });

  it("refuses to skip without an explicit reason", () => {
    const state = makeLoop();
    recordEvidence(state, "understand", evidence());
    passStage(state, "understand");
    expect(() => skipStage(state, "research", "   ")).toThrow(/explicit reason/);
  });

  it("records the skip reason for skippable stages", () => {
    const state = makeLoop();
    recordEvidence(state, "understand", evidence());
    passStage(state, "understand");
    skipStage(state, "research", "Brief fully specifies the change; no research needed.");
    expect(state.stages.research.status).toBe("skipped");
    expect(state.stages.research.skipReason).toContain("no research needed");
  });
});

describe("failStage", () => {
  it("marks the stage failed and blocks success", () => {
    const state = makeLoop();
    recordEvidence(state, "understand", evidence());
    passStage(state, "understand");
    skipStage(state, "research", "not needed");
    recordEvidence(state, "plan", evidence());
    passStage(state, "plan");
    recordEvidence(state, "design", evidence());
    passStage(state, "design");
    recordEvidence(state, "build", evidence());
    passStage(state, "build");
    failStage(state, "run", "Preview server failed to start: port in use.");
    const verdict = declareSuccess(state, { deployRequested: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toContain("run");
    expect(state.stages.run.failureReason).toMatch(/port in use/);
  });
});

describe("declareSuccess — the hard product rule", () => {
  function passUpTo(state: ReturnType<typeof makeLoop>, upto: (typeof QUALITY_STAGES)[number]) {
    for (const stage of QUALITY_STAGES) {
      const req = STAGE_REQUIREMENTS[stage];
      if (req.skippable && stage !== upto) {
        skipStage(state, stage, "Skipped in test setup.");
      } else {
        recordEvidence(state, stage, evidence(`${stage} done`));
        passStage(state, stage);
      }
      if (stage === upto) break;
    }
  }

  it("refuses success when required stages lack evidence", () => {
    const state = makeLoop();
    const verdict = declareSuccess(state, { deployRequested: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toContain("understand");
    expect(verdict.missing).toContain("build");
    expect(verdict.reason).toMatch(/lack evidence/);
  });

  it("ignores skippable stages without evidence", () => {
    const state = makeLoop();
    // Pass every non-skippable stage except deploy/verify (not requested).
    for (const stage of QUALITY_STAGES) {
      const req = STAGE_REQUIREMENTS[stage];
      const c = currentStage(state);
      if (!c) break;
      if (c !== stage) break;
      if (req.skippable) {
        skipStage(state, stage, "Not applicable to this run.");
      } else if (stage === "deploy" || stage === "verify") {
        break; // not requested; leave pending
      } else {
        recordEvidence(state, stage, evidence());
        passStage(state, stage);
      }
    }
    const verdict = declareSuccess(state, { deployRequested: false });
    expect(verdict.ok).toBe(true);
    expect(verdict.missing).toHaveLength(0);
  });

  it("requires deploy/verify only when a deployment was requested", () => {
    const state = makeLoop();
    for (const stage of QUALITY_STAGES) {
      const c = currentStage(state);
      if (!c || c !== stage) break;
      const req = STAGE_REQUIREMENTS[stage];
      if (req.skippable && stage !== "deploy" && stage !== "verify") {
        skipStage(state, stage, "n/a");
      } else {
        recordEvidence(state, stage, evidence());
        passStage(state, stage);
      }
      if (stage === "test") break;
    }
    // deploy/verify still pending
    expect(declareSuccess(state, { deployRequested: false }).ok).toBe(true);
    const withDeploy = declareSuccess(state, { deployRequested: true });
    expect(withDeploy.ok).toBe(false);
    expect(withDeploy.missing).toContain("deploy");

    recordEvidence(state, "deploy", evidence("live at https://x.example"));
    passStage(state, "deploy");
    recordEvidence(state, "verify", evidence("fetched 200"));
    passStage(state, "verify");
    expect(declareSuccess(state, { deployRequested: true }).ok).toBe(true);
  });

  it("never declares success after a failed stage, even with other evidence", () => {
    const state = makeLoop();
    passUpTo(state, "build");
    failStage(state, "run", "preview failed");
    // Even if everything else somehow passed, the failure blocks success.
    const verdict = declareSuccess(state, { deployRequested: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toContain("run");
  });
});

describe("summarizeLoop", () => {
  it("reports per-stage status and evidence counts", () => {
    const state = makeLoop();
    recordEvidence(state, "understand", evidence());
    passStage(state, "understand");
    const summary = summarizeLoop(state);
    expect(summary).toHaveLength(13);
    expect(summary[0]).toEqual({ stage: "understand", status: "passed", evidenceCount: 1 });
    expect(summary[1]).toEqual({ stage: "research", status: "pending", evidenceCount: 0 });
  });
});
