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
    ],
    execute,
    validateInputs: () => null,
    get: (id: string) => ({ id, readOnly: false }),
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
    // hide completed work.
    expect(result.finalText).toContain(LIVE_URL);
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
});
