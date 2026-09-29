/**
 * Regression tests for the task-scoped quality gate.
 *
 * Context: the 2026-09-28 production acceptance run FAILED because a trivial
 * task ("Add an HTML comment ... in index.html") could never complete — the
 * gate demanded all 8 non-skippable stages (understand → test) with evidence
 * for every run, regardless of task intent. The run stalled forever with
 * "Quality check — cannot declare success: 8 required stage(s) lack evidence".
 *
 * The fix: a system-determined QualityTaskScope (trivial | standard | full)
 * computed from the user's request. Each scope defines which stages must
 * pass; stages outside the scope are skipped with a recorded reason and can
 * never block completion. Scope is never agent-declared, and the stages
 * that remain still demand real evidence — no fake success, no bypass.
 *
 * Larry's ordered regression set:
 *  1. trivial mutation → completes
 *  2. medium change → completes with appropriate evidence
 *  3. full build → completes when evidence present
 *  4. genuinely-missing evidence → still refuses
 */
import { describe, expect, it, vi } from "vitest";

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

import {
  classifyTaskScope,
  createQualityLoop,
  declareSuccess,
  failStage,
  passStage,
  QUALITY_STAGES,
  recordEvidence,
  REQUIRED_STAGES_BY_SCOPE,
  skipStageOutOfScope,
  type QualityTaskScope,
} from "../quality-loop";
import { JUDGE_DIMENSIONS, runVisualJudge, type VisualScorecard } from "../visual-judge";
import {
  buildQualityLoopPrompt,
  finalizeQualityLoop,
  harvestStageMarkers,
  noteBuildArtifacts,
  noteBuildFix,
  noteToolResult,
  restoreQualityLoopSession,
  runQualityInspection,
  snapshotQualityLoopSession,
  startQualityLoopSession,
} from "../quality-loop-flow";

const mockRunJudge = vi.mocked(runVisualJudge);

function makeScorecard(overall: number): VisualScorecard {
  return {
    dimensions: JUDGE_DIMENSIONS.map((dimension) => ({ dimension, score: overall, note: "n" })),
    overall,
    summary: "review",
    prioritizedFixes: [],
    at: new Date().toISOString(),
    model: "judge",
  };
}

const BASE = {
  runId: "run-test",
  projectId: "proj-test",
  userId: "user-test",
};

function trivialSession() {
  return startQualityLoopSession({
    ...BASE,
    userRequest:
      "Add an HTML comment `<!-- acceptance-test -->` right after the opening <body> tag in index.html",
  });
}

function successfulMutation(session: ReturnType<typeof startQualityLoopSession>) {
  noteToolResult(
    session,
    "files.write",
    { success: true, result: { ok: true }, mutating: true, summary: "wrote index.html" },
    "ws-test",
  );
}

describe("classifyTaskScope", () => {
  it("classifies the failed acceptance task as trivial", () => {
    expect(
      classifyTaskScope(
        "Add an HTML comment `<!-- acceptance-test -->` right after the opening <body> tag in index.html",
      ),
    ).toBe("trivial");
  });

  it("classifies typo/copy tweaks as trivial", () => {
    expect(classifyTaskScope("Fix the typo on the homepage headline")).toBe("trivial");
    expect(classifyTaskScope("Update the button text to say Get Started")).toBe("trivial");
  });

  it("classifies bug fixes and small features as standard", () => {
    expect(classifyTaskScope("Fix the login redirect bug")).toBe("standard");
    expect(classifyTaskScope("Add a contact form to the site")).toBe("standard");
  });

  it("classifies product builds as full", () => {
    expect(classifyTaskScope("Build me a website for my roofing business")).toBe("full");
    expect(classifyTaskScope("Create a landing page for my bakery")).toBe("full");
    expect(classifyTaskScope("Redesign my homepage")).toBe("full");
  });

  it("is conservative: empty or unknown requests default to standard", () => {
    expect(classifyTaskScope("")).toBe("standard");
    expect(classifyTaskScope("   ")).toBe("standard");
    expect(classifyTaskScope("Look into why the deploy is slow")).toBe("standard");
  });

  it("prefers full when a request mixes a build with a tweak", () => {
    expect(classifyTaskScope("Build me a website and fix a typo in the footer")).toBe("full");
  });
});

