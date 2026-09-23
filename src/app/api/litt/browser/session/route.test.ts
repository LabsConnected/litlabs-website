// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  withRateLimit: (handler: unknown) => handler,
  startSession: vi.fn(),
  closeSession: vi.fn(),
  pauseSession: vi.fn(),
  takeControl: vi.fn(),
  returnControl: vi.fn(),
  getSession: vi.fn(),
  dbGetActiveSessions: vi.fn(),
  dbGetActiveSessionsStrict: vi.fn(),
  dbGetActions: vi.fn(),
  takeScreenshot: vi.fn(),
  closeIdleSessions: vi.fn(),
  preflightBrowserStart: vi.fn(),
  getActionRun: vi.fn(),
  startBrowserActionRun: vi.fn(),
  attachBrowserSession: vi.fn(),
  failBrowserActionRun: vi.fn(),
  resolveBrowserActionRun: vi.fn(),
  markBrowserSessionPaused: vi.fn(),
  markBrowserSessionControl: vi.fn(),
  requestActionRunCancellation: vi.fn(),
  transitionActionRun: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: mocks.withRateLimit }));
vi.mock("@/lib/litt-intelligence/browser-session-manager", () => ({
  startSession: mocks.startSession,
  closeSession: mocks.closeSession,
  pauseSession: mocks.pauseSession,
  takeControl: mocks.takeControl,
  returnControl: mocks.returnControl,
  getSession: mocks.getSession,
  dbGetActiveSessions: mocks.dbGetActiveSessions,
  dbGetActiveSessionsStrict: mocks.dbGetActiveSessionsStrict,
  dbGetActions: mocks.dbGetActions,
  takeScreenshot: mocks.takeScreenshot,
  closeIdleSessions: mocks.closeIdleSessions,
}));
vi.mock("@/lib/litt-intelligence/browser-billing", () => ({
  preflightBrowserStart: mocks.preflightBrowserStart,
}));
vi.mock("@/lib/action-runtime", () => ({
  getActionRun: mocks.getActionRun,
  startBrowserActionRun: mocks.startBrowserActionRun,
  attachBrowserSession: mocks.attachBrowserSession,
  failBrowserActionRun: mocks.failBrowserActionRun,
  resolveBrowserActionRun: mocks.resolveBrowserActionRun,
  markBrowserSessionPaused: mocks.markBrowserSessionPaused,
  markBrowserSessionControl: mocks.markBrowserSessionControl,
}));
vi.mock("@/lib/action-runtime/run-store", () => ({
  requestActionRunCancellation: mocks.requestActionRunCancellation,
  transitionActionRun: mocks.transitionActionRun,
}));

import { POST } from "./route";

const session = {
  id: "session-one",
  userId: "user-one",
  projectId: "project-one",
  conversationId: "conversation-one",
  browserbaseSessionId: "provider-one",
  status: "active" as const,
  controller: "agent" as const,
  task: "inspect deployment",
  liveViewUrl: null,
  error: null,
  metadata: {},
  createdAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:00.000Z",
  closedAt: null,
};

