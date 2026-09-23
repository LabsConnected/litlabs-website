import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendActionEvent: vi.fn(),
  attachBrowserSessionToRun: vi.fn(),
  recordActionActivity: vi.fn(),
  recordActionEventActivity: vi.fn(),
  listActionRuns: vi.fn(),
  createActionRun: vi.fn(),
  findActiveActionRunForConversation: vi.fn(),
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
  attachBrowserSession,
  findActiveBrowserActionRun,
  markBrowserRunPersistenceDegraded,
  markBrowserSessionControl,
  recordBrowserToolExecution,
  recordBrowserToolStarted,
  resolveBrowserActionRun,
  startBrowserActionRun,
} from "./browser-runtime";
import type { BrowserSession } from "@/lib/litt-intelligence/browser-session-manager";

function fakeSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  return {
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
    ...overrides,
  } as BrowserSession;
}

const toolContext = { actionRunId: "run-one", userId: "user-one", browserSessionId: "session-one" };

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
    const result = await markBrowserSessionControl("user-one", fakeSession(), "run-one");

    expect(result?.status).toBe("paused");
    expect(mocks.transitionActionRunEventActivity).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-one", userId: "user-one", status: "paused" }));
  });

  it("keeps browser and deploy actions inside one composite task run", async () => {
    const compositeRun = { ...run, kind: "composite" as const, status: "working" as const };
    mocks.getActionRun.mockResolvedValue(compositeRun);

    await recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" });
    await recordBrowserToolExecution({ ...toolContext, toolId: "browser.navigate", result: { outcome: "completed" } });
    await recordBrowserToolStarted({ ...toolContext, toolId: "browser.click" });
    await recordBrowserToolExecution({ ...toolContext, toolId: "browser.click", result: { outcome: "completed" } });
    await recordBrowserToolStarted({ ...toolContext, toolId: "browser.type" });
    await recordBrowserToolExecution({ ...toolContext, toolId: "browser.type", result: { outcome: "completed" } });
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

  it("attaches a browser session to the same run and rejects wrong targets", async () => {
    mocks.attachBrowserSessionToRun.mockResolvedValue({ ...run, browserSessionId: "session-one" });

    const attached = await attachBrowserSession({ ...run, browserSessionId: null }, fakeSession());
    expect(attached.browserSessionId).toBe("session-one");
    expect(mocks.attachBrowserSessionToRun).toHaveBeenCalledWith("run-one", "user-one", "session-one", "provider-one");

    await expect(
      attachBrowserSession({ ...run, status: "completed" }, fakeSession()),
    ).rejects.toMatchObject({ code: "ACTION_RUN_TERMINAL" });

    await expect(
      attachBrowserSession({ ...run, browserSessionId: "other-session" }, fakeSession()),
    ).rejects.toMatchObject({ code: "ACTION_BROWSER_SESSION_MISMATCH" });
  });

  it("prefers an explicit actionRunId over session association when resolving", async () => {
    mocks.getActionRun.mockResolvedValue(run);

    const resolved = await resolveBrowserActionRun("user-one", {
      actionRunId: "run-one",
      browserSessionId: "session-two",
    });

    expect(resolved?.id).toBe("run-one");
    expect(mocks.getActionRun).toHaveBeenCalledWith("run-one", "user-one");
    expect(mocks.getActionRunByBrowserSession).not.toHaveBeenCalled();
    expect(mocks.findActiveActionRunForConversation).not.toHaveBeenCalled();
  });

  it("uses conversation lookup only as a legacy recovery fallback", async () => {
    mocks.findActiveActionRunForConversation.mockResolvedValue(run);

    const recovered = await findActiveBrowserActionRun("user-one", { conversationId: "conversation-one" });

    expect(recovered?.id).toBe("run-one");
    expect(mocks.findActiveActionRunForConversation).toHaveBeenCalledWith("user-one", "conversation-one");
    expect(mocks.getActionRunByBrowserSession).not.toHaveBeenCalled();
  });

  it("rejects missing, mismatched, and terminal run contexts", async () => {
    mocks.getActionRun.mockResolvedValueOnce(null);
    await expect(recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" })).rejects.toMatchObject({ code: "ACTION_RUN_NOT_FOUND" });

    mocks.getActionRun.mockResolvedValueOnce({ ...run, browserSessionId: "other-session" });
    await expect(recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" })).rejects.toMatchObject({ code: "ACTION_BROWSER_SESSION_MISMATCH" });

    mocks.getActionRun.mockResolvedValueOnce({ ...run, status: "completed" });
    await expect(recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" })).rejects.toMatchObject({ code: "ACTION_RUN_TERMINAL" });
  });

  it("returns control to paused, then resumes working on the next browser tool", async () => {
    mocks.getActionRun.mockResolvedValueOnce({ ...run, status: "user_controlling" });
    mocks.transitionActionRunEventActivity.mockResolvedValueOnce({ ...run, status: "paused" });
    const returned = await markBrowserSessionControl("user-one", fakeSession(), "run-one");
    expect(returned?.status).toBe("paused");

    mocks.getActionRun.mockResolvedValueOnce({ ...run, status: "paused" });
    mocks.transitionActionRunEventActivity.mockResolvedValueOnce({ ...run, status: "working" });
    const started = await recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" });
    expect(started.status).toBe("working");
    expect(mocks.transitionActionRunEventActivity).toHaveBeenLastCalledWith(expect.objectContaining({ status: "working", eventType: "browser.action.started" }));
  });

  it("records a thrown browser tool as failed without inferring from result.success", async () => {
    await recordBrowserToolExecution({ ...toolContext, toolId: "browser.snapshot", result: { outcome: "completed" } });
    await recordBrowserToolExecution({ ...toolContext, toolId: "browser.click", result: { outcome: "failed", error: new Error("click timed out") } });

    expect(mocks.recordActionEventActivity).toHaveBeenCalledWith(expect.objectContaining({
      type: "browser.action.completed",
      payload: expect.objectContaining({ outcome: "completed" }),
    }));
    expect(mocks.recordActionEventActivity).toHaveBeenCalledWith(expect.objectContaining({
      type: "browser.action.failed",
      payload: expect.objectContaining({ outcome: "failed" }),
    }));
  });

  it("propagates durable persistence failures instead of swallowing them", async () => {
    // Transition path (paused -> working): failure inside the atomic RPC propagates.
    mocks.getActionRun.mockResolvedValueOnce({ ...run, status: "paused" });
    mocks.transitionActionRunEventActivity.mockRejectedValueOnce(new Error("db write lost"));
    await expect(
      recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" }),
    ).rejects.toThrow("db write lost");

    // Event/activity path (already working): event insert failure propagates.
    mocks.recordActionEventActivity.mockRejectedValueOnce(new Error("event insert failed"));
    await expect(
      recordBrowserToolExecution({ ...toolContext, toolId: "browser.navigate", result: { outcome: "completed" } }),
    ).rejects.toThrow("event insert failed");
  });

  it("marks a run persistence-degraded without ever throwing", async () => {
    mocks.patchActionRun.mockResolvedValue({ ...run, failureCode: "ACTION_RUNTIME_PERSISTENCE_FAILED" });
    await expect(markBrowserRunPersistenceDegraded(toolContext)).resolves.toBeUndefined();
    expect(mocks.patchActionRun).toHaveBeenCalledWith("run-one", "user-one", expect.objectContaining({
      failureCode: "ACTION_RUNTIME_PERSISTENCE_FAILED",
    }));

    mocks.patchActionRun.mockRejectedValueOnce(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(markBrowserRunPersistenceDegraded(toolContext)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "[action-runtime] could not mark run persistence-degraded",
      expect.objectContaining({ runId: "run-one" }),
    );
    errorSpy.mockRestore();
  });
});
