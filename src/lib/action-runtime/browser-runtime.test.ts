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
  recordBrowserToolCompleted,
  recordBrowserToolFailed,
  recordBrowserSessionClosed,
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

/** Canonical execution context: the orchestrator's run identity flows DOWN
 * into browser tools. Low-level tools never search upward for a run. */
const toolContext = { actionRunId: "run-one", userId: "user-one", browserSessionId: "session-one" };

function everyPersistenceCallUsedRunOne() {
  for (const mock of [mocks.recordActionEventActivity, mocks.transitionActionRunEventActivity, mocks.appendActionEvent]) {
    for (const [input] of mock.mock.calls) {
      expect((input as { runId: string }).runId).toBe("run-one");
    }
  }
}

describe("primary explicit-run path (canonical)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActionRun.mockResolvedValue(run);
    mocks.transitionActionRunEventActivity.mockImplementation(async (input: { runId: string; status: string }) => ({ ...run, id: input.runId, status: input.status }));
  });

  it("runs a whole browser task inside one supplied ActionRun — never lists or creates runs", async () => {
    const compositeRun = { ...run, kind: "composite" as const };
    mocks.getActionRun.mockResolvedValue(compositeRun);

    await recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" });
    await recordBrowserToolCompleted({ ...toolContext, toolId: "browser.navigate" });
    await recordBrowserToolStarted({ ...toolContext, toolId: "browser.click" });
    await recordBrowserToolCompleted({ ...toolContext, toolId: "browser.click" });
    await recordBrowserToolStarted({ ...toolContext, toolId: "browser.type" });
    await recordBrowserToolCompleted({ ...toolContext, toolId: "browser.type" });
    // A deployment/verification event can share the same user task run.
    await mocks.appendActionEvent({
      runId: "run-one",
      userId: "user-one",
      type: "deployment.completed",
      payload: { verified: true },
    });

    // Canonical path: the run identity was carried, never rediscovered.
    expect(mocks.listActionRuns).not.toHaveBeenCalled();
    expect(mocks.createActionRun).not.toHaveBeenCalled();
    expect(mocks.findOrCreateBrowserActionRun).not.toHaveBeenCalled();
    expect(mocks.findActiveActionRunForConversation).not.toHaveBeenCalled();
    expect(mocks.getActionRunByBrowserSession).not.toHaveBeenCalled();

    // Every event AND every activity update landed on run-one.
    everyPersistenceCallUsedRunOne();
    expect(mocks.appendActionEvent).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-one", type: "deployment.completed" }));
    expect(mocks.getActionRun).toHaveBeenCalledTimes(6);
    expect(mocks.getActionRun).toHaveBeenCalledWith("run-one", "user-one");
  });

  it("emits the exact event sequence with safe identifiers only", async () => {
    await recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" });
    await recordBrowserToolCompleted({ ...toolContext, toolId: "browser.navigate" });
    await recordBrowserToolStarted({ ...toolContext, toolId: "browser.click" });
    await recordBrowserToolCompleted({ ...toolContext, toolId: "browser.click" });

    const types = mocks.recordActionEventActivity.mock.calls.map(([input]) => (input as { type: string }).type);
    expect(types).toEqual([
      "browser.action.started",
      "browser.action.completed",
      "browser.action.started",
      "browser.action.completed",
    ]);

    const payloads = mocks.recordActionEventActivity.mock.calls.map(([input]) => (input as { payload: Record<string, unknown> }).payload);
    expect(payloads[0]).toEqual({ toolId: "browser.navigate", browserSessionId: "session-one" });
    expect(payloads[1]).toEqual({ toolId: "browser.navigate", browserSessionId: "session-one", outcome: "completed" });
    expect(payloads[2]).toEqual({ toolId: "browser.click", browserSessionId: "session-one" });
    expect(payloads[3]).toEqual({ toolId: "browser.click", browserSessionId: "session-one", outcome: "completed" });

    // Payloads carry identifiers, never raw tool inputs or secrets.
    for (const payload of payloads) {
      expect(payload).not.toHaveProperty("inputs");
      expect(JSON.stringify(payload)).not.toMatch(/password|token|api[_-]?key|cookie|authorization/i);
    }
  });

  it("records failed browser work explicitly with identifiers only", async () => {
    await recordBrowserToolStarted({ ...toolContext, toolId: "browser.click" });
    await recordBrowserToolFailed({ ...toolContext, toolId: "browser.click" }, new Error("provider exploded with token=secret"));

    const types = mocks.recordActionEventActivity.mock.calls.map(([input]) => (input as { type: string }).type);
    expect(types).toEqual(["browser.action.started", "browser.action.failed"]);
    expect(mocks.recordActionEventActivity).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "browser.action.failed",
      payload: expect.objectContaining({
        toolId: "browser.click",
        browserSessionId: "session-one",
        outcome: "failed",
        failureCode: expect.any(String),
      }),
    }));
    const payload = mocks.recordActionEventActivity.mock.calls[1][0].payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("error");
    expect(JSON.stringify(payload)).not.toContain("token=secret");
  });

  it("keeps concurrent browser actions on the same run with no run creation", async () => {
    mocks.recordActionEventActivity.mockResolvedValue(run);
    const [navStarted, clickStarted] = await Promise.all([
      recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" }),
      recordBrowserToolStarted({ ...toolContext, toolId: "browser.click" }),
    ]);
    const [navDone, clickDone] = await Promise.all([
      recordBrowserToolCompleted({ ...toolContext, toolId: "browser.navigate" }),
      recordBrowserToolCompleted({ ...toolContext, toolId: "browser.click" }),
    ]);

    for (const result of [navStarted, clickStarted, navDone, clickDone]) {
      expect(result.id).toBe("run-one");
    }
    expect(mocks.createActionRun).not.toHaveBeenCalled();
    expect(mocks.findOrCreateBrowserActionRun).not.toHaveBeenCalled();
    everyPersistenceCallUsedRunOne();
    expect(mocks.getActionRun).toHaveBeenCalledTimes(4);
    for (const [, userId] of mocks.getActionRun.mock.calls) {
      expect(userId).toBe("user-one");
    }
  });

  it("records browser close as a resource event without terminalizing the parent run", async () => {
    mocks.appendActionEvent.mockResolvedValue({ id: "event-one" });

    const result = await recordBrowserSessionClosed(toolContext);

    expect(result.status).toBe("working");
    expect(mocks.appendActionEvent).toHaveBeenCalledWith({
      runId: "run-one",
      userId: "user-one",
      type: "browser.session.completed",
      payload: { browserSessionId: "session-one", reason: "user_closed" },
    });
    expect(mocks.transitionActionRun).not.toHaveBeenCalled();
    expect(mocks.recordActionEventActivity).not.toHaveBeenCalled();
  });

  it("returns control to paused, then resumes working on the same run", async () => {
    mocks.getActionRun.mockResolvedValueOnce({ ...run, status: "user_controlling" });
    mocks.transitionActionRunEventActivity.mockResolvedValueOnce({ ...run, status: "paused" });
    const returned = await markBrowserSessionControl("user-one", fakeSession(), "run-one");
    expect(returned?.status).toBe("paused");

    mocks.getActionRun.mockResolvedValueOnce({ ...run, status: "paused" });
    mocks.transitionActionRunEventActivity.mockResolvedValueOnce({ ...run, status: "working" });
    const started = await recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" });
    expect(started.status).toBe("working");
    expect(mocks.transitionActionRunEventActivity).toHaveBeenLastCalledWith(expect.objectContaining({ runId: "run-one", status: "working", eventType: "browser.action.started" }));
  });

  it("does not shortcut user_controlling directly to working", async () => {
    mocks.getActionRun.mockResolvedValueOnce({ ...run, status: "user_controlling" });

    await expect(
      recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" }),
    ).rejects.toMatchObject({ code: "ACTION_RUN_INVALID_TRANSITION" });
    expect(mocks.transitionActionRunEventActivity).not.toHaveBeenCalled();
    expect(mocks.recordActionEventActivity).not.toHaveBeenCalled();
  });
});

