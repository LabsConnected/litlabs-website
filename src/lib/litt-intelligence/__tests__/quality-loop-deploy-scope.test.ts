/**
 * ACC-05 item 3 — quality-gate scoping for deploy-only runs.
 *
 * Live defect (Acceptance Run 1 on 8935b2a9, 2026-11-24): the
 * transport-only chat deploy completed — the deployment succeeded and
 * its evidence was recorded — yet the run's Activity also logged
 * "Quality gate failed: Cannot declare success (task scope:
 * standard): 3 required stage(s) lack evidence". The session had no
 * deploy signal, so the prose classifier defaulted the turn to the
 * "standard" build scope and the gate demanded build/test evidence a
 * publish of the unchanged workspace can never produce. The route
 * now assigns the system-determined "deploy" scope from the same
 * deterministic deploy-only classifier that gates the run's tools
 * (deploy-intent.ts) — never from the agent, never from prose
 * classification of the request as a build.
 *
 * Doctrine pin (must hold before AND after): with no deploy signal,
 * the same request text still scopes by the prose classifier and the
 * gate still fails without build/test evidence.
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

import { finalizeQualityLoop, noteDeployment, startQualityLoopSession, verifyLiveUrl } from "../quality-loop-flow";
import { REQUIRED_STAGES_BY_SCOPE } from "../quality-loop";
import { verifyProductionUrl } from "../deploy";

const mockVerifyUrl = vi.mocked(verifyProductionUrl);

const DEPLOY_MESSAGE = "Deploy this project";

describe("quality loop — deploy task scope (ACC-05)", () => {
  it("the deploy scope requires only the system-filed cognitive stages", () => {
    expect(REQUIRED_STAGES_BY_SCOPE.deploy).toEqual(["understand", "plan"]);
  });

  it("a session created with the system deploy scope passes its gate when the deploy completes", async () => {
    const session = startQualityLoopSession({
      runId: "run-deploy-1",
      projectId: "proj-1",
      userId: "user-1",
      userRequest: DEPLOY_MESSAGE,
      taskScope: "deploy",
    });
    expect(session.taskScope).toBe("deploy");

    // The loop's own deployment evidence, filed exactly as
    // finalizeQualityGatedRun files it for a completed deploy.
    noteDeployment(session, "https://example.test/sites/project/proj-1/");
    mockVerifyUrl.mockResolvedValue({
      success: true,
      detail: "GET https://example.test/sites/project/proj-1/ returned HTTP 200",
      url: "https://example.test/sites/project/proj-1/",
    } as Awaited<ReturnType<typeof verifyProductionUrl>>);
    await verifyLiveUrl(session, "https://example.test/sites/project/proj-1/");

    const finale = finalizeQualityLoop(session, { deployRequested: true });
    expect(finale.verdict.ok).toBe(true);
    expect(finale.verdict.missing).toEqual([]);
    // Build/test are recorded skips, never silent omissions.
    const build = finale.stages.find((s) => s.stage === "build");
    const test = finale.stages.find((s) => s.stage === "test");
    expect(build?.status).toBe("skipped");
    expect(test?.status).toBe("skipped");
  });

  it("CONTROL: without the deploy signal, the gate still scopes standard and fails on build/test", () => {
    const session = startQualityLoopSession({
      runId: "run-deploy-2",
      projectId: "proj-1",
      userId: "user-1",
      userRequest: DEPLOY_MESSAGE,
    });
    expect(session.taskScope).toBe("standard");

    const finale = finalizeQualityLoop(session, { deployRequested: true });
    expect(finale.verdict.ok).toBe(false);
    expect(finale.verdict.missing).toContain("build");
    expect(finale.verdict.missing).toContain("test");
  });
});
