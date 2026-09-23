import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActionRun: vi.fn(),
  patchActionRun: vi.fn(),
  recordActionEventActivity: vi.fn(),
  transitionActionRunEventActivity: vi.fn(),
}));

vi.mock("./run-store", () => mocks);

import {
  actionToolResultFailed,
  markActionToolRunPersistenceDegraded,
  recordActionToolCompleted,
  recordActionToolFailed,
  recordActionToolStarted,
} from "./tool-runtime";
import type { ActionRun } from "./types";

const context = {
  actionRunId: "run-one",
  userId: "user-one",
  conversationId: "conversation-one",
  projectId: "project-one",
};

function run(status: ActionRun["status"]): ActionRun {
  return {
    id: "run-one",
    userId: "user-one",
    projectId: "project-one",
    conversationId: "conversation-one",
    kind: "composite",
    status,
    createdAt: "2026-09-23T00:00:00.000Z",
    startedAt: "2026-09-23T00:00:01.000Z",
    updatedAt: "2026-09-23T00:00:01.000Z",
    completedAt: null,
    currentActivity: "LiTT is working on the task",
    browserSessionId: null,
    cancellationRequestedAt: null,
    approvalReference: null,
    failureCode: null,
    failureMessage: null,
  };
}

describe("tool-runtime — composite ActionRun tool events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActionRun.mockResolvedValue(run("working"));
    mocks.recordActionEventActivity.mockResolvedValue(run("working"));
    mocks.transitionActionRunEventActivity.mockResolvedValue(run("working"));
    mocks.patchActionRun.mockResolvedValue(run("working"));
  });

  it("records ordinary workspace tools on the same parent run", async () => {
    await recordActionToolStarted(context, "files.write");
    await recordActionToolCompleted(context, "files.write");

    expect(mocks.recordActionEventActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        runId: "run-one",
        userId: "user-one",
        type: "tool.started",
        payload: { toolId: "files.write" },
      }),
    );
    expect(mocks.recordActionEventActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        runId: "run-one",
        userId: "user-one",
        type: "tool.completed",
      }),
    );
  });

  it("uses deployment lifecycle events for deploy tools", async () => {
    await recordActionToolStarted(context, "project.deploy");
    await recordActionToolFailed(context, "project.deploy", new Error("Railway deployment failed"));

    expect(mocks.recordActionEventActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: "deployment.started" }),
    );
    expect(mocks.recordActionEventActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "deployment.failed",
        payload: expect.objectContaining({ error: "Railway deployment failed" }),
      }),
    );
  });

  it("atomically moves a queued parent to working when tool work starts", async () => {
    mocks.getActionRun.mockResolvedValue(run("queued"));

    await recordActionToolStarted(context, "files.patch");

    expect(mocks.transitionActionRunEventActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-one",
        status: "working",
        eventType: "tool.started",
      }),
    );
    expect(mocks.recordActionEventActivity).not.toHaveBeenCalled();
  });

  it("refuses tool execution on a terminal parent", async () => {
    mocks.getActionRun.mockResolvedValue(run("completed"));

    await expect(recordActionToolStarted(context, "files.write")).rejects.toMatchObject({
      code: "ACTION_RUN_TERMINAL",
    });
    expect(mocks.recordActionEventActivity).not.toHaveBeenCalled();
  });

  it("classifies structured domain failures as tool failures", () => {
    expect(actionToolResultFailed({ success: false, error: "write failed" })).toBe("write failed");
    expect(actionToolResultFailed({ ok: false, message: "deployment failed" })).toBe("deployment failed");
    expect(actionToolResultFailed({ success: true })).toBeNull();
    expect(actionToolResultFailed(null)).toBeNull();
  });

  it("marks persistence degradation without throwing a second failure", async () => {
    await expect(markActionToolRunPersistenceDegraded(context)).resolves.toBeUndefined();
    expect(mocks.patchActionRun).toHaveBeenCalledWith("run-one", "user-one", {
      failureCode: "ACTION_RUNTIME_PERSISTENCE_FAILED",
      failureMessage: "Durable Action Runtime persistence failed during tool execution",
    });
  });
});
