import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendActionEvent: vi.fn(),
  recordActionActivity: vi.fn(),
  recordActionEventActivity: vi.fn(),
  listActionRuns: vi.fn(),
  createActionRun: vi.fn(),
  findOrCreateBrowserActionRun: vi.fn(),
  getActionRun: vi.fn(),
  resolveBrowserActionRun: vi.fn(),
  patchActionRun: vi.fn(),
  transitionActionRun: vi.fn(),
  transitionActionRunEventActivity: vi.fn(),
  getActionRunByBrowserSession: vi.fn(),
}));

const run = {
  id: "run-one",
  userId: "user-one",
  projectId: null,
  conversationId: "conversation-one",
  kind: "browser" as const,
  status: "working" as const,
  createdAt: "2026-09-23T00:00:00.000Z",
  startedAt: "2026-09-23T00:00:01.000Z",
  updatedAt: "2026-09-23T00:00:01.000Z",
  completedAt: null,
  currentActivity: "Browser session ready",
  browserSessionId: "session-one",
  cancellationRequestedAt: null,
  approvalReference: null,
  failureCode: null,
  failureMessage: null,
};

vi.mock("./run-store", () => mocks);

import {
  markBrowserSessionControl,
  recordBrowserToolCompleted,
  recordBrowserToolFailed,
  recordBrowserToolStarted,
  startBrowserActionRun,
} from "./browser-runtime";

describe("browser Action Runtime adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listActionRuns.mockResolvedValue([run]);
    mocks.findOrCreateBrowserActionRun.mockResolvedValue(run);
    mocks.getActionRun.mockResolvedValue(run);
    mocks.transitionActionRunEventActivity.mockImplementation(async (input: { runId: string; status: string }) => ({ ...run, id: input.runId, status: input.status }));
  });

  it("creates or reuses one outer run, never one run per tool call", async () => {
    const first = await startBrowserActionRun({
      userId: "user-one",
      conversationId: "conversation-one",
    });
    const second = await startBrowserActionRun({
      userId: "user-one",
      conversationId: "conversation-one",
    });

    expect(first.id).toBe("run-one");
    expect(second.id).toBe("run-one");
    expect(mocks.findOrCreateBrowserActionRun).toHaveBeenCalledTimes(2);
    expect(mocks.createActionRun).not.toHaveBeenCalled();
  });

  it("does not claim working merely when control returns", async () => {
    mocks.getActionRun.mockResolvedValue({ ...run, status: "user_controlling" });
    mocks.transitionActionRunEventActivity.mockResolvedValue({ ...run, status: "paused" });
    const result = await markBrowserSessionControl("user-one", {
      id: "session-one",
      userId: "user-one",
      projectId: null,
      conversationId: "conversation-one",
      browserbaseSessionId: "provider-one",
      status: "agent_control",
      controller: "agent",
      task: null,
      liveViewUrl: null,
      error: null,
      metadata: {},
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      closedAt: null,
    }, "run-one");

    expect(result?.status).toBe("paused");
    expect(mocks.transitionActionRunEventActivity).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-one", userId: "user-one", status: "paused" }));
  });

  it("keeps browser and deploy actions inside one composite task run", async () => {
    const compositeRun = { ...run, kind: "composite" as const, status: "working" as const };
    mocks.getActionRun.mockResolvedValue(compositeRun);
    const context = { actionRunId: "run-one", userId: "user-one", browserSessionId: "session-one" };

    await recordBrowserToolStarted(context, "browser.navigate");
    await recordBrowserToolCompleted(context, "browser.navigate");
    await recordBrowserToolStarted(context, "browser.click");
    await recordBrowserToolCompleted(context, "browser.click");
    await recordBrowserToolStarted(context, "browser.type");
    await recordBrowserToolCompleted(context, "browser.type");
    await mocks.appendActionEvent({
      runId: "run-one",
      userId: "user-one",
      type: "deployment.completed",
      payload: { verified: true },
    });

    expect(mocks.createActionRun).not.toHaveBeenCalled();
    expect(mocks.listActionRuns).not.toHaveBeenCalled();
    expect(mocks.getActionRun).toHaveBeenCalledTimes(6);
    expect(mocks.recordActionEventActivity.mock.calls.every(([event]) => event.runId === "run-one")).toBe(true);
    expect(mocks.appendActionEvent).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-one", type: "deployment.completed" }));
  });

  it("rejects missing, mismatched, and terminal run contexts", async () => {
    const context = { actionRunId: "run-one", userId: "user-one", browserSessionId: "session-one" };
    mocks.getActionRun.mockResolvedValueOnce(null);
    await expect(recordBrowserToolStarted(context, "browser.navigate")).rejects.toMatchObject({ code: "ACTION_RUN_NOT_FOUND" });

    mocks.getActionRun.mockResolvedValueOnce({ ...run, browserSessionId: "other-session" });
    await expect(recordBrowserToolStarted(context, "browser.navigate")).rejects.toMatchObject({ code: "ACTION_BROWSER_SESSION_MISMATCH" });

    mocks.getActionRun.mockResolvedValueOnce({ ...run, status: "completed" });
    await expect(recordBrowserToolStarted(context, "browser.navigate")).rejects.toMatchObject({ code: "ACTION_RUN_TERMINAL" });
  });

  it("returns control to paused, then resumes working on the next browser tool", async () => {
    const context = { actionRunId: "run-one", userId: "user-one", browserSessionId: "session-one" };
    mocks.getActionRun.mockResolvedValueOnce({ ...run, status: "user_controlling" });
    mocks.transitionActionRunEventActivity.mockResolvedValueOnce({ ...run, status: "paused" });
    const returned = await markBrowserSessionControl("user-one", {
      id: "session-one",
      userId: "user-one",
      projectId: null,
      conversationId: "conversation-one",
      browserbaseSessionId: "provider-one",
      status: "agent_control",
      controller: "agent",
      task: null,
      liveViewUrl: null,
      error: null,
      metadata: {},
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      closedAt: null,
    }, "run-one");
    expect(returned?.status).toBe("paused");

    mocks.getActionRun.mockResolvedValueOnce({ ...run, status: "paused" });
    mocks.transitionActionRunEventActivity.mockResolvedValueOnce({ ...run, status: "working" });
    const started = await recordBrowserToolStarted(context, "browser.navigate");
    expect(started.status).toBe("working");
    expect(mocks.transitionActionRunEventActivity).toHaveBeenLastCalledWith(expect.objectContaining({ status: "working", eventType: "browser.action.started" }));
  });

  it("records a thrown browser tool as failed without inferring from result.success", async () => {
    const context = { actionRunId: "run-one", userId: "user-one", browserSessionId: "session-one" };
    await recordBrowserToolCompleted(context, "browser.snapshot");
    await recordBrowserToolFailed(context, "browser.click", new Error("click timed out"));

    expect(mocks.recordActionEventActivity).toHaveBeenCalledWith(expect.objectContaining({
      type: "browser.action.completed",
      payload: expect.objectContaining({ outcome: "completed" }),
    }));
    expect(mocks.recordActionEventActivity).toHaveBeenCalledWith(expect.objectContaining({
      type: "browser.action.failed",
      payload: expect.objectContaining({ outcome: "failed" }),
    }));
  });
});
