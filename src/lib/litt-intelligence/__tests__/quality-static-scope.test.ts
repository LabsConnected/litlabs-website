/**
 * Regression: static (gitless) workspaces validate only applicable stages.
 *
 * A full-scope build in a static workspace has no host execution and no
 * browser-inspection/judge path, so INSPECT and CRITIQUE are not applicable
 * stages — verification is the served static preview plus verified
 * read-back evidence. Before this narrowing, every successful static build
 * reported "Quality gate failed: N required stage(s) lack evidence" — a
 * false failure for the paid static-site builder (the site was written and
 * previewed correctly and the run still ended as a failure).
 *
 * What did NOT change: understand/plan/design/build/run/test are still
 * required, a failed stage still blocks, and non-static workspaces keep
 * the full strict set.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/terminal-internal-client", () => ({
  buildPreviewProxyUrl: (id: string) => `https://preview.test/${id}`,
}));

vi.mock("../deploy", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../deploy")>();
  return { ...orig, verifyProductionUrl: vi.fn() };
});

vi.mock("../visual-judge", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../visual-judge")>();
  return { ...orig, runVisualJudge: vi.fn() };
});

import { REQUIRED_STAGES_BY_SCOPE, requiredStagesFor } from "../quality-loop";
import {
  finalizeQualityLoop,
  harvestStageMarkers,
  noteBuildArtifacts,
  notePreviewReady,
  noteStaticArtifactCheck,
  noteToolResult,
  restoreQualityLoopSession,
  snapshotQualityLoopSession,
  startQualityLoopSession,
  type QualityLoopSession,
} from "../quality-loop-flow";

function makeStaticSession(userRequest = "Build me a bakery website"): QualityLoopSession {
  return startQualityLoopSession({
    runId: "run-static",
    projectId: "proj-1",
    userId: "user-1",
    userRequest,
    isStaticWorkspace: true,
  });
}

/** The exact evidence a successful static-lane full build produces. */
function completeStaticBuildEvidence(s: QualityLoopSession): void {
  harvestStageMarkers(s, [
    {
      role: "assistant" as const,
      content: [
        "QUALITY: understand — Bakery owners; the goal is custom cake orders.",
        "QUALITY: plan — One page: hero, menu, gallery, order form.",
        "QUALITY: design — Warm palette, serif display type, card grid.",
      ].join("\n"),
    },
  ]);
  // A mutating file write (sets mutationSeen + build observation).
  noteToolResult(
    s,
    "files.write",
    { success: true, result: {}, mutating: true, summary: "wrote index.html" },
    "ws-1",
  );
  // TEST in the static lane = the verified read-back of the written file.
  noteStaticArtifactCheck(s, { path: "index.html", contentMatches: true });
  // BUILD machine evidence + RUN evidence from the served static preview.
  noteBuildArtifacts(s, ["index.html", "styles.css"]);
  notePreviewReady(s, "/api/preview/proj-1/");
}

describe("requiredStagesFor — applicable stages", () => {
  it("drops inspect/critique for a static full-scope workspace", () => {
    const req = requiredStagesFor("full", { isStaticWorkspace: true });
    expect(req).not.toContain("inspect");
    expect(req).not.toContain("critique");
    expect(req).toEqual(
      expect.arrayContaining(["understand", "plan", "design", "build", "run", "test"]),
    );
  });

  it("keeps the strict full set for non-static and flagless workspaces", () => {
    expect(requiredStagesFor("full")).toEqual(REQUIRED_STAGES_BY_SCOPE.full);
    expect(requiredStagesFor("full", { isStaticWorkspace: false })).toEqual(
      REQUIRED_STAGES_BY_SCOPE.full,
    );
  });

  it("leaves standard and trivial scopes untouched for static workspaces", () => {
    expect(requiredStagesFor("standard", { isStaticWorkspace: true })).toEqual(
      REQUIRED_STAGES_BY_SCOPE.standard,
    );
    expect(requiredStagesFor("trivial", { isStaticWorkspace: true })).toEqual(
      REQUIRED_STAGES_BY_SCOPE.trivial,
    );
  });
});

describe("static quality gate — verdicts", () => {
  it("declares success for a complete static build without browser inspection", () => {
    const s = makeStaticSession();
    expect(s.taskScope).toBe("full");
    expect(s.state.isStaticWorkspace).toBe(true);
    completeStaticBuildEvidence(s);
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
    // inspect/critique are skipped with a recorded reason — never pending,
    // never fabricated as passes.
    expect(s.state.stages.inspect.status).toBe("skipped");
    expect(s.state.stages.critique.status).toBe("skipped");
    expect(s.state.stages.inspect.skipReason).toMatch(/static/i);
  });

  it("still blocks a genuine failure — a failed stage holds the gate", () => {
    const s = makeStaticSession();
    completeStaticBuildEvidence(s);
    s.state.stages.test.status = "failed";
    s.state.stages.test.failureReason = "read-back content mismatch";
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("test");
  });

  it("still blocks an incomplete build — no artifact evidence, no success", () => {
    const s = makeStaticSession();
    harvestStageMarkers(s, [
      {
        role: "assistant" as const,
        content:
          "QUALITY: understand — x\nQUALITY: plan — y\nQUALITY: design — z",
      },
    ]);
    // No noteBuildArtifacts — the build never produced a verified artifact.
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("build");
  });

  it("keeps inspect/critique required for non-static full builds", () => {
    const s = startQualityLoopSession({
      runId: "run-git",
      projectId: "proj-1",
      userId: "user-1",
      userRequest: "Build me a bakery website",
    });
    expect(s.state.isStaticWorkspace).toBeUndefined();
    completeStaticBuildEvidence(s);
    const finale = finalizeQualityLoop(s, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toEqual(
      expect.arrayContaining(["inspect", "critique"]),
    );
  });

  it("persists the static flag across snapshot/restore (approval-resume safety)", () => {
    const s = makeStaticSession();
    const restored = restoreQualityLoopSession(snapshotQualityLoopSession(s));
    expect(restored.state.isStaticWorkspace).toBe(true);
    completeStaticBuildEvidence(restored);
    const finale = finalizeQualityLoop(restored, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
  });
});