const run = {
  id: "run-one",
  userId: "user-one",
  projectId: "project-one",
  conversationId: "conversation-one",
  kind: "browser" as const,
  status: "starting" as const,
  createdAt: "2026-09-23T00:00:00.000Z",
  startedAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:00.000Z",
  completedAt: null,
  currentActivity: "Starting browser session",
  browserSessionId: null,
  cancellationRequestedAt: null,
  approvalReference: null,
  failureCode: null,
  failureMessage: null,
};

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/litt/browser/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("POST /api/litt/browser/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user-one" });
    mocks.dbGetActiveSessionsStrict.mockResolvedValue([]);
    mocks.preflightBrowserStart.mockResolvedValue({ ok: true });
    mocks.closeIdleSessions.mockResolvedValue(undefined);
    mocks.startBrowserActionRun.mockResolvedValue(run);
    mocks.getActionRun.mockResolvedValue(run);
    mocks.attachBrowserSession.mockResolvedValue({ ...run, status: "working", browserSessionId: session.id });
    mocks.failBrowserActionRun.mockResolvedValue({ ...run, status: "failed" });
    mocks.startSession.mockResolvedValue(session);
    mocks.resolveBrowserActionRun.mockResolvedValue({ ...run, browserSessionId: session.id });
    mocks.markBrowserSessionPaused.mockResolvedValue({ ...run, status: "paused" });
    mocks.markBrowserSessionControl.mockResolvedValue({ ...run, status: "user_controlling" });
    mocks.getSession.mockResolvedValue(session);
    mocks.pauseSession.mockResolvedValue({ ...session, status: "paused" });
    mocks.takeControl.mockResolvedValue({ ...session, status: "human_control", controller: "human" });
    mocks.returnControl.mockResolvedValue({ ...session, status: "agent_control", controller: "agent" });
    mocks.closeSession.mockResolvedValue(true);
    mocks.requestActionRunCancellation.mockResolvedValue({ ...run, cancellationRequestedAt: "now" });
    mocks.transitionActionRun.mockResolvedValue({ ...run, status: "cancelled" });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await POST(request({ action: "start" }))).status).toBe(401);
  });

  it("rejects malformed JSON and invalid action types", async () => {
    const malformed = new NextRequest("http://localhost/api/litt/browser/session", {
      method: "POST",
      body: "not-json",
    });
    expect((await POST(malformed)).status).toBe(400);
    expect((await POST(request({ action: 123 }))).status).toBe(400);
    expect((await POST(request({}))).status).toBe(400);
  });

  it("rejects invalid sessionId and actionRunId types", async () => {
    expect((await POST(request({ action: "pause", sessionId: 123 }))).status).toBe(400);
    expect((await POST(request({ action: "start", actionRunId: { id: "run-one" } }))).status).toBe(400);
  });

  it("fails closed when billing active-session lookup is unavailable", async () => {
    mocks.dbGetActiveSessionsStrict.mockRejectedValue(new Error("database unavailable"));
    const response = await POST(request({ action: "start" }));
    expect(response.status).toBe(503);
    expect(mocks.preflightBrowserStart).not.toHaveBeenCalled();
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it("denies quota before creating a browser session", async () => {
    mocks.preflightBrowserStart.mockResolvedValue({ ok: false, error: "concurrent_cap", message: "Too many sessions" });
    const response = await POST(request({ action: "start" }));
    expect(response.status).toBe(429);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it("attaches a supplied owned ActionRun without creating another run", async () => {
    const response = await POST(request({ action: "start", actionRunId: "run-one" }));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.actionRunId).toBe("run-one");
    expect(mocks.startBrowserActionRun).not.toHaveBeenCalled();
    expect(mocks.attachBrowserSession).toHaveBeenCalledWith(expect.objectContaining({ id: "run-one" }), session);
  });

  it("rejects an ActionRun owned by another user", async () => {
    mocks.getActionRun.mockResolvedValue(null);
    const response = await POST(request({ action: "start", actionRunId: "other-run" }));
    expect(response.status).toBe(404);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });

  it("updates the same run for pause, takeover, and return", async () => {
    for (const action of ["pause", "take_control", "return_control"] as const) {
      const response = await POST(request({ action, actionRunId: "run-one", sessionId: "session-one" }));
      expect(response.status).toBe(200);
    }
    expect(mocks.resolveBrowserActionRun).toHaveBeenCalledTimes(3);
    expect(mocks.startBrowserActionRun).not.toHaveBeenCalled();
    expect(mocks.markBrowserSessionPaused).toHaveBeenCalledWith("user-one", expect.anything(), "run-one");
    expect(mocks.markBrowserSessionControl).toHaveBeenNthCalledWith(1, "user-one", expect.anything(), "run-one");
    expect(mocks.markBrowserSessionControl).toHaveBeenNthCalledWith(2, "user-one", expect.anything(), "run-one");
  });

  it("does not close an unowned session", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.resolveBrowserActionRun.mockResolvedValue(null);
    const response = await POST(request({ action: "close", sessionId: "other-session" }));
    expect(response.status).toBe(404);
    expect(mocks.closeSession).not.toHaveBeenCalled();
  });

  it("does not return raw provider errors", async () => {
    mocks.startSession.mockRejectedValue(new Error("provider token secret=super-private"));
    const response = await POST(request({ action: "start" }));
    const body = await json(response);
    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("super-private");
    expect(JSON.stringify(body)).not.toContain("provider token");
    expect(mocks.failBrowserActionRun).toHaveBeenCalledWith(run, expect.any(Error), "BROWSER_SESSION_START_FAILED");
  });
});
