// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Build-capability-guard arming on approval resume.
 *
 * The defect (found reviewing staging acceptance run 42761179141,
 * 2026-11-10): the approvals route armed the resumed loop's
 * buildCapabilityGuard ONLY when the tool that caused the pause writes
 * files. But a build run's FIRST gate is routinely a non-writing tool —
 * the golden journey pauses on image.stock before any file exists — so
 * the resumed build ran with NO zero-write protection: the per-step
 * no-write counter and the end-of-loop "no successful file-writing
 * operation" check were both inert for exactly the runs that need them.
 * The route already computes build intent for the quality loop
 * (shouldEnableQualityLoop: act/auto mode + a project); the guard must
 * use the same test.
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
  RUN_HEARTBEAT_MS: 60_000,
  RUN_STALL_MS: 600_000,
  resetRunForRetry: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("@/lib/litt-intelligence/workspace-transport", () => ({
  createWorkspaceTransport: vi.fn(() =>
    Promise.resolve({
      workspaceId: "ws-123",
      listFiles: vi.fn(async () => ({ entries: [{ name: "index.html", type: "file" }] })),
      startPreview: vi.fn(async () => ({ status: "ready" })),
      getPreviewStatus: vi.fn(async () => ({ status: "ready" })),
    }),
  ),
}));

vi.mock("@/lib/litt-intelligence/agent-loop-v2", () => ({
  resumeAgentLoopV2: vi.fn(),
  isFileWritingTool: (id: string) => ["files.write", "apply_patch", "edit"].includes(id),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(),
  getProject: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/lib/missions/mission-repository", () => ({
  getCheckpoint: vi.fn(),
}));

vi.mock("@/lib/studio/conversation-service", () => ({
  getAwaitingApprovalAssistantMessage: vi.fn(),
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

vi.mock("@/lib/action-runtime", () => ({
  getActionRun: vi.fn(),
  recordActionEventActivity: vi.fn(() => Promise.resolve({})),
  transitionActionRun: vi.fn(() => Promise.resolve({})),
  transitionActionRunEventActivity: vi.fn(() => Promise.resolve({})),
}));

import { auth } from "@/lib/auth";
import { POST } from "./route";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
} from "@/lib/litt-intelligence/paused-run-store";
import { resumeAgentLoopV2 } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { getActionRun } from "@/lib/action-runtime";
import { getAwaitingApprovalAssistantMessage } from "@/lib/studio/conversation-service";

const CONV_ID = "conv-123";
const PAUSED_ID = "paused-1";

const routeParams = { params: Promise.resolve({ conversationId: CONV_ID, pausedRunId: PAUSED_ID }) };

function makePendingRun(overrides: Record<string, unknown> = {}) {
  return {
    id: PAUSED_ID,
    userId: "user_123",
    conversationId: CONV_ID,
    projectId: "proj-123",
    workspaceId: "ws-123",
    toolId: "image.stock",
    toolCallId: "tc-1",
    inputs: { query: "coffee beans closeup" },
    reason: "Mutation requires approval in ACT mode",
    pausedMessages: [{ role: "user", content: "Build a landing site" }],
    executionMode: "act",
    systemPrompt: "system",
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
    deferredToolCalls: undefined,
    priorToolCalls: undefined,
    stepsUsed: 1,
    hadInterveningMutation: false,
    qualityLoopState: undefined,
    ...overrides,
  };
}

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/studio/conversations/${CONV_ID}/approvals/${PAUSED_ID}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    },
  );
}

async function postAndCaptureConfig(overrides: Record<string, unknown> = {}) {
  const run = makePendingRun(overrides);
  vi.mocked(getPausedRun).mockResolvedValue(run as never);
  vi.mocked(resolvePausedRun).mockResolvedValue({ ...run, status: "approved" } as never);
  const response = await POST(makeRequest(), routeParams);
  expect(response.status).toBe(202);
  await vi.waitFor(() => expect(resumeAgentLoopV2).toHaveBeenCalled());
  const firstCall = vi.mocked(resumeAgentLoopV2).mock.calls[0][0] as {
    config: Record<string, unknown>;
  };
  return firstCall.config;
}

describe("build capability guard arming on resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as never);
    vi.mocked(markRunProcessing).mockResolvedValue(true as never);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "working" } as never);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as never);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue(
      { id: "msg-1", content: "Approval required." } as never,
    );
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "Done",
      stepsUsed: 1,
      toolCalls: [],
      cancelled: false,
    } as never);
  });

  it("arms the guard when a build run (act mode + project) paused on image.stock", async () => {
    const config = await postAndCaptureConfig();
    expect(config.buildCapabilityGuard).toEqual({ maxStepsWithoutFileWrite: 3 });
  });

  it("arms the guard when an auto-mode build paused on image.generate", async () => {
    const config = await postAndCaptureConfig({ toolId: "image.generate", executionMode: "auto" });
    expect(config.buildCapabilityGuard).toEqual({ maxStepsWithoutFileWrite: 3 });
  });

  it("still arms the guard for a file-writing gate (pre-existing behavior)", async () => {
    const config = await postAndCaptureConfig({ toolId: "files.write" });
    expect(config.buildCapabilityGuard).toEqual({ maxStepsWithoutFileWrite: 3 });
  });

  it("leaves the guard off for a non-build resume (plan mode, image gate)", async () => {
    const config = await postAndCaptureConfig({ executionMode: "plan" });
    expect(config.buildCapabilityGuard).toBeUndefined();
  });

  it("leaves the guard off when the paused run has no project", async () => {
    const config = await postAndCaptureConfig({ projectId: null });
    expect(config.buildCapabilityGuard).toBeUndefined();
  });
});
