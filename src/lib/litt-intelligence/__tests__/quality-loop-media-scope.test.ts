/**
 * LION-RUN-DIAGNOSIS-2026-11-16 Q1/F1a — quality-gate scoping for
 * media-generation runs.
 *
 * Live defect (production 280035ab, 2026-11-16): "Need a picture of a
 * lion" generated successfully — image.generate completed and the
 * image was saved — but the quality session had no media signal: the
 * kernel's media group carried no taskKind, so the session fell back
 * to the prose classifier, which has no media case and defaulted the
 * turn to the "standard" build scope. The gate then demanded build/
 * test evidence a one-image ask can never produce and the successful
 * generation was reported as a failed run. The kernel now classifies
 * the turn taskKind "media", threaded in as the session's "media"
 * scope; the gate must honor THAT system signal.
 *
 * Doctrine pin (must hold before AND after): with no media signal,
 * the same request text still scopes "standard" and the gate still
 * fails without build/test evidence.
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

const LION_MESSAGE = "Need a picture of a lion";

describe("quality loop — media task scope", () => {
  it("the media scope requires only the system-filed cognitive stages", () => {
    expect(REQUIRED_STAGES_BY_SCOPE.media).toEqual(["understand", "plan"]);
  });

  it("a session created with the kernel's media scope passes its gate on the evidence a generation produces", () => {
    const session = startQualityLoopSession({
      runId: "run-media-1",
      projectId: "proj-1",
      userId: "user-1",
      userRequest: LION_MESSAGE,
      taskScope: "media",
    });
    expect(session.taskScope).toBe("media");

    const finale = finalizeQualityLoop(session, { deployRequested: false });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).toEqual([]);
    // Out-of-scope stages are recorded skips, never silent omissions.
    const build = finale.stages.find((s) => s.stage === "build");
    const test = finale.stages.find((s) => s.stage === "test");
    expect(build?.status).toBe("skipped");
    expect(test?.status).toBe("skipped");
  });

  it("CONTROL: without the media signal, the same request still scopes standard and the gate still fails on build/test", () => {
    const session = startQualityLoopSession({
      runId: "run-media-2",
      projectId: "proj-1",
      userId: "user-1",
      userRequest: LION_MESSAGE,
    });
    expect(session.taskScope).toBe("standard");

    const finale = finalizeQualityLoop(session, { deployRequested: false });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("build");
    expect(finale.verdict.missing).toContain("test");
  });
});
