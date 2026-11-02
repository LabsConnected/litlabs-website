// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * End-to-end wiring test for the approval POST route: unlike
 * route.test.ts (which mocks resumeAgentLoopV2), this exercises the REAL
 * resumeAgentLoopV2 against a fake workspace transport, proving that an
 * approved gate actually executes the frozen mutation and records
 * completion — the exact contract production broke on 2026-09-16
 * (approval recorded, run went Idle, mkdir never executed).
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/litt-intelligence/paused-run-store", () => ({
  getPausedRun: vi.fn(),
  resolvePausedRun: vi.fn(),
  markRunProcessing: vi.fn(),
  verifyRunClaim: vi.fn(() => Promise.resolve(true)),
  releaseRunClaim: vi.fn(() => Promise.resolve(true)),
  updatePausedRunActionRun: vi.fn(() => Promise.resolve(true)),
  getRunOutcomeForPausedRun: vi.fn(),
  createPausedRun: vi.fn(),
  renewRunLease: vi.fn(() => Promise.resolve(true)),
  RUN_HEARTBEAT_MS: 30_000,
  resetRunForRetry: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("@/lib/action-runtime", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getActionRun: vi.fn(() => Promise.resolve({ id: "run-parent-1", status: "waiting_for_user" })),
    transitionActionRunEventActivity: vi.fn(() => Promise.resolve({ id: "run-parent-1", status: "completed" })),
    // Preview runtime events fired by the real launch-flow: persistence is
    // out of scope for this wiring test.
    recordActionEventActivity: vi.fn(() => Promise.resolve({})),
  };
});

// The real resumeAgentLoopV2 drives the real tool registry, which records
// per-tool events on the canonical run. Persistence is out of scope for
// this wiring test — stub the tool-event sink so the mutation executes.
vi.mock("@/lib/action-runtime/tool-runtime", () => ({
  actionToolResultFailed: vi.fn(() => null),
  recordActionToolStarted: vi.fn(() => Promise.resolve({})),
  recordActionToolCompleted: vi.fn(() => Promise.resolve({})),
  recordActionToolFailed: vi.fn(() => Promise.resolve({})),
  markActionToolRunPersistenceDegraded: vi.fn(() => Promise.resolve()),
}));

const mkdirCalls: string[] = [];
vi.mock("@/lib/litt-intelligence/workspace-transport", () => ({
  createWorkspaceTransport: vi.fn(() =>
    Promise.resolve({
      workspaceId: "ws-123",
      userId: "user_123",
      workspaceRoot: "/tmp/test",
      projectId: "proj-123",
      writeFile: vi.fn(async () => ({ saved: true })),
      readFile: vi.fn(async () => ({ content: "<html><body>Built site</body></html>", size: 40 })),
      mkdir: vi.fn(async (path: string) => {
        mkdirCalls.push(path);
        return { created: true };
      }),
      listFiles: vi.fn(async () => ({ entries: [{ name: "index.html", type: "file" }] })),
      startPreview: vi.fn(async () => ({ status: "ready" })),
      getPreviewStatus: vi.fn(async () => ({ status: "ready" })),
      createCheckpointBeforeMutation: vi.fn(async () => null),
      discoverPackageInfo: vi.fn(async () => ({ packageManager: "npm", hasBuild: false })),
      runCheck: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false })),
    }),
  ),
}));

vi.mock("@/lib/litt-intelligence/llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(() => Promise.resolve(null)),
  verifyProjectWorkspace: vi.fn(() =>
    Promise.resolve({ workspaceId: "ws-123", workspaceRoot: "/tmp/test" }),
  ),
}));

vi.mock("@/lib/studio/conversation-service", () => ({
  getAwaitingApprovalAssistantMessage: vi.fn(() => Promise.resolve(null)),
  insertMessage: vi.fn(),
  updateMessageStatus: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/lib/studio/logger", () => ({
  studioLog: vi.fn(),
}));
vi.mock("@/lib/studio/task-service", () => ({
  attachActionRunToConversationTask: vi.fn(() => Promise.resolve()),
  settleConversationTask: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/litt-intelligence/quality-loop-flow", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  shouldEnableQualityLoop: vi.fn(() => false),
}));

