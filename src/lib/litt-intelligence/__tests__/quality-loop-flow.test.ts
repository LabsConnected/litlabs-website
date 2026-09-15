/**
 * Regression tests for the quality-loop run-flow orchestrator.
 *
 * Under test: agent QUALITY-marker harvesting, machine evidence from tool
 * events, implied stage advancement, the visual-inspection gate (with a
 * mocked judge — no real browser or LLM calls), and final verdicts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/terminal-internal-client", () => ({
  buildPreviewProxyUrl: (workspaceId: string) => `https://preview.test/${workspaceId}`,
}));

vi.mock("../deploy", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../deploy")>();
  return { ...orig, verifyProductionUrl: vi.fn() };
});

vi.mock("../visual-judge", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../visual-judge")>();
  return { ...orig, runVisualJudge: vi.fn() };
});

import { runVisualJudge, type VisualScorecard } from "../visual-judge";
import { verifyProductionUrl } from "../deploy";
import { JUDGE_DIMENSIONS } from "../visual-judge";
import {
  buildRedesignPrompt,
  finalizeQualityLoop,
  harvestStageMarkers,
  noteBuildFix,
  noteDeployment,
  noteToolResult,
  runQualityInspection,
  shouldEnableQualityLoop,
  startQualityLoopSession,
  verifyLiveUrl,
  type QualityLoopSession,
} from "../quality-loop-flow";

const mockRunJudge = vi.mocked(runVisualJudge);
const mockVerifyUrl = vi.mocked(verifyProductionUrl);

function makeSession(): QualityLoopSession {
  return startQualityLoopSession({
    runId: "run-1",
    projectId: "proj-1",
    userId: "user-1",
    userRequest: "Build a dog grooming site",
  });
}

function makeScorecard(overall: number): VisualScorecard {
  return {
    dimensions: JUDGE_DIMENSIONS.map((dimension) => ({ dimension, score: overall, note: "n" })),
    overall,
    summary: "review",
    prioritizedFixes: ["Fix the hero spacing.", "Improve CTA contrast."],
    at: new Date().toISOString(),
    model: "judge",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("harvestStageMarkers", () => {
  it("records QUALITY markers from assistant messages", () => {
    const s = makeSession();
    const n = harvestStageMarkers(s, [
      {
        role: "assistant",
        content:
          "QUALITY: understand — Dog owners in the suburbs; goal is bookings.\nQUALITY: plan — One page: hero, services, contact.",
      },
    ]);
    expect(n).toBe(2);
    expect(s.state.stages.understand.evidence[0].by).toBe("agent");
    expect(s.state.stages.understand.evidence[0].summary).toMatch(/Dog owners/);
  });

  it("ignores markers in user messages and unknown stages", () => {
    const s = makeSession();
    const n = harvestStageMarkers(s, [
      { role: "user", content: "QUALITY: understand — not from the agent" },
      { role: "assistant", content: "QUALITY: teleport — impossible stage" },
    ]);
    expect(n).toBe(0);
    expect(s.state.stages.understand.evidence).toHaveLength(0);
  });

  it("never records the same marker twice", () => {
    const s = makeSession();
    const msg = [{ role: "assistant" as const, content: "QUALITY: design — Two-column layout." }];
    expect(harvestStageMarkers(s, msg)).toBe(1);
    expect(harvestStageMarkers(s, msg)).toBe(0);
    // Still pending (understand is current), but recorded exactly once.
    expect(s.observations.filter((o) => o.stage === "design")).toHaveLength(1);
  });
});

describe("noteToolResult — machine evidence", () => {
  it("records BUILD evidence for successful mutating tool calls", () => {
    const s = makeSession();
    noteToolResult(
      s,
      "files.write",
      { success: true, result: {}, mutating: true, summary: "wrote index.html" },
      "ws-1",
    );
    // build is a future stage while understand is current: held as observation
    expect(s.observations.some((o) => o.stage === "build")).toBe(true);
    expect(s.state.stages.build.evidence).toHaveLength(0);
  });

  it("records nothing for failed or read-only tool calls", () => {
    const s = makeSession();
    noteToolResult(
      s,
      "files.read",
      { success: true, result: {}, mutating: false, summary: "read x" },
      "ws-1",
    );
    noteToolResult(
      s,
      "files.write",
      { success: false, result: {}, mutating: true, summary: "failed" },
      "ws-1",
    );
    expect(s.observations).toHaveLength(0);
  });

  it("records RUN evidence and the preview URL when the preview is ready", () => {
    const s = makeSession();
    noteToolResult(
      s,
      "preview.status",
      { success: true, result: { status: "ready" }, mutating: false, summary: "ready" },
      "ws-9",
    );
    expect(s.previewUrl).toBe("https://preview.test/ws-9");
    expect(s.observations.some((o) => o.stage === "run")).toBe(true);
  });

  it("does not record RUN evidence when the preview is not ready", () => {
    const s = makeSession();
    noteToolResult(
      s,
      "preview.status",
      { success: true, result: { status: "starting" }, mutating: false, summary: "starting" },
      "ws-9",
    );
    expect(s.previewUrl).toBeUndefined();
    expect(s.observations).toHaveLength(0);
  });
});

describe("implied stage advancement", () => {
  it("passes earlier evidenced stages once later-stage work appears", () => {
    const s = makeSession();
    harvestStageMarkers(s, [
      {
        role: "assistant",
        content:
          "QUALITY: understand — Audience: dog owners; goal: bookings.\nQUALITY: plan — Hero, services, contact.\nQUALITY: design — Warm, playful, two-column.",
      },
    ]);
    noteToolResult(
      s,
      "files.write",
      { success: true, result: {}, mutating: true, summary: "wrote index.html" },
      "ws-1",
    );

    expect(s.state.stages.understand.status).toBe("passed");
    expect(s.state.stages.research.status).toBe("skipped");
    expect(s.state.stages.research.skipReason).toMatch(/implication/);
    expect(s.state.stages.plan.status).toBe("passed");
    expect(s.state.stages.design.status).toBe("passed");
    expect(s.state.stages.build.status).toBe("active");
    expect(s.state.stages.build.evidence).toHaveLength(1);
    expect(s.observations).toHaveLength(0);
  });

  it("leaves non-skippable stages open when they have no evidence — the gate holds", () => {
    const s = makeSession();
    // Agent builds without ever declaring understand/plan/design.
    noteToolResult(
      s,
      "files.write",
      { success: true, result: {}, mutating: true, summary: "wrote index.html" },
      "ws-1",
    );
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("understand");
    expect(finale.unfiledObservations).toBeGreaterThan(0);
  });
});

describe("noteBuildFix / noteDeployment", () => {
  async function sessionReadyForTestEvidence(): Promise<QualityLoopSession> {
    const s = makeSession();
    harvestStageMarkers(s, [
      { role: "assistant", content: "QUALITY: understand — x\nQUALITY: plan — x\nQUALITY: design — x" },
    ]);
    noteToolResult(
      s,
      "files.write",
      { success: true, result: {}, mutating: true, summary: "wrote it" },
      "ws-1",
    );
    noteToolResult(
      s,
      "preview.status",
      { success: true, result: { status: "ready" }, mutating: false, summary: "ready" },
      "ws-1",
    );
    mockRunJudge.mockResolvedValue({
      status: "scored",
      scorecard: makeScorecard(8.5),
      verdict: { passed: true, scorecard: makeScorecard(8.5), reason: "Pass" },
    });
    await runQualityInspection(s);
    return s;
  }

  it("records TEST evidence from build-fix results", async () => {
    const s = await sessionReadyForTestEvidence();
    noteBuildFix(s, {
      allPassed: true,
      results: [{ check: "typecheck", passed: true }],
    });
    expect(s.state.stages.test.evidence).toHaveLength(1);
    expect(s.state.stages.test.evidence[0].summary).toMatch(/all passed/);
    expect(s.state.stages.test.evidence[0].artifacts).toContain("typecheck:pass");
  });

  it("records DEPLOY evidence from a completed deployment", () => {
    const s = makeSession();
    noteDeployment(s, "https://example.com");
    expect(s.deployedUrl).toBe("https://example.com");
    expect(s.observations.some((o) => o.stage === "deploy")).toBe(true);
  });
});

describe("finalizeQualityLoop", () => {
  async function fullPassSession(runInspection: boolean): Promise<QualityLoopSession> {
    const s = makeSession();
    harvestStageMarkers(s, [
      {
        role: "assistant",
        content: [
          "QUALITY: understand — Dog owners; goal: bookings.",
          "QUALITY: research — Competitors use bold heroes; booking widget required.",
          "QUALITY: plan — Hero, services with prices, contact form.",
          "QUALITY: design — Warm palette, big type, generous spacing.",
          "QUALITY: polish — Copy tightened, hover states added.",
        ].join("\n"),
      },
    ]);
    noteToolResult(
      s,
      "files.write",
      { success: true, result: {}, mutating: true, summary: "wrote index.html" },
      "ws-1",
    );
    noteToolResult(
      s,
      "preview.status",
      { success: true, result: { status: "ready" }, mutating: false, summary: "ready" },
      "ws-1",
    );
    // The real flow inspects the preview before the build-fix loop runs.
    if (runInspection) {
      mockRunJudge.mockResolvedValue({
        status: "scored",
        scorecard: makeScorecard(8.5),
        verdict: { passed: true, scorecard: makeScorecard(8.5), reason: "Pass" },
      });
      await runQualityInspection(s);
    }
    noteBuildFix(s, { allPassed: true, results: [] });
    return s;
  }

  it("declares success when every required stage has evidence", async () => {
    const s = await fullPassSession(true);
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).toHaveLength(0);
    expect(finale.stages).toHaveLength(13);
  });

  it("requires deploy/verify when a deployment was requested", async () => {
    const s = await fullPassSession(true);
    const finale = finalizeQualityLoop(s, { deployRequested: true });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("deploy");
  });

  it("skips inspect/critique with the recorded inspection note", async () => {
    // No inspection ran (no screenshot available): the finalize sweep must
    // skip inspect/critique with the recorded reason and still let TEST
    // evidence through so the verdict can succeed.
    const s = await fullPassSession(false);
    s.inspectionNote = "No screenshot could be captured (browser unavailable).";
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
    expect(s.state.stages.inspect.status).toBe("skipped");
    expect(s.state.stages.inspect.skipReason).toMatch(/browser unavailable/);
    expect(s.state.stages.test.status).toBe("passed");
  });
});

describe("runQualityInspection", () => {
  it("reports unavailable when there is no preview URL — no fabricated score", async () => {
    const s = makeSession();
    const result = await runQualityInspection(s);
    expect(result.ran).toBe(false);
    expect(result.needsRedesign).toBe(false);
    expect(s.inspectionNote).toMatch(/No preview URL/);
    expect(mockRunJudge).not.toHaveBeenCalled();
  });

  async function sessionAtInspection(): Promise<QualityLoopSession> {
    const s = makeSession();
    harvestStageMarkers(s, [
      { role: "assistant", content: "QUALITY: understand — x\nQUALITY: plan — x\nQUALITY: design — x" },
    ]);
    noteToolResult(
      s,
      "files.write",
      { success: true, result: {}, mutating: true, summary: "wrote index.html" },
      "ws-1",
    );
    noteToolResult(
      s,
      "preview.status",
      { success: true, result: { status: "ready" }, mutating: false, summary: "ready" },
      "ws-1",
    );
    return s;
  }

  it("demands a redesign pass on a below-threshold scorecard", async () => {
    const s = await sessionAtInspection();
    mockRunJudge.mockResolvedValue({
      status: "scored",
      scorecard: makeScorecard(5.5),
      verdict: { passed: false, scorecard: makeScorecard(5.5), reason: "Below threshold: overall 5.5 < 7." },
    });
    const result = await runQualityInspection(s);
    expect(result.ran).toBe(true);
    expect(result.needsRedesign).toBe(true);
    expect(result.fixes).toHaveLength(2);
    expect(result.score).toBe(5.5);
    expect(s.state.designPasses).toBe(1);
    expect(s.critiqueFailed).toBe(true);
    expect(s.state.stages.critique.evidence.length).toBeGreaterThan(0);
  });

  it("runs only once per session", async () => {
    const s = makeSession();
    s.previewUrl = "https://preview.test/ws-1";
    mockRunJudge.mockResolvedValue({
      status: "scored",
      scorecard: makeScorecard(8.5),
      verdict: { passed: true, scorecard: makeScorecard(8.5), reason: "Pass" },
    });
    await runQualityInspection(s);
    const second = await runQualityInspection(s);
    expect(second.ran).toBe(true);
    expect(second.needsRedesign).toBe(false);
    expect(mockRunJudge).toHaveBeenCalledTimes(1);
  });

  it("records a no-fix decision when the critique passes", async () => {
    const s = makeSession();
    s.previewUrl = "https://preview.test/ws-1";
    mockRunJudge.mockResolvedValue({
      status: "scored",
      scorecard: makeScorecard(8.5),
      verdict: { passed: true, scorecard: makeScorecard(8.5), reason: "Pass" },
    });
    const result = await runQualityInspection(s);
    expect(result.needsRedesign).toBe(false);
    expect(s.critiqueFailed).toBe(false);
  });

  it("stops demanding redesigns after the pass bound is exhausted", async () => {
    const s = makeSession();
    s.previewUrl = "https://preview.test/ws-1";
    s.state.designPasses = 2; // already at MAX_DESIGN_PASSES
    mockRunJudge.mockResolvedValue({
      status: "scored",
      scorecard: makeScorecard(4),
      verdict: { passed: false, scorecard: makeScorecard(4), reason: "Below threshold." },
    });
    const result = await runQualityInspection(s);
    expect(result.needsRedesign).toBe(false);
    expect(result.reason).toMatch(/exhausted/);
    expect(s.state.designPasses).toBe(2);
  });

  it("records unavailable when the judge cannot score", async () => {
    const s = makeSession();
    s.previewUrl = "https://preview.test/ws-1";
    mockRunJudge.mockResolvedValue({
      status: "unavailable",
      reason: "No screenshot could be captured.",
    });
    const result = await runQualityInspection(s);
    expect(result.ran).toBe(false);
    expect(s.inspectionNote).toMatch(/No screenshot/);
  });
});

describe("failed evidence blocks the gate — never a false pass", () => {
  /** Full successful run up to the deploy boundary (mirrors the real flow). */
  async function sessionReadyForDeploy(buildFixPassed = true): Promise<QualityLoopSession> {
    const s = makeSession();
    harvestStageMarkers(s, [
      {
        role: "assistant",
        content: [
          "QUALITY: understand — Dog owners; goal: bookings.",
          "QUALITY: research — Competitors use bold heroes.",
          "QUALITY: plan — Hero, services, contact.",
          "QUALITY: design — Warm palette, big type.",
          "QUALITY: polish — Copy tightened.",
        ].join("\n"),
      },
    ]);
    noteToolResult(
      s,
      "files.write",
      { success: true, result: {}, mutating: true, summary: "wrote index.html" },
      "ws-1",
    );
    noteToolResult(
      s,
      "preview.status",
      { success: true, result: { status: "ready" }, mutating: false, summary: "ready" },
      "ws-1",
    );
    mockRunJudge.mockResolvedValue({
      status: "scored",
      scorecard: makeScorecard(8.5),
      verdict: { passed: true, scorecard: makeScorecard(8.5), reason: "Pass" },
    });
    await runQualityInspection(s);
    noteBuildFix(
      s,
      buildFixPassed
        ? { allPassed: true, results: [] }
        : {
            allPassed: false,
            results: [
              { check: "typecheck", passed: true },
              { check: "tests", passed: false },
            ],
          },
    );
    return s;
  }

  it("failing build-fix checks block TEST even with other evidence", async () => {
    const s = await sessionReadyForDeploy(false);

    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("test");
    expect(finale.verdict.reason).toMatch(/Failing checks: tests/);
  });

  it("a failed live-URL verification blocks VERIFY when deploy was requested", async () => {
    const s = await sessionReadyForDeploy();
    noteDeployment(s, "https://example.com");
    mockVerifyUrl.mockResolvedValue({ success: false, detail: "404 from origin", url: "https://example.com" });
    await verifyLiveUrl(s, "https://example.com");

    const finale = finalizeQualityLoop(s, { deployRequested: true });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("verify");
    expect(finale.verdict.reason).toMatch(/404 from origin/);
  });

  it("a passing live-URL verification satisfies VERIFY", async () => {
    const s = await sessionReadyForDeploy();
    noteDeployment(s, "https://example.com");
    mockVerifyUrl.mockResolvedValue({
      success: true,
      detail: "200, expected marker found",
      url: "https://example.com",
    });
    await verifyLiveUrl(s, "https://example.com");

    const finale = finalizeQualityLoop(s, { deployRequested: true });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).toHaveLength(0);
  });

  it("a later passing check clears an earlier failure", async () => {
    const s = await sessionReadyForDeploy();
    noteDeployment(s, "https://example.com");
    mockVerifyUrl
      .mockResolvedValueOnce({ success: false, detail: "500 during rollout", url: "https://example.com" })
      .mockResolvedValueOnce({ success: true, detail: "200, marker found", url: "https://example.com" });
    await verifyLiveUrl(s, "https://example.com");
    await verifyLiveUrl(s, "https://example.com");

    const finale = finalizeQualityLoop(s, { deployRequested: true });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).not.toContain("verify");
  });
});
describe("buildRedesignPrompt", () => {
  it("includes the fixes and the pass number", () => {
    const prompt = buildRedesignPrompt(
      { ran: true, needsRedesign: true, fixes: ["Fix hero.", "Fix CTA."], reason: "5.5 < 7", score: 5.5 },
      1,
    );
    expect(prompt).toContain("Fix hero.");
    expect(prompt).toContain("design pass 1 of 2");
  });
});

