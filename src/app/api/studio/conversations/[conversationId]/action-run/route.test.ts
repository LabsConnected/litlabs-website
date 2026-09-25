// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getConversation: vi.fn(),
  getActionRun: vi.fn(),
  listActionRuns: vi.fn(),
  listActionEvents: vi.fn(),
  listPausedRunsForActionRun: vi.fn(),
  withRateLimit: (handler: unknown) => handler,
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: mocks.withRateLimit }));
vi.mock("@/lib/studio/conversation-service", () => ({
  getConversation: mocks.getConversation,
}));
vi.mock("@/lib/action-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/action-runtime")>()),
  getActionRun: mocks.getActionRun,
  listActionRuns: mocks.listActionRuns,
  listActionEvents: mocks.listActionEvents,
}));
vi.mock("@/lib/litt-intelligence/paused-run-store", () => ({
  listPausedRunsForActionRun: mocks.listPausedRunsForActionRun,
}));

import { GET } from "./route";

const run = {
  id: "run-one",
  userId: "user-one",
  projectId: "project-one",
  conversationId: "conversation-one",
  kind: "composite" as const,
  status: "waiting_for_user" as const,
  createdAt: "2026-09-23T00:00:00.000Z",
  startedAt: "2026-09-23T00:00:01.000Z",
  updatedAt: "2026-09-23T00:00:02.000Z",
  completedAt: null,
  currentActivity: "Waiting for deploy approval",
  browserSessionId: null,
  cancellationRequestedAt: null,
  approvalReference: "paused-one",
  failureCode: null,
  failureMessage: null,
};

const event = {
  id: "event-one",
  sequence: "1",
  runId: "run-one",
  userId: "user-one",
  type: "approval.required" as const,
  createdAt: "2026-09-23T00:00:02.000Z",
  payload: { toolId: "project.deploy" },
};

const pausedRun = {
  id: "paused-one",
  userId: "user-one",
  conversationId: "conversation-one",
  projectId: "project-one",
  workspaceId: "workspace-one",
  toolId: "project.deploy",
  toolCallId: "tool-call-one",
  inputs: {},
  reason: "Sensitive action — requires explicit approval",
  pausedMessages: [],
  executionMode: "act" as const,
  systemPrompt: "system",
  checkpointId: null,
  actionRunId: "run-one",
  status: "pending" as const,
  createdAt: "2026-09-23T00:00:02.000Z",
  expiresAt: "2026-09-23T00:30:00.000Z",
  resolvedAt: null,
  runStatus: null,
  runResult: null,
  runError: null,
  runStartedAt: null,
  runCompletedAt: null,
  executionToken: null,
  leaseExpiresAt: null,
  lastProgressAt: null,
};

function request(path = "http://localhost/api/studio/conversations/conversation-one/action-run") {
  return new NextRequest(path);
}

function params(conversationId = "conversation-one") {
  return { params: Promise.resolve({ conversationId }) };
}

describe("GET /api/studio/conversations/[conversationId]/action-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user-one" });
    mocks.getConversation.mockResolvedValue({ id: "conversation-one" });
    mocks.listActionRuns.mockResolvedValue([
      { ...run, id: "run-old", status: "completed", createdAt: "2026-09-23T00:00:00.000Z" },
      run,
    ]);
    mocks.listActionEvents.mockResolvedValue([event]);
    mocks.listPausedRunsForActionRun.mockResolvedValue([pausedRun]);
  });

  it("returns the canonical server-owned projection for the active conversation run", async () => {
    const response = await GET(request(), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.listActionEvents).toHaveBeenCalledWith("run-one", "user-one", { limit: 500 });
    expect(mocks.listPausedRunsForActionRun).toHaveBeenCalledWith("run-one", "user-one");
    expect(body.projection.run.id).toBe("run-one");
    expect(body.projection.displayState).toBe("awaiting_approval");
    expect(body.projection.pendingApprovals[0].id).toBe("paused-one");
    expect(body.projection.capabilities.approval.status).toBe("running");
  });

  it("honors an explicit runId only when it belongs to the conversation", async () => {
    mocks.getActionRun.mockResolvedValue(run);

    const response = await GET(
      request("http://localhost/api/studio/conversations/conversation-one/action-run?runId=run-one"),
      params(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getActionRun).toHaveBeenCalledWith("run-one", "user-one");
    expect(body.projection.run.id).toBe("run-one");
  });

  it("does not project another conversation's run", async () => {
    mocks.getActionRun.mockResolvedValue({ ...run, conversationId: "other-conversation" });

    const response = await GET(
      request("http://localhost/api/studio/conversations/conversation-one/action-run?runId=run-one"),
      params(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.projection).toBeNull();
    expect(mocks.listActionEvents).not.toHaveBeenCalled();
  });

  it("requires conversation ownership", async () => {
    mocks.getConversation.mockResolvedValue(null);

    const response = await GET(request(), params("not-mine"));

    expect(response.status).toBe(404);
    expect(mocks.listActionRuns).not.toHaveBeenCalled();
  });
});