import { auth } from "@/lib/auth";
import { POST } from "./route";
import { getProject } from "@/lib/projects/project-repository";
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
  verifyRunClaim,
  releaseRunClaim,
  createPausedRun,
} from "@/lib/litt-intelligence/paused-run-store";
import { callLLMWithTools, buildAssistantToolCallMessage } from "@/lib/litt-intelligence/llm-tool-calling";
import { transitionActionRunEventActivity } from "@/lib/action-runtime";

const CONV_ID = "conv-123";
const PAUSED_ID = "paused-1";

function makeRequest(decision: "approved" | "rejected"): NextRequest {
  return new NextRequest(
    `http://localhost/api/studio/conversations/${CONV_ID}/approvals/${PAUSED_ID}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    },
  );
}

const routeParams = { params: Promise.resolve({ conversationId: CONV_ID, pausedRunId: PAUSED_ID }) };

function pendingRun() {
  return {
    id: PAUSED_ID,
    userId: "user_123",
    conversationId: CONV_ID,
    projectId: "proj-123",
    workspaceId: "ws-123",
    toolId: "files.mkdir",
    toolCallId: "tc-mkdir-1",
    inputs: { path: "src/app/(marketing)/roofing" },
    reason: "Mutation requires approval in ACT mode",
    pausedMessages: [
      { role: "user", content: "Build a roofing site" },
      buildAssistantToolCallMessage(
        [{ toolId: "files.mkdir", toolCallId: "tc-mkdir-1", inputs: { path: "src/app/(marketing)/roofing" } }],
        "Creating the roofing directory.",
        undefined,
      ),
    ],
    executionMode: "act",
    systemPrompt: "You are LiTT.",
    checkpointId: null,
    actionRunId: "run-parent-1",
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    resolvedAt: null,
    runStatus: null,
    runResult: null,
    runError: null,
    runStartedAt: null,
    runCompletedAt: null,
  };
}

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("POST approval → real resume executes the approved mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdirCalls.length = 0;
    vi.mocked(getProject).mockResolvedValue(null);
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as never);
    vi.mocked(getPausedRun).mockResolvedValue(pendingRun() as never);
    vi.mocked(resolvePausedRun).mockImplementation(async () => pendingRun() as never);
    vi.mocked(markRunProcessing).mockResolvedValue(true);
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Directory created.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    } as never);
  });

  it("completes a static file approval without shell checks or a preview process", async () => {
    vi.mocked(getProject).mockResolvedValue({ framework: "static" } as never);
    const run = {
      ...pendingRun(), toolId: "files.write", toolCallId: "tc-write-1",
      inputs: { projectId: "proj-123", path: "index.html", content: "<html><body>Built site</body></html>" },
      pausedMessages: [
        { role: "user" as const, content: "Build a roofing site" },
        buildAssistantToolCallMessage([{ toolId: "files.write", toolCallId: "tc-write-1", inputs: { projectId: "proj-123", path: "index.html", content: "<html><body>Built site</body></html>" } }], "Writing the site.", undefined),
      ],
    };
    vi.mocked(getPausedRun).mockResolvedValue(run as never);
    vi.mocked(resolvePausedRun).mockResolvedValue(run as never);
    expect((await POST(makeRequest("approved"), routeParams)).status).toBe(202);
    await waitFor(() => vi.mocked(transitionActionRunEventActivity).mock.calls.some((c) => c[0].status === "completed"));
    const transport = await vi.mocked(createWorkspaceTransport).mock.results[0].value;
    expect(transport.writeFile).toHaveBeenCalledTimes(1);
    expect(transport.writeFile).toHaveBeenCalledWith("index.html", run.inputs.content);
    expect(transport.discoverPackageInfo).not.toHaveBeenCalled();
    expect(transport.startPreview).not.toHaveBeenCalled();
    expect(transport.getPreviewStatus).not.toHaveBeenCalled();
    expect(vi.mocked(transitionActionRunEventActivity).mock.calls.some((c) => c[0].status === "failed")).toBe(false);
  });

  it("returns 202 and the detached resume executes files.mkdir, then settles the canonical run", async () => {
    const resp = await POST(makeRequest("approved"), routeParams);
    expect(resp.status).toBe(202);

    await waitFor(() =>
      vi.mocked(transitionActionRunEventActivity).mock.calls.some(
        (c) => (c[0] as { status?: string }).status === "completed",
      ),
    );
    expect(mkdirCalls).toEqual(["src/app/(marketing)/roofing"]);
    expect(
      vi.mocked(transitionActionRunEventActivity).mock.calls.some(
        (c) => (c[0] as { status?: string }).status === "failed",
      ),
    ).toBe(false);

    const completedCall = vi.mocked(transitionActionRunEventActivity).mock.calls.find(
      (c) => (c[0] as { status?: string }).status === "completed",
    )![0] as { payload?: { result?: { toolCalls?: Array<{ toolId: string; success: boolean; mutating: boolean }> } } };
    const mkdirLog = (completedCall.payload?.result?.toolCalls ?? []).filter(
      (c) => c.toolId === "files.mkdir",
    );
    expect(mkdirLog).toHaveLength(1);
    expect(mkdirLog[0].success).toBe(true);
    expect(mkdirLog[0].mutating).toBe(true);
    // The claim was verified and released around the canonical write.
    expect(verifyRunClaim).toHaveBeenCalled();
    expect(releaseRunClaim).toHaveBeenCalledWith(PAUSED_ID, "user_123", expect.any(String), "completed");
  });
});

describe("nested approval preserves first-gate evidence", () => {
  // The nested gate used to write prior_tool_calls: null — so a run that
  // hit TWO approval gates resumed the second with an empty evidence log
  // and lost every verified/contradicted call proven across the first.
  it("passes the seeded + newly executed call history to the nested paused run", async () => {
    vi.mocked(getProject).mockResolvedValue({ framework: "static" } as never);
    const seededPrior = [{
      toolId: "files.write",
      success: true,
      summary: "wrote index.html (v0)",
      mutating: true,
      paths: ["index.html"],
      persisted: true,
    }];
    const run = {
      ...pendingRun(),
      toolId: "files.write",
      toolCallId: "tc-write-1",
      inputs: { projectId: "proj-123", path: "index.html", content: "<html>v1</html>" },
      priorToolCalls: seededPrior,
      // The remainder of the batch: a gated mutation that pauses AGAIN.
      deferredToolCalls: [
        { toolId: "files.mkdir", toolCallId: "tc-mkdir-2", inputs: { path: "nested-dir" } },
      ],
      pausedMessages: [
        { role: "user" as const, content: "Build a roofing site" },
        buildAssistantToolCallMessage(
          [{ toolId: "files.write", toolCallId: "tc-write-1", inputs: { projectId: "proj-123", path: "index.html", content: "<html>v1</html>" } }],
          "Writing the site.",
          undefined,
        ),
      ],
    };
    vi.mocked(getPausedRun).mockResolvedValue(run as never);
    vi.mocked(resolvePausedRun).mockResolvedValue(run as never);
    vi.mocked(createPausedRun).mockResolvedValue({ id: "nested-1" } as never);

    expect((await POST(makeRequest("approved"), routeParams)).status).toBe(202);
    await waitFor(() => vi.mocked(createPausedRun).mock.calls.length > 0);

    const nestedInput = vi.mocked(createPausedRun).mock.calls[0][0] as {
      toolId: string;
      priorToolCalls?: Array<{ toolId: string; summary: string }>;
    };
    expect(nestedInput.toolId).toBe("files.mkdir");
    expect(nestedInput.priorToolCalls).toBeDefined();
    // The seeded first-gate evidence survives into the second gate.
    expect(nestedInput.priorToolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolId: "files.write", summary: "wrote index.html (v0)" }),
      ]),
    );
    // …plus the write that was approved and executed in THIS resume.
    expect(nestedInput.priorToolCalls!.length).toBeGreaterThanOrEqual(2);
    // The deferred mkdir paused instead of executing unapproved.
    expect(mkdirCalls).not.toContain("nested-dir");
  });
});

describe("POST approval → resumed run keeps execution intent", () => {
  // Greptile P1 on PR #757 (round 2): the resume config dropped execution
  // intent, so a post-approval reply asking for approval in prose — zero
  // tool calls — was accepted as the final answer and the approved work
  // silently stopped. The route now carries `executionRequested` so the
  // resumed loop nudges the model to emit the gated call (a real approval
  // card) or fails honestly — never "completed" on a prose ask.
  const PROSE_ASK =
    "The next step modifies workspace files, so I need your approval to write the next file. How does that sound?";

  beforeEach(() => {
    vi.clearAllMocks();
    mkdirCalls.length = 0;
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as never);
    vi.mocked(getProject).mockResolvedValue({ framework: "static" } as never);
    vi.mocked(markRunProcessing).mockResolvedValue(true);
    const run = {
      ...pendingRun(),
      toolId: "files.write",
      toolCallId: "tc-write-1",
      inputs: { projectId: "proj-123", path: "index.html", content: "<html><body>Built site</body></html>" },
      pausedMessages: [
        { role: "user" as const, content: "Build a roofing site" },
        buildAssistantToolCallMessage(
          [{ toolId: "files.write", toolCallId: "tc-write-1", inputs: { projectId: "proj-123", path: "index.html", content: "<html><body>Built site</body></html>" } }],
          "Writing the site.",
          undefined,
        ),
      ],
    };
    vi.mocked(getPausedRun).mockResolvedValue(run as never);
    vi.mocked(resolvePausedRun).mockResolvedValue(run as never);
  });

  it("settles failed — never completed — when the post-approval model keeps asking in prose", async () => {
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: PROSE_ASK,
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    } as never);

    expect((await POST(makeRequest("approved"), routeParams)).status).toBe(202);
    await waitFor(() =>
      vi.mocked(transitionActionRunEventActivity).mock.calls.some(
        (c) => (c[0] as { status?: string }).status === "failed",
      ),
    );
    // The bug reported "completed" here — work silently dropped.
    expect(
      vi.mocked(transitionActionRunEventActivity).mock.calls.some(
        (c) => (c[0] as { status?: string }).status === "completed",
      ),
    ).toBe(false);
    // The approved write DID execute before the model stalled.
    const transport = await vi.mocked(createWorkspaceTransport).mock.results[0].value;
    expect(transport.writeFile).toHaveBeenCalledWith("index.html", expect.any(String));
  });

  it("turns a post-approval prose ask into a real nested approval card", async () => {
    // Model asks in prose → nudge → emits the gated files.write → the
    // second approval gate persists a real card instead of pretending
    // the work finished.
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: PROSE_ASK,
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      } as never)
      .mockResolvedValue({
        text: "",
        toolCalls: [
          { toolId: "files.write", toolCallId: "tc-write-2", inputs: { projectId: "proj-123", path: "about.html", content: "<html/>" } },
        ],
        finishReason: "tool_calls",
        model: "test-model",
      } as never);
    vi.mocked(createPausedRun).mockResolvedValue({ id: "nested-2" } as never);

    expect((await POST(makeRequest("approved"), routeParams)).status).toBe(202);
    await waitFor(() => vi.mocked(createPausedRun).mock.calls.length > 0);

    const nestedInput = vi.mocked(createPausedRun).mock.calls[0][0] as { toolId: string };
    expect(nestedInput.toolId).toBe("files.write");
    // The nudge produced a real gated call — the prose ask itself was
    // never accepted as a final answer.
    expect(vi.mocked(callLLMWithTools).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