describe("legacy/recovery fallback path (non-canonical)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActionRun.mockResolvedValue(run);
    mocks.findOrCreateBrowserActionRun.mockResolvedValue(run);
    mocks.transitionActionRun.mockImplementation(async (id: string, _userId: string, status: string) => ({ ...run, id, status }));
  });

  it("recovers a run through the attached session association", async () => {
    mocks.getActionRunByBrowserSession.mockResolvedValue(run);

    const recovered = await findActiveBrowserActionRun("user-one", { browserSessionId: "session-one" });

    expect(recovered?.id).toBe("run-one");
    expect(mocks.getActionRunByBrowserSession).toHaveBeenCalledWith("user-one", "session-one");
    expect(mocks.findActiveActionRunForConversation).not.toHaveBeenCalled();
  });

  it("uses conversation lookup only when no better association exists", async () => {
    mocks.findActiveActionRunForConversation.mockResolvedValue(run);

    const recovered = await findActiveBrowserActionRun("user-one", { conversationId: "conversation-one" });

    expect(recovered?.id).toBe("run-one");
    expect(mocks.findActiveActionRunForConversation).toHaveBeenCalledWith("user-one", "conversation-one");
    expect(mocks.getActionRunByBrowserSession).not.toHaveBeenCalled();
  });

  it("prefers an explicit actionRunId over every fallback association", async () => {
    const resolved = await resolveBrowserActionRun("user-one", {
      actionRunId: "run-one",
      browserSessionId: "session-two",
    });

    expect(resolved?.id).toBe("run-one");
    expect(mocks.getActionRun).toHaveBeenCalledWith("run-one", "user-one");
    expect(mocks.getActionRunByBrowserSession).not.toHaveBeenCalled();
    expect(mocks.findActiveActionRunForConversation).not.toHaveBeenCalled();
  });

  it("boundary fallback creates at most one run per task, never one per tool call", async () => {
    const first = await startBrowserActionRun({ userId: "user-one", conversationId: "conversation-one" });
    const second = await startBrowserActionRun({ userId: "user-one", conversationId: "conversation-one" });

    expect(first.id).toBe("run-one");
    expect(second.id).toBe("run-one");
    // The advisory-locked find-or-create RPC dedupes; createActionRun is not
    // called per invocation.
    expect(mocks.findOrCreateBrowserActionRun).toHaveBeenCalledTimes(2);
    expect(mocks.createActionRun).not.toHaveBeenCalled();
  });
});