describe("declareSuccess with task scope", () => {
  const SCOPE_REASON = "test";

  /**
   * Drive a fresh state to build-passed for the given scope, walking the
   * full stage list in order (research/fix/polish sit between the named
   * stages). Non-required stages are skipped as out of scope.
   */
  function stateWithBuildPassed(scope: QualityTaskScope) {
    const state = createQualityLoop(BASE);
    const required = new Set(REQUIRED_STAGES_BY_SCOPE[scope]);
    for (const stage of QUALITY_STAGES) {
      if (stage === "build") break;
      if (required.has(stage)) {
        recordEvidence(state, stage, { summary: `${stage} done`, by: "agent" });
        passStage(state, stage);
      } else {
        skipStageOutOfScope(state, stage, scope, SCOPE_REASON);
      }
    }
    recordEvidence(state, "build", {
      summary: "artifacts verified",
      by: "system",
      detail: { artifactVerified: true },
    });
    passStage(state, "build");
    return state;
  }

  /** Skip every remaining stage that the scope does not require. */
  function skipRestAsOutOfScope(state: ReturnType<typeof createQualityLoop>, scope: QualityTaskScope) {
    const required = new Set(REQUIRED_STAGES_BY_SCOPE[scope]);
    for (const stage of QUALITY_STAGES) {
      const s = state.stages[stage];
      if (s.status === "pending" || s.status === "active") {
        if (required.has(stage)) continue;
        if (stage === "deploy" || stage === "verify") continue;
        skipStageOutOfScope(state, stage, scope, SCOPE_REASON);
      }
    }
  }

  it("trivial: passes when build has system mutation evidence", () => {
    const state = stateWithBuildPassed("trivial");
    const verdict = declareSuccess(state, { deployRequested: false, taskScope: "trivial" });
    expect(verdict.ok).toBe(true);
    expect(verdict.missing).toEqual([]);
  });

  it("trivial: refuses when build has genuinely no evidence", () => {
    const state = createQualityLoop(BASE);
    const verdict = declareSuccess(state, { deployRequested: false, taskScope: "trivial" });
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toEqual(["build"]);
  });

  it("standard: passes with understand/plan/build/test", () => {
    const state = stateWithBuildPassed("standard");
    skipRestAsOutOfScope(state, "standard");
    recordEvidence(state, "test", {
      summary: "checks passed",
      by: "system",
      detail: { executedChecks: true, passed: true },
    });
    passStage(state, "test");
    const verdict = declareSuccess(state, { deployRequested: false, taskScope: "standard" });
    expect(verdict.ok).toBe(true);
  });

  it("standard: refuses when test is missing", () => {
    const state = stateWithBuildPassed("standard");
    const verdict = declareSuccess(state, { deployRequested: false, taskScope: "standard" });
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toContain("test");
  });

  it("a failed stage blocks even in trivial scope", () => {
    const state = stateWithBuildPassed("trivial");
    // Skip everything except test, so test becomes current.
    for (const stage of ["run", "inspect", "critique", "fix", "polish"] as const) {
      skipStageOutOfScope(state, stage, "trivial", SCOPE_REASON);
    }
    // A later system check reports the build output as broken.
    recordEvidence(state, "test", {
      summary: "checks failed",
      by: "system",
      detail: { executedChecks: true, passed: false },
    });
    failStage(state, "test", "checks failed");
    const verdict = declareSuccess(state, { deployRequested: false, taskScope: "trivial" });
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toContain("test");
  });

  it("defaults to full scope (previous behavior) when no scope is given", () => {
    const state = createQualityLoop(BASE);
    const verdict = declareSuccess(state, { deployRequested: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toContain("understand");
    expect(verdict.missing).toContain("test");
  });
});

describe("finalizeQualityLoop with task scope (acceptance-task replay)", () => {
  it("1. trivial mutation completes after one successful mutating tool call", () => {
    const session = trivialSession();
    expect(session.taskScope).toBe("trivial");
    successfulMutation(session);
    const finale = finalizeQualityLoop(session, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).toEqual([]);
  });

  it("4. trivial task with no tool calls still refuses (genuinely missing evidence)", () => {
    const session = trivialSession();
    const finale = finalizeQualityLoop(session, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toEqual(["build"]);
  });

  it("trivial build cannot be satisfied by the agent's word alone", () => {
    const session = trivialSession();
    harvestStageMarkers(session, [
      { role: "assistant", content: "QUALITY: build — added the comment" },
    ]);
    const finale = finalizeQualityLoop(session, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toEqual(["build"]);
  });

  it("2. medium change completes with understand/plan/build/test evidence", () => {
    const session = startQualityLoopSession({
      ...BASE,
      userRequest: "Fix the login redirect bug",
    });
    expect(session.taskScope).toBe("standard");
    harvestStageMarkers(session, [
      { role: "assistant", content: "QUALITY: understand — redirect drops the session token" },
      { role: "assistant", content: "QUALITY: plan — preserve token across the redirect" },
    ]);
    successfulMutation(session);
    noteBuildArtifacts(session, ["src/app/login/page.tsx"]);
    noteBuildFix(session, {
      allPassed: true,
      results: [{ check: "typecheck", passed: true }],
    });
    const finale = finalizeQualityLoop(session, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).toEqual([]);
  });

  it("3. full build completes when the complete pipeline has evidence", async () => {
    const session = startQualityLoopSession({
      ...BASE,
      userRequest: "Build me a website for my roofing business",
    });
    expect(session.taskScope).toBe("full");
    harvestStageMarkers(session, [
      { role: "assistant", content: "QUALITY: understand — roofing company, lead capture goal" },
      { role: "assistant", content: "QUALITY: plan — 5 pages, quote form, mobile-first" },
      { role: "assistant", content: "QUALITY: design — bold industrial, lime accents" },
    ]);
    successfulMutation(session);
    noteBuildArtifacts(session, ["index.html"]);
    noteToolResult(
      session,
      "preview.status",
      { success: true, result: { status: "ready" }, mutating: false, summary: "ready" },
      "ws-test",
    );
    mockRunJudge.mockResolvedValue({
      status: "scored",
      browserInspected: true,
      styleHealthy: true,
      consoleClean: true,
      scorecard: makeScorecard(8.5),
      verdict: { passed: true, scorecard: makeScorecard(8.5), reason: "Pass" },
    });
    const inspection = await runQualityInspection(session);
    expect(inspection.needsRedesign).toBe(false);
    noteBuildFix(session, {
      allPassed: true,
      results: [{ check: "typecheck", passed: true }],
    });
    const finale = finalizeQualityLoop(session, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).toEqual([]);
  });

  it("full build with only a mutation still refuses (no bypass for big work)", () => {
    const session = startQualityLoopSession({
      ...BASE,
      userRequest: "Build me a website for my roofing business",
    });
    successfulMutation(session);
    const finale = finalizeQualityLoop(session, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("understand");
  });

  it("task scope survives an approval-pause snapshot round-trip", () => {
    const session = trivialSession();
    successfulMutation(session);
    const snapshot = snapshotQualityLoopSession(session);
    expect(snapshot.taskScope).toBe("trivial");
    const restored = restoreQualityLoopSession(JSON.parse(JSON.stringify(snapshot)));
    expect(restored.taskScope).toBe("trivial");
    const finale = finalizeQualityLoop(restored, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
  });

  it("pre-scope snapshots fall back to classification from the request", () => {
    const session = trivialSession();
    const legacy = snapshotQualityLoopSession(session) as unknown as Record<string, unknown>;
    delete legacy.taskScope;
    const restored = restoreQualityLoopSession(
      JSON.parse(JSON.stringify(legacy)) as Parameters<typeof restoreQualityLoopSession>[0],
    );
    expect(restored.taskScope).toBe("trivial");
  });
});

describe("buildQualityLoopPrompt", () => {
  it("tells the agent which scope applies", () => {
    const prompt = buildQualityLoopPrompt("trivial" as QualityTaskScope);
    expect(prompt).toContain("TRIVIAL");
    expect(prompt).toContain("QUALITY: <stage>");
  });

  it("standard and full prompts name their required stages", () => {
    expect(buildQualityLoopPrompt("standard")).toContain("understand, plan, build, test");
    expect(buildQualityLoopPrompt("full")).toContain("FULL");
  });
});
