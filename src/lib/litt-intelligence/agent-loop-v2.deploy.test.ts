import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Agent-loop continuation around the deployment tool.
 *
 * The V1 journey is build → deploy → live URL, which requires the loop to
 * hand the deployment tool RESULT back to the model so the closing answer can
 * cite the verified URL. These tests pin that continuation, and pin that a
 * provider failure after a successful deployment neither repeats the
 * deployment nor loses the URL.
 */

// Hoisted: vi.mock factories are lifted above module scope, so the spies
// must be created in a hoisted block to exist by the time they run.
const { callLLMWithTools, execute } = vi.hoisted(() => ({
  callLLMWithTools: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("./llm-tool-calling", async () => {
  const actual = await vi.importActual<typeof import("./llm-tool-calling")>("./llm-tool-calling");
  return { ...actual, callLLMWithTools };
});

vi.mock("./tool-registry", () => ({
  toolRegistry: {
    listEnabled: () => [
      {
        id: "project.deploy",
        name: "Deploy Project",
        description: "Deploy the user's project to a public URL",
        inputSchema: { type: "object", properties: {}, required: [] },
        readOnly: false,
        enabled: true,
        risk: "high",
        requiredPermissions: ["deploy:create"],
        permissionLevel: "workspace-write",
        approvalPolicy: { required: true, autoApproveReadOnly: false, requireExplicitForMutations: true, neverAllow: false },
      },
      {
        id: "files.write",
        name: "Write File",
        description: "Write a file",
        inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
        readOnly: false,
        enabled: true,
        risk: "high",
        requiredPermissions: ["files:write"],
        permissionLevel: "workspace-write",
        approvalPolicy: { required: true, autoApproveReadOnly: false, requireExplicitForMutations: true, neverAllow: false },
      },
      {
        id: "files.delete",
        name: "Delete File",
        description: "Delete a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        readOnly: false,
        enabled: true,
        risk: "high",
        requiredPermissions: ["files:write"],
        permissionLevel: "workspace-write",
        approvalPolicy: { required: true, autoApproveReadOnly: false, requireExplicitForMutations: true, neverAllow: false },
      },
    ],
    execute,
    validateInputs: () => null,
    get: (id: string) => ({ id, readOnly: false }),
    // agent-loop-v2 calls registerAllStationActions() at module scope, which
    // registers on the real ToolRegistry — the mock must expose register too.
    register: () => {},
  },
}));

// The build-fix loop is irrelevant here and would make real check calls.
vi.mock("./build-fix-loop", () => ({
  runBuildFixLoop: vi.fn(async () => ({ ran: false, attempts: 0, fixed: false })),
}));

import { runAgentLoopV2, resumeAgentLoopV2 } from "./agent-loop-v2";
import type { WorkspaceTransport } from "./workspace-transport";

const NEWLINE = String.fromCharCode(10);
const LIVE_URL = "https://litlabs.example/sites/dep_abc123/";
const STABLE_URL = "https://litlabs.example/sites/project/proj_ember/";

function transport(): WorkspaceTransport {
  return {
    userId: "user_owner",
    projectId: "proj_ember",
    workspaceId: "ws_ember",
    workspaceRoot: "/workspace/ember",
    createCheckpointBeforeMutation: vi.fn(async () => null),
  } as unknown as WorkspaceTransport;
}

/** AUTO mode so mutations do not pause for approval. */
const config = {
  systemPrompt: "you are litt",
  executionMode: "auto" as const,
  enableBuildFix: false,
  maxSteps: 6,
};

/** The deploy tool's successful result, as the real handler returns it. */
const deploySuccess = {
  success: true,
  deployment: {
    deploymentId: "dep_abc123",
    status: "ready",
    publicUrl: LIVE_URL,
    urlVerified: true,
    target: "litt-static",
    projectId: "proj_ember",
    workspaceId: "ws_ember",
    fileCount: 2,
    totalBytes: 120,
    reused: false,
  },
  liveUrl: LIVE_URL,
  stablePublicUrl: STABLE_URL,
};

beforeEach(() => {
  callLLMWithTools.mockReset();
  execute.mockReset();
});

/* ── Deployment requires approval ───────────────────────────────── */

describe("deployment is gated behind explicit approval", () => {
  it("pauses for approval instead of publishing, even in AUTO mode", async () => {
    callLLMWithTools.mockResolvedValueOnce({
      text: "I'll deploy it now.",
      toolCalls: [{ toolCallId: "c1", toolId: "project.deploy", inputs: {} }],
      model: "test-model",
    });

    const result = await runAgentLoopV2("deploy it live", transport(), config);

    // Nothing was published: the tool never executed.
    expect(execute).not.toHaveBeenCalled();
    expect(result.pendingApproval?.toolId).toBe("project.deploy");
    // And no live URL is claimed while awaiting approval.
    expect(result.finalText).not.toMatch(/\/sites\//);
  });

  it("does not deploy when the user rejects the approval", async () => {
    callLLMWithTools.mockResolvedValueOnce({
      text: "Understood — not deploying.",
      toolCalls: [],
      model: "test-model",
    });

    const result = await resumeAgentLoopV2(
      {
        pausedMessages: [{ role: "user", content: "deploy it live" }],
        toolId: "project.deploy",
        toolCallId: "c1",
        inputs: {},
        decision: "rejected",
        rejectionReason: "not yet",
        config,
        stepsUsedBeforePause: 1,
        hadInterveningMutation: true,
      },
      transport(),
    );

    expect(execute).not.toHaveBeenCalled();
    const deployCall = result.toolCalls.find((c) => c.toolId === "project.deploy");
    expect(deployCall?.success).toBe(false);
    expect(result.finalText).not.toMatch(/is live|deployed successfully/i);
  });
});

/* ── Case H: the model's next turn receives the deployment result ── */

describe("H. the model's next turn receives the deployment result and URL", () => {
  function approvedDeploy(over: Partial<Parameters<typeof resumeAgentLoopV2>[0]> = {}) {
    return {
      pausedMessages: [{ role: "user" as const, content: "deploy it live" }],
      toolId: "project.deploy",
      toolCallId: "c1",
      inputs: {},
      decision: "approved" as const,
      config,
      stepsUsedBeforePause: 1,
      hadInterveningMutation: true,
      ...over,
    };
  }

  it("passes the live URL back into the following model call", async () => {
    execute.mockResolvedValue({ ok: true, result: deploySuccess });
    callLLMWithTools.mockResolvedValueOnce({
      text: `Your site is live at ${LIVE_URL}`,
      toolCalls: [],
      model: "test-model",
    });

    const result = await resumeAgentLoopV2(approvedDeploy(), transport());

    expect(callLLMWithTools).toHaveBeenCalledTimes(1);
    const messages = callLLMWithTools.mock.calls[0][1] as Array<{ content: string }>;
    const conversation = messages.map((m) => m.content).join(NEWLINE);
    expect(conversation).toContain("dep_abc123");
    expect(conversation).toContain(LIVE_URL);
    expect(result.finalText).toContain(LIVE_URL);
  });

  it("ACC-05: the settled reply always carries the stable URL, even when the model cites only the deployment URL", async () => {
    // Acceptance Run 1 on 8935b2a9: the transport-only chat deploy
    // succeeded, but the reply reported ONLY the /sites/<deploymentId>/
    // URL — the stable /sites/project/<id>/ address existed in the tool
    // result and the model simply didn't cite it. The loop guarantees
    // the stable URL in the settled text, the same way it guarantees
    // generated images render (appendChatImagesToFinalText).
    execute.mockResolvedValue({ ok: true, result: deploySuccess });
    callLLMWithTools.mockResolvedValueOnce({
      text: `The project is deployed and live at ${LIVE_URL}.`,
      toolCalls: [],
      model: "test-model",
    });

    const result = await resumeAgentLoopV2(approvedDeploy(), transport());

    expect(result.finalText).toContain(LIVE_URL);
    expect(result.finalText).toContain(STABLE_URL);
  });

  it("ACC-05: the stable URL is not duplicated when the model's reply already cites it", async () => {
    execute.mockResolvedValue({ ok: true, result: deploySuccess });
    callLLMWithTools.mockResolvedValueOnce({
      text: `Live at ${LIVE_URL} — stable address: ${STABLE_URL}`,
      toolCalls: [],
      model: "test-model",
    });

    const result = await resumeAgentLoopV2(approvedDeploy(), transport());

    expect(result.finalText.split(STABLE_URL).length - 1).toBe(1);
  });

  it("records the deploy call as a successful mutating step", async () => {
    execute.mockResolvedValue({ ok: true, result: deploySuccess });
    callLLMWithTools.mockResolvedValueOnce({ text: `Live: ${LIVE_URL}`, toolCalls: [], model: "test-model" });

    const result = await resumeAgentLoopV2(approvedDeploy(), transport());
    const deployCall = result.toolCalls.find((c) => c.toolId === "project.deploy");
    expect(deployCall).toBeDefined();
    expect(deployCall?.success).toBe(true);
    expect(deployCall?.mutating).toBe(true);
  });
});

/* ── Case B: build happened, deploy tool never ran ──────────────── */

describe("B. a build with no deploy call leaves no deployment evidence", () => {
  it("logs only the file write, never a deployment", async () => {
    execute.mockResolvedValue({ ok: true, result: { success: true, path: "index.html" } });
    callLLMWithTools
      .mockResolvedValueOnce({
        text: "Writing the page.",
        toolCalls: [{ toolCallId: "c1", toolId: "files.write", inputs: { path: "index.html", content: "<h1>hi</h1>" } }],
        model: "test-model",
      })
      .mockResolvedValueOnce({ text: "Built the page.", toolCalls: [], model: "test-model" });

    const result = await runAgentLoopV2("build a landing page", transport(), config);

    expect(result.toolCalls.map((c) => c.toolId)).toEqual(["files.write"]);
    expect(result.toolCalls.some((c) => c.toolId === "project.deploy")).toBe(false);
    expect(result.finalText).not.toMatch(/deployed|live at/i);
  });
});

/* ── Case ACC-10: a build run must not deploy uninvited ─────────── */

describe("ACC-10 Defect 2 — a run whose instruction never asked to deploy cannot deploy", () => {
  it("refuses a project.deploy call chained onto a build ask — no approval, no execution", async () => {
    execute.mockResolvedValue({ ok: true, result: { success: true, path: "index.html" } });
    callLLMWithTools
      .mockResolvedValueOnce({
        text: "Writing the page.",
        toolCalls: [{ toolCallId: "c1", toolId: "files.write", inputs: { path: "index.html", content: "<h1>hi</h1>" } }],
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "Now I will publish it.",
        toolCalls: [{ toolCallId: "c2", toolId: "project.deploy", inputs: { projectId: "proj_ember" } }],
        model: "test-model",
      })
      .mockResolvedValueOnce({ text: "Built the page.", toolCalls: [], model: "test-model" });

    const result = await runAgentLoopV2("build a landing page", transport(), config);

    // The deploy never executed and never became an approval card.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.pendingApproval).toBeUndefined();
    const refusal = result.toolCalls.find((t) => t.toolId === "project.deploy");
    expect(refusal?.success).toBe(false);
    expect(refusal?.summary).toMatch(/did not ask to deploy/i);
    // The build itself stands, reported as built — not published.
    expect(result.toolCalls.map((c) => c.toolId)).toContain("files.write");
    expect(result.finalText).toBe("Built the page.");
  });

  it("still deploys when the instruction asks for it alongside content work", async () => {
    callLLMWithTools.mockResolvedValueOnce({
      text: "",
      toolCalls: [{ toolCallId: "c1", toolId: "project.deploy", inputs: { projectId: "proj_ember" } }],
      model: "test-model",
    });

    const result = await runAgentLoopV2("build a landing page and deploy it", transport(), config);

    // Mixed ask: deploy keeps its own approval gate, exactly as before.
    expect(result.pendingApproval?.toolId).toBe("project.deploy");
  });
});

/* ── Case I: provider dies AFTER a successful deployment ─────────── */

describe("I. a provider failure after deployment neither repeats nor loses it", () => {
  function approvedDeploy() {
    return {
      pausedMessages: [{ role: "user" as const, content: "deploy it live" }],
      toolId: "project.deploy",
      toolCallId: "c1",
      inputs: {},
      decision: "approved" as const,
      config,
      stepsUsedBeforePause: 1,
      hadInterveningMutation: true,
    };
  }

  it("does not call the deploy tool twice", async () => {
    execute.mockResolvedValue({ ok: true, result: deploySuccess });
    callLLMWithTools.mockRejectedValue(new Error("All tool-calling models failed"));

    const result = await resumeAgentLoopV2(approvedDeploy(), transport());

    const deployCalls = execute.mock.calls.filter((c) => c[0] === "project.deploy");
    expect(deployCalls).toHaveLength(1);
    expect(result.toolCalls.filter((c) => c.toolId === "project.deploy")).toHaveLength(1);
  });

  it("still reports the verified live URL rather than only an error", async () => {
    execute.mockResolvedValue({ ok: true, result: deploySuccess });
    callLLMWithTools.mockRejectedValue(new Error("All tool-calling models failed"));

    const result = await resumeAgentLoopV2(approvedDeploy(), transport());

    // The user's site IS live — losing the URL to a provider error would
    // hide completed work. The URL reported is the deployment's STABLE
    // public URL (ACC-03 item 1: readDeploymentOutcome prefers it over
    // the per-deployment snapshot URL, which this fixture's deploy
    // result now carries like the real handler's).
    expect(result.finalText).toContain(STABLE_URL);
    expect(result.finalText).toMatch(/live/i);
  });

  it("does not claim a live URL when the deployment itself failed", async () => {
    execute.mockResolvedValue({
      ok: true,
      result: {
        success: false,
        deployment: { deploymentId: "dep_x", status: "failed", publicUrl: null },
        errorClass: "validation",
        error: "Deployment artifact must contain an index.html entrypoint.",
        retryable: false,
      },
    });
    callLLMWithTools.mockRejectedValue(new Error("All tool-calling models failed"));

    const result = await resumeAgentLoopV2(approvedDeploy(), transport());

    expect(result.finalText).not.toMatch(/https?:\/\/\S*\/sites\//);
    expect(result.finalText).not.toMatch(/is live|deployed successfully/i);
  });

  // ── ACC-03 item 1: deploy is transport, not a build ──────────────
  // Run 1 on 055ae851: the Deploy surface's hand-off prefilled
  // "Deploy this project to production" and the run answered by
  // regenerating index.html through five approved writes before
  // publishing. A deploy-only run must not be ABLE to write content.
  it("refuses a content write in a deploy-only run and still reaches the deploy approval", async () => {
    callLLMWithTools
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            toolCallId: "tc-write",
            toolId: "files.write",
            inputs: { projectId: "proj_ember", path: "index.html", content: "<html>rewritten</html>" },
          },
        ],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          { toolCallId: "tc-deploy", toolId: "project.deploy", inputs: { projectId: "proj_ember" } },
        ],
        finishReason: "tool_calls",
        model: "test-model",
      });

    const result = await runAgentLoopV2(
      "Deploy this project to production",
      transport(),
      { ...config },
    );

    // The write was refused before execution: the registry never ran
    // ANY tool, and the refusal was logged as a non-mutating failure.
    expect(execute).not.toHaveBeenCalled();
    const refusal = result.toolCalls.find((t) => t.toolId === "files.write");
    expect(refusal?.success).toBe(false);
    expect(refusal?.summary).toMatch(/deploy-only/i);
    // The run proceeded to the deploy itself, which pauses for its
    // approval exactly as before.
    expect(result.pendingApproval?.toolId).toBe("project.deploy");
  });

  // Greptile (PR #1108): the guard's original hand-picked set left
  // files.delete / files.rename executable in a deploy-only run —
  // publishing could still REMOVE content. The blocked set is now
  // derived from the registry's readOnly metadata.
  it("refuses a file deletion in a deploy-only run and still reaches the deploy approval", async () => {
    callLLMWithTools
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          {
            toolCallId: "tc-delete",
            toolId: "files.delete",
            inputs: { projectId: "proj_ember", path: "index.html" },
          },
        ],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          { toolCallId: "tc-deploy", toolId: "project.deploy", inputs: { projectId: "proj_ember" } },
        ],
        finishReason: "tool_calls",
        model: "test-model",
      });

    const result = await runAgentLoopV2(
      "Deploy this project to production",
      transport(),
      { ...config },
    );

    expect(execute).not.toHaveBeenCalled();
    const refusal = result.toolCalls.find((t) => t.toolId === "files.delete");
    expect(refusal?.success).toBe(false);
    expect(refusal?.summary).toMatch(/deploy-only/i);
    expect(result.pendingApproval?.toolId).toBe("project.deploy");
  });

  it("reports the STABLE project URL after an approved deploy, not the per-deployment URL", async () => {
    const STABLE_URL = "https://litlabs.example/sites/project/proj_ember/";
    execute.mockResolvedValue({
      ok: true,
      result: { ...deploySuccess, stablePublicUrl: STABLE_URL },
    });
    callLLMWithTools.mockRejectedValue(new Error("All tool-calling models failed"));

    const result = await resumeAgentLoopV2(approvedDeploy(), transport());

    expect(result.finalText).toContain(STABLE_URL);
    expect(result.finalText).not.toContain(LIVE_URL);
  });
});

