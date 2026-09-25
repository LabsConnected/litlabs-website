// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getActionRun: vi.fn(),
  requestActionRunCancellation: vi.fn(),
  transitionActionRun: vi.fn(),
  closeSession: vi.fn(),
  requestExecutionCancellation: vi.fn(),
  withRateLimit: (handler: unknown) => handler,
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: mocks.withRateLimit }));
vi.mock("@/lib/action-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/action-runtime")>()),
  getActionRun: mocks.getActionRun,
  requestActionRunCancellation: mocks.requestActionRunCancellation,
  transitionActionRun: mocks.transitionActionRun,
}));
vi.mock("@/lib/litt-intelligence/browser-session-manager", () => ({
  closeSession: mocks.closeSession,
}));
vi.mock("@/lib/studio/execution-registry", () => ({
  requestExecutionCancellation: mocks.requestExecutionCancellation,
}));

import { POST } from "./route";

const run = {
  id: "run-one",
  userId: "user-one",
  projectId: "project-one",
  conversationId: "conversation-one",
  kind: "composite" as const,
  status: "working" as const,
  createdAt: "2026-09-23T00:00:00.000Z",
  startedAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:00.000Z",
  completedAt: null,
  currentActivity: "Working in the browser",
  browserSessionId: "session-one",
  cancellationRequestedAt: null,
  approvalReference: null,
  failureCode: null,
  failureMessage: null,
};

function request(): NextRequest {
  return new NextRequest("http://localhost/api/action-runs/run-one/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientRequestId: "request-one" }),
  });
}

describe("POST /api/action-runs/[runId]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user-one" });
    mocks.getActionRun.mockResolvedValue(run);
    mocks.requestActionRunCancellation.mockResolvedValue({ ...run, cancellationRequestedAt: "2026-09-23T00:10:00.000Z" });
    mocks.transitionActionRun.mockResolvedValue({ ...run, status: "cancelled", cancellationRequestedAt: "2026-09-23T00:10:00.000Z" });
    mocks.requestExecutionCancellation.mockReturnValue({ status: "cancelled" });
    mocks.closeSession.mockResolvedValue(true);
  });

  it("explicit task cancellation cancels the parent run and then closes its browser resource", async () => {
    const response = await POST(request(), { params: Promise.resolve({ runId: "run-one" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.run.status).toBe("cancelled");
    expect(body.browserSessionClosed).toBe(true);
    expect(mocks.requestActionRunCancellation).toHaveBeenCalledWith("run-one", "user-one");
    expect(mocks.requestExecutionCancellation).toHaveBeenCalledWith("conversation-one", "user-one", "request-one");
    expect(mocks.transitionActionRun).toHaveBeenCalledWith("run-one", "user-one", "cancelled", expect.objectContaining({ currentActivity: "Task cancelled by user" }));
    expect(mocks.closeSession).toHaveBeenCalledWith("session-one", "user-one");
  });

  it("rejects an ActionRun owned by another user", async () => {
    mocks.getActionRun.mockResolvedValue(null);

    const response = await POST(request(), { params: Promise.resolve({ runId: "other-run" }) });

    expect(response.status).toBe(404);
    expect(mocks.requestActionRunCancellation).not.toHaveBeenCalled();
    expect(mocks.closeSession).not.toHaveBeenCalled();
  });
});
