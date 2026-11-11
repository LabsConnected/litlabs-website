/**
 * ART-20261111-041 — quality-gate scoping for read-only inspection runs.
 *
 * Live defect (staging 5fde385d, Gate B project): "List the files in
 * this project" ran the tool lane correctly — files.list succeeded and
 * the model composed the right answer — but the quality session
 * classified the task "standard" from the request text, so the gate
 * demanded BUILD and TEST evidence a read-only run can never produce,
 * and the run failed its gate. The kernel had already classified the
 * turn as read-only inspection (#905); the quality session must honor
 * THAT system signal (threaded in as the session scope), not re-derive
 * a scope from prose.
 *
 * Doctrine pins (must hold before AND after): with no inspection
 * signal, the same request text still scopes "standard" and the gate
 * still fails without build/test evidence; a full build still scopes
 * "full" and cannot pass without its stages.
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

import { finalizeQualityLoop, startQualityLoopSession } from "../quality-loop-flow";
import { REQUIRED_STAGES_BY_SCOPE } from "../quality-loop";

const LIST_MESSAGE =
  "List the files in the project I'm currently viewing. Just list them, don't change anything.";

describe("quality loop — inspection task scope", () => {
  it("the inspection scope requires only the system-filed cognitive stages", () => {
    expect(REQUIRED_STAGES_BY_SCOPE.inspection).toEqual(["understand", "plan"]);
  });

  it("a session created with the kernel's inspection scope passes its gate on the evidence a read produces", () => {
    const session = startQualityLoopSession({
      runId: "run-insp-1",
      projectId: "proj-1",
      userId: "user-1",
      userRequest: LIST_MESSAGE,
      taskScope: "inspection",
    });
    expect(session.taskScope).toBe("inspection");

    const finale = finalizeQualityLoop(session, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).toEqual([]);
    // Out-of-scope stages are recorded skips, never silent omissions.
    const build = finale.stages.find((s) => s.stage === "build");
    const test = finale.stages.find((s) => s.stage === "test");
    expect(build?.status).toBe("skipped");
    expect(test?.status).toBe("skipped");
  });

  it("CONTROL: without the inspection signal, the same request still scopes standard and the gate still fails on build/test", () => {
    const session = startQualityLoopSession({
      runId: "run-insp-2",
      projectId: "proj-1",
      userId: "user-1",
      userRequest: LIST_MESSAGE,
    });
    expect(session.taskScope).toBe("standard");

    const finale = finalizeQualityLoop(session, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("build");
    expect(finale.verdict.missing).toContain("test");
  });

  it("DOCTRINE: a build request still scopes full and cannot pass without evidence", () => {
    const session = startQualityLoopSession({
      runId: "run-build-1",
      projectId: "proj-1",
      userId: "user-1",
      userRequest:
        "Build a simple single-page landing site for a coffee roastery with a hero and a menu section.",
    });
    expect(session.taskScope).toBe("full");

    const finale = finalizeQualityLoop(session, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("build");
    expect(finale.verdict.missing).toContain("test");
  });

  it("an inspection scope survives the approval-pause snapshot round-trip", async () => {
    const { snapshotQualityLoopSession, restoreQualityLoopSession } = await import(
      "../quality-loop-flow"
    );
    const session = startQualityLoopSession({
      runId: "run-insp-3",
      projectId: "proj-1",
      userId: "user-1",
      userRequest: LIST_MESSAGE,
      taskScope: "inspection",
    });
    const restored = restoreQualityLoopSession(snapshotQualityLoopSession(session));
    expect(restored.taskScope).toBe("inspection");
  });
});