describe("shouldEnableQualityLoop — mode opt-in", () => {
  it("opts in ACT runs with a project", () => {
    expect(shouldEnableQualityLoop("act", "proj-1")).toBe(true);
  });

  it("opts in AUTO runs with a project", () => {
    expect(shouldEnableQualityLoop("auto", "proj-1")).toBe(true);
  });

  it("never opts in PLAN mode", () => {
    expect(shouldEnableQualityLoop("plan", "proj-1")).toBe(false);
  });

  it("never opts in without a project", () => {
    expect(shouldEnableQualityLoop("act", null)).toBe(false);
    expect(shouldEnableQualityLoop("auto", undefined)).toBe(false);
    expect(shouldEnableQualityLoop("act", "")).toBe(false);
  });

  it("never opts in for unknown modes", () => {
    expect(shouldEnableQualityLoop("turbo", "proj-1")).toBe(false);
    expect(shouldEnableQualityLoop(undefined, "proj-1")).toBe(false);
  });
});

describe("AUTO-mode quality gating", () => {
  /**
   * Simulates an AUTO run's evidence path: no conversational checkpoints,
   * no human in the loop — evidence comes only from agent QUALITY markers
   * in assistant messages and machine observations from tool events.
   */
  async function autoSession(opts: {
    withBuild?: boolean;
    withPreview?: boolean;
    withTest?: boolean;
    judgeScore?: number;
  }): Promise<QualityLoopSession> {
    const s = makeSession();
    harvestStageMarkers(s, [
      {
        role: "assistant",
        content: [
          "QUALITY: understand — Dog owners; goal: bookings.",
          "QUALITY: research — No external research needed; standard grooming site.",
          "QUALITY: plan — Hero, services with prices, contact.",
          "QUALITY: design — Warm palette, big type, generous spacing.",
          "QUALITY: polish — Copy tightened, hover states added.",
        ].join("\n"),
      },
    ]);
    if (opts.withBuild !== false) {
      noteToolResult(
        s,
        "files.write",
        { success: true, result: {}, mutating: true, summary: "wrote index.html" },
        "ws-1",
      );
    }
    if (opts.withPreview !== false) {
      noteToolResult(
        s,
        "preview.status",
        { success: true, result: { status: "ready" }, mutating: false, summary: "ready" },
        "ws-1",
      );
    }
    mockRunJudge.mockResolvedValue({
      status: "scored",
      scorecard: makeScorecard(opts.judgeScore ?? 8.5),
      verdict:
        (opts.judgeScore ?? 8.5) >= 7
          ? { passed: true, scorecard: makeScorecard(opts.judgeScore ?? 8.5), reason: "Pass" }
          : { passed: false, scorecard: makeScorecard(opts.judgeScore ?? 5.0), reason: "Below threshold" },
    });
    await runQualityInspection(s);
    if (opts.withTest !== false) {
      noteBuildFix(s, { allPassed: true, results: [] });
    }
    return s;
  }

  it("AUTO run with full evidence → success verdict", async () => {
    const s = await autoSession({});
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).toHaveLength(0);
  });

  it("AUTO run with missing evidence → refused success naming the missing stages", async () => {
    const s = await autoSession({ withBuild: false, withTest: false });
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("build");
    expect(finale.verdict.missing).toContain("test");
    expect(finale.verdict.reason).toMatch(/"build"/);
    expect(finale.verdict.reason).toMatch(/"test"/);
  });

  it("agent-only deploy claim never satisfies DEPLOY — the loop cannot auto-approve a deploy", async () => {
    const s = await autoSession({});
    // The agent *says* it deployed, but no machine deployment happened
    // (e.g. project.deploy was blocked awaiting approval in AUTO).
    harvestStageMarkers(s, [
      { role: "assistant", content: "QUALITY: deploy — Shipped it to https://example.com" },
    ]);
    harvestStageMarkers(s, [
      { role: "assistant", content: "QUALITY: verify — Checked the live URL, looks good" },
    ]);

    const finale = finalizeQualityLoop(s, { deployRequested: true });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("deploy");
    expect(finale.verdict.missing).toContain("verify");
    expect(s.state.stages.deploy.status).not.toBe("passed");
  });

  it("machine deployment evidence satisfies DEPLOY/VERIFY in AUTO", async () => {
    const s = await autoSession({});
    noteDeployment(s, "https://example.com");
    mockVerifyUrl.mockResolvedValue({
      success: true,
      detail: "200, expected marker found",
      url: "https://example.com",
    });
    await verifyLiveUrl(s, "https://example.com");

    const finale = finalizeQualityLoop(s, { deployRequested: true });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).toHaveLength(0);
  });

  it("judge below threshold in AUTO → automatic redesign pass", async () => {
    const s = makeSession();
    // Mirror the real AUTO flow: earlier stages evidenced before inspection.
    harvestStageMarkers(s, [
      {
        role: "assistant",
        content: "QUALITY: understand — Dog owners; goal: bookings.\nQUALITY: plan — Hero, services, contact.\nQUALITY: design — Warm palette, big type.",
      },
    ]);
    noteToolResult(
      s,
      "files.write",
      { success: true, result: {}, mutating: true, summary: "wrote index.html" },
      "ws-1",
    );
    noteToolResult(
      s,
      "preview.status",
      { success: true, result: { status: "ready" }, mutating: false, summary: "ready" },
      "ws-1",
    );
    mockRunJudge.mockResolvedValue({
      status: "scored",
      scorecard: makeScorecard(5.2),
      verdict: { passed: false, scorecard: makeScorecard(5.2), reason: "Cramped hero, weak hierarchy" },
    });

    const inspection = await runQualityInspection(s);
    expect(inspection.ran).toBe(true);
    expect(inspection.needsRedesign).toBe(true);
    expect(inspection.fixes.length).toBeGreaterThan(0);
    expect(s.state.designPasses).toBe(1);
    expect(s.critiqueFailed).toBe(true);
    expect(s.state.stages.critique.evidence[0].by).toBe("judge");
  });
});
