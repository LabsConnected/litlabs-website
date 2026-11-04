// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "../workspace-transport";

/**
 * Regression: publish on the approval-resume path (golden 41861258628).
 *
 * Production sequence this reproduces:
 *   build (files.write + preview + read-back) → pause on image.generate →
 *   approve → resume → pause on project.deploy → approve → resume →
 *   deploy executes → finalize.
 *
 * At every pause the persisted qualityLoopState showed ALL 13 stages
 * pending: evidence queued behind the un-declared `understand` head. The
 * resume must restore that snapshot, execute the approved deploy, file
 * deploy/verify evidence from the REAL deployment result, and let the
 * system-recorded declaration fallback complete the cognitive stages —
 * while a genuinely failed deploy must still refuse the verdict.
 */

vi.mock("../llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...(await original() as Record<string, unknown>),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));

const deployUserProjectMock = vi.fn();
vi.mock("@/lib/deployments/deploy-service", () => ({
  deployUserProject: (...args: unknown[]) => deployUserProjectMock(...args),
}));
vi.mock("@/lib/deployments/deployment-store", () => ({
  supabaseDeploymentStore: {},
}));

import { resumeAgentLoopV2, type ResumeInput } from "../agent-loop-v2";
import { callLLMWithTools, buildAssistantToolCallMessage, type LLMMessage } from "../llm-tool-calling";
import {
  startQualityLoopSession,
  snapshotQualityLoopSession,
  restoreQualityLoopSession,
  finalizeQualityLoop,
  noteToolResult,
  notePreviewReady,
  noteStaticArtifactCheck,
  noteBuildArtifacts,
} from "../quality-loop-flow";

const USER_REQUEST =
  "Build me a complete coffee shop website called Ember Roast with a menu, story section, and contact page.";

function makeTransport(): WorkspaceTransport {
  return {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    createCheckpointBeforeMutation: vi.fn(async () => null),
    // verifyProjectArtifacts lists + reads the workspace to confirm a
    // runnable entry artifact exists.
    listFiles: vi.fn(async (path: string) => {
      if (path === ".") {
        return { entries: [
          { name: "index.html", type: "file" },
          { name: "styles.css", type: "file" },
          { name: "app.js", type: "file" },
        ] };
      }
      return { entries: [] };
    }),
    readFile: vi.fn(async () => ({
      content: "<html><body>Ember Roast coffee</body></html>",
      size: 48,
    })),
  } as unknown as WorkspaceTransport;
}

/**
 * The pause-time snapshot the golden persisted: a full-scope static build
 * whose machine evidence sits queued behind the pending `understand`
 * stage — all 13 stages pending, mutationSeen recorded.
 */
function makeAllPendingSnapshot() {
  const session = startQualityLoopSession({
    runId: "run-golden",
    projectId: "p-test",
    userId: "u-test",
    userRequest: USER_REQUEST,
    isStaticWorkspace: true,
  });
  noteToolResult(session, "files.write", {
    success: true,
    mutating: true,
    summary: "wrote index.html (6857 bytes)",
    result: { path: "index.html", saved: true },
  }, "ws-test");
  notePreviewReady(session, "https://preview.test/ws-test/");
  noteStaticArtifactCheck(session, { path: "index.html", contentMatches: true });
  const snapshot = snapshotQualityLoopSession(session);
  return snapshot;
}

function makeResume(overrides?: Partial<ResumeInput>): ResumeInput {
  const deployMsg = buildAssistantToolCallMessage(
    [{ toolId: "project.deploy", toolCallId: "tc-deploy-1", inputs: {} }],
    "Everything checks out — deploying the site.",
    undefined,
  );
  const pausedMessages: LLMMessage[] = [
    { role: "user", content: USER_REQUEST },
    deployMsg,
  ];
  return {
    pausedMessages,
    toolId: "project.deploy",
    toolCallId: "tc-deploy-1",
    inputs: {},
    decision: "approved",
    // The pre-pause mutation history the route seeds into the resume.
    priorToolCalls: [
      { toolId: "files.write", success: true, summary: "wrote index.html", mutating: true, paths: ["index.html"], persisted: true },
      { toolId: "image.generate", success: true, summary: "generated hero image", mutating: true, persisted: true },
    ],
    config: {
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
      userId: "u-test",
      isStaticWorkspace: true,
      qualityLoop: {
        enabled: true,
        runId: "resume:paused-1:1",
        projectId: "p-test",
        userId: "u-test",
        userRequest: USER_REQUEST,
        state: makeAllPendingSnapshot(),
      },
    },
    stepsUsedBeforePause: 6,
    hadInterveningMutation: true,
    ...overrides,
  };
}

describe("approval-resume publish — golden 41861258628 replay", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    deployUserProjectMock.mockReset();
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Your Ember Roast site is live.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "<html><body>Ember Roast coffee</body></html>",
    })));
  });

  it("reproduces the paused snapshot: all 13 stages pending behind understand", () => {
    const snapshot = makeAllPendingSnapshot();
    const pending = Object.values(snapshot.state.stages).filter((s) => s.status === "pending");
    expect(pending).toHaveLength(13);
    expect(snapshot.mutationSeen).toBe(true);
    expect(snapshot.observations.length).toBeGreaterThan(0);
  });

  it("approved project.deploy publishes: deploy+verify evidence files and the verdict passes", async () => {
    deployUserProjectMock.mockResolvedValue({
      ok: true,
      deploymentId: "dep_1",
      status: "ready",
      publicUrl: "https://sites.test/sites/dep_1/",
      urlVerified: true,
      target: "railway",
      projectId: "p-test",
      workspaceId: "ws-test",
      fileCount: 3,
      totalBytes: 9000,
      reused: false,
    });

    const result = await resumeAgentLoopV2(makeResume(), makeTransport());

    const deployCall = result.toolCalls.find((c) => c.toolId === "project.deploy");
    expect(deployCall?.success).toBe(true);
    expect(result.qualityLoop).toBeDefined();
    expect(result.qualityLoop?.verdict.ok).toBe(true);
    const stageStatus = (stage: string) =>
      result.qualityLoop?.stages.find((s) => s.stage === stage)?.status;
    expect(stageStatus("deploy")).toBe("passed");
    expect(stageStatus("verify")).toBe("passed");
    // Cognitive stages were system-recorded — never agent-fabricated.
    expect(stageStatus("understand")).toBe("passed");
    expect(stageStatus("build")).toBe("passed");
    expect(result.qualityLoopState).toBeDefined();
  });

  it("the route boundary re-finalization keeps the passing verdict", async () => {
    deployUserProjectMock.mockResolvedValue({
      ok: true,
      deploymentId: "dep_1",
      status: "ready",
      publicUrl: "https://sites.test/sites/dep_1/",
      urlVerified: true,
      target: "railway",
      projectId: "p-test",
      workspaceId: "ws-test",
      fileCount: 3,
      totalBytes: 9000,
      reused: false,
    });

    const result = await resumeAgentLoopV2(makeResume(), makeTransport());
    expect(result.qualityLoopState).toBeDefined();

    // Mirrors route.ts ~869-895: restore the resumed snapshot, file the
    // boundary preview/artifact evidence, and re-finalize.
    const session = restoreQualityLoopSession(result.qualityLoopState!);
    noteBuildArtifacts(session, ["index.html", "styles.css", "app.js"]);
    notePreviewReady(session, "https://preview.test/ws-test/");
    const finale = finalizeQualityLoop(session, { deployRequested: true });

    expect(finale.verdict.ok).toBe(true);
  });

  it("a genuinely failed deploy still refuses the verdict (golden failure honesty)", async () => {
    // The dead RAILWAY_API_TOKEN case: hosting cannot resolve a base URL,
    // the deployment never happens, and the gate must say so.
    deployUserProjectMock.mockResolvedValue({
      ok: false,
      deploymentId: null,
      status: "failed",
      message: "LiTT Hosting isn't set up for this deployment target.",
      errorClass: "unconfigured",
      retryable: false,
    });

    const result = await resumeAgentLoopV2(makeResume(), makeTransport());

    const deployCall = result.toolCalls.find((c) => c.toolId === "project.deploy");
    expect(deployCall?.success).toBe(false);
    expect(result.qualityLoop?.verdict.ok).toBe(false);
    const stageStatus = (stage: string) =>
      result.qualityLoop?.stages.find((s) => s.stage === stage)?.status;
    expect(stageStatus("deploy")).not.toBe("passed");
    // The fallback still files the cognitive stages — the refusal is the
    // missing machine evidence, not bookkeeping.
    expect(stageStatus("understand")).toBe("passed");
  });
});