/* ── Case II: milestone-aware settlement — timeout and retry ─────────
 *
 * P0 hardening (2026-11-27): the deployment-verification gate
 * (run-settlement.ts deploymentRequired/deploymentVerified) already
 * covers plain failure, cancellation and success. These two cases
 * pin the remaining asked-for scenarios: a deploy that TIMES OUT
 * must settle exactly like any other unverified deploy (no special
 * leniency for "it might still be running"), and a deploy that
 * FAILS then is RETRIED and succeeds must settle on the retry's
 * verified evidence, not be poisoned by the earlier failed attempt.
 */

describe("II. milestone-aware settlement: timeout and retry", () => {
  function approvedDeploy(toolCallId = "c1") {
    return {
      pausedMessages: [{ role: "user" as const, content: "deploy it live" }],
      toolId: "project.deploy",
      toolCallId,
      inputs: {},
      decision: "approved" as const,
      config,
      stepsUsedBeforePause: 1,
      hadInterveningMutation: true,
    };
  }

  it("a deploy that times out settles exactly like any other unverified deploy — no leniency", async () => {
    execute.mockResolvedValue({
      ok: true,
      result: {
        success: false,
        deployment: { deploymentId: "dep_timeout", status: "building", publicUrl: null },
        errorClass: "timeout",
        error: "Deployment timed out waiting for build output after 60000ms.",
        retryable: true,
      },
    });
    callLLMWithTools.mockRejectedValue(new Error("All tool-calling models failed"));

    const result = await resumeAgentLoopV2(approvedDeploy(), transport());

    expect(result.deployment ?? null).toBeNull();
    expect(result.finalText).not.toMatch(/https?:\/\/\S*\/sites\//);
    expect(result.finalText).not.toMatch(/is live|deployed successfully/i);
    const missing = (result.failureContributors ?? []).find((c) => c.kind === "deployment_missing");
    expect(missing).toBeDefined();
  });

  it("a failed deploy that is then retried settles on the retry's verified evidence, not the earlier failure", async () => {
    // Attempt 1: the same pause/approve/resume cycle a real retry goes
    // through — the user (or the model, on being told it failed) asks
    // again and a fresh approval authorizes a second project.deploy.
    execute.mockResolvedValueOnce({
      ok: true,
      result: {
        success: false,
        deployment: { deploymentId: "dep_try1", status: "failed", publicUrl: null },
        errorClass: "transport",
        error: "Deployment transport unavailable.",
        retryable: true,
      },
    });
    callLLMWithTools.mockRejectedValue(new Error("All tool-calling models failed"));

    const firstAttempt = await resumeAgentLoopV2(approvedDeploy("c1"), transport());
    expect(firstAttempt.deployment ?? null).toBeNull();
    expect(
      (firstAttempt.failureContributors ?? []).some((c) => c.kind === "deployment_missing"),
    ).toBe(true);

    // Attempt 2 (the retry): a fresh approved deploy call succeeds with
    // R8-verified evidence.
    execute.mockReset();
    execute.mockResolvedValueOnce({ ok: true, result: deploySuccess });
    callLLMWithTools.mockRejectedValue(new Error("All tool-calling models failed"));

    const retry = await resumeAgentLoopV2(approvedDeploy("c2"), transport());

    expect(retry.deployment).toBeDefined();
    expect(retry.deployment!.deploymentId).toBe("dep_abc123");
    expect(retry.finalText).toContain(STABLE_URL);
    expect(
      (retry.failureContributors ?? []).some((c) => c.kind === "deployment_missing"),
    ).toBe(false);
  });
});