describe("run ownership, attachment, and terminal-state guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActionRun.mockResolvedValue(run);
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

  it("fails closed when the context session is not the run's attached session", async () => {
    // run-one is attached to session-one; a call carrying session-two must
    // NOT silently append browser actions to run-one.
    await expect(
      recordBrowserToolStarted({ ...toolContext, browserSessionId: "session-two", toolId: "browser.click" }),
    ).rejects.toMatchObject({ code: "ACTION_BROWSER_SESSION_MISMATCH" });
    expect(mocks.recordActionEventActivity).not.toHaveBeenCalled();
    expect(mocks.transitionActionRunEventActivity).not.toHaveBeenCalled();
    expect(mocks.appendActionEvent).not.toHaveBeenCalled();
  });

  it.each(["completed", "failed", "cancelled"] as const)("refuses to record browser work on a %s run", async (status) => {
    mocks.getActionRun.mockResolvedValue({ ...run, status });

    await expect(
      recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" }),
    ).rejects.toMatchObject({ code: "ACTION_RUN_TERMINAL" });
    expect(mocks.recordActionEventActivity).not.toHaveBeenCalled();
    expect(mocks.transitionActionRunEventActivity).not.toHaveBeenCalled();
    expect(mocks.appendActionEvent).not.toHaveBeenCalled();
  });

  it("emits nothing when the caller does not own the run", async () => {
    // Ownership scoping lives in the store: a foreign user's read of run-one
    // resolves to null, and no event may be emitted under their identity.
    mocks.getActionRun.mockImplementation(async (runId: string, userId: string) =>
      runId === "run-one" && userId === "user-one" ? run : null,
    );

    await expect(
      recordBrowserToolStarted({ ...toolContext, userId: "user-two", toolId: "browser.click" }),
    ).rejects.toMatchObject({ code: "ACTION_RUN_NOT_FOUND" });
    expect(mocks.getActionRun).toHaveBeenCalledWith("run-one", "user-two");
    expect(mocks.recordActionEventActivity).not.toHaveBeenCalled();
    expect(mocks.transitionActionRunEventActivity).not.toHaveBeenCalled();
    expect(mocks.appendActionEvent).not.toHaveBeenCalled();
  });

  it("fails closed with ACTION_RUN_NOT_FOUND instead of secretly creating a run", async () => {
    mocks.getActionRun.mockResolvedValue(null);

    await expect(
      recordBrowserToolStarted({ ...toolContext, toolId: "browser.click" }),
    ).rejects.toMatchObject({ code: "ACTION_RUN_NOT_FOUND" });
    // Low-level tool execution never creates an orphan run — only the outer
    // task/session boundary may create the fallback ActionRun.
    expect(mocks.createActionRun).not.toHaveBeenCalled();
    expect(mocks.findOrCreateBrowserActionRun).not.toHaveBeenCalled();
    expect(mocks.listActionRuns).not.toHaveBeenCalled();
    expect(mocks.appendActionEvent).not.toHaveBeenCalled();
  });
});

describe("durable persistence failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActionRun.mockResolvedValue(run);
  });

  it("propagates failures from both write paths — nothing pretends the event was recorded", async () => {
    // Transition path (paused -> working): failure inside the atomic RPC propagates.
    mocks.getActionRun.mockResolvedValueOnce({ ...run, status: "paused" });
    mocks.transitionActionRunEventActivity.mockRejectedValueOnce(new Error("db write lost"));
    await expect(
      recordBrowserToolStarted({ ...toolContext, toolId: "browser.navigate" }),
    ).rejects.toThrow("db write lost");

    // Event/activity path (already working): event insert failure propagates.
    mocks.recordActionEventActivity.mockRejectedValueOnce(new Error("event insert failed"));
    await expect(
      recordBrowserToolCompleted({ ...toolContext, toolId: "browser.navigate" }),
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
