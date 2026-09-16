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
  markRunCompleted: vi.fn(() => Promise.resolve()),
  markRunFailed: vi.fn(() => Promise.resolve()),
  createPausedRun: vi.fn(),
}));

const mkdirCalls: string[] = [];
vi.mock("@/lib/litt-intelligence/workspace-transport", () => ({
  createWorkspaceTransport: vi.fn(() =>
    Promise.resolve({
      workspaceId: "ws-123",
      userId: "user_123",
      workspaceRoot: "/tmp/test",
      projectId: "proj-123",
      mkdir: vi.fn(async (path: string) => {
        mkdirCalls.push(path);
        return { created: true };
      }),
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

vi.mock("@/lib/litt-intelligence/quality-loop-flow", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  shouldEnableQualityLoop: vi.fn(() => false),
}));

import { auth } from "@/lib/auth";
import { POST } from "./route";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
  markRunCompleted,
  markRunFailed,
} from "@/lib/litt-intelligence/paused-run-store";
import { callLLMWithTools, buildAssistantToolCallMessage } from "@/lib/litt-intelligence/llm-tool-calling";

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

  it("returns 202 and the detached resume executes files.mkdir, then marks completed", async () => {
    const resp = await POST(makeRequest("approved"), routeParams);
    expect(resp.status).toBe(202);

    await waitFor(() => vi.mocked(markRunCompleted).mock.calls.length > 0);
    expect(mkdirCalls).toEqual(["src/app/(marketing)/roofing"]);
    expect(vi.mocked(markRunFailed).mock.calls.length).toBe(0);

    const completedArg = vi.mocked(markRunCompleted).mock.calls[0][2] as {
      toolCalls: Array<{ toolId: string; success: boolean; mutating: boolean }>;
    };
    const mkdirLog = completedArg.toolCalls.filter((c) => c.toolId === "files.mkdir");
    expect(mkdirLog).toHaveLength(1);
    expect(mkdirLog[0].success).toBe(true);
    expect(mkdirLog[0].mutating).toBe(true);
  });
});
