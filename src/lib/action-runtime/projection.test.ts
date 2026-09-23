import { describe, expect, it } from "vitest";

import { buildActionRunProjection } from "./projection";
import type { ActionEvent, ActionRun } from "./types";
import type { PausedRunRecord } from "@/lib/litt-intelligence/paused-run-store";

function run(overrides: Partial<ActionRun> = {}): ActionRun {
  return {
    id: "run-one",
    userId: "user-one",
    projectId: "project-one",
    conversationId: "conversation-one",
    kind: "composite",
    status: "working",
    createdAt: "2026-09-23T00:00:00.000Z",
    startedAt: "2026-09-23T00:00:01.000Z",
    updatedAt: "2026-09-23T00:00:02.000Z",
    completedAt: null,
    currentActivity: "Running deployment checks",
    browserSessionId: null,
    cancellationRequestedAt: null,
    approvalReference: null,
    failureCode: null,
    failureMessage: null,
    ...overrides,
  };
}

let sequence = 0;
function event(type: ActionEvent["type"], payload: ActionEvent["payload"] = {}): ActionEvent {
  sequence += 1;
  return {
    id: `event-${sequence}`,
    sequence: String(sequence),
    runId: "run-one",
    userId: "user-one",
    type,
    createdAt: `2026-09-23T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload,
  };
}

function pausedRun(overrides: Partial<PausedRunRecord> = {}): PausedRunRecord {
  return {
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
    executionMode: "act",
    systemPrompt: "system",
    checkpointId: null,
    actionRunId: "run-one",
    status: "pending",
    createdAt: "2026-09-23T00:00:03.000Z",
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
    ...overrides,
  };
}

describe("buildActionRunProjection", () => {
  it("answers Studio's composite-run status questions from one canonical shape", () => {
    const projection = buildActionRunProjection({
      run: run(),
      events: [
        event("run.created"),
        event("agent.started"),
        event("tool.started", { toolId: "files.write" }),
        event("tool.completed", { toolId: "files.write" }),
        event("preview.started"),
        event("preview.ready"),
        event("deployment.started", { toolId: "project.deploy" }),
        event("deployment.completed", {
          toolId: "project.deploy",
          deploymentId: "dep-123",
          publicUrl: "https://site.example.com",
          verified: true,
          httpStatus: 200,
        }),
      ],
      pausedRuns: [],
    });

    expect(projection.displayState).toBe("running");
    expect(projection.currentActivity).toBe("Running deployment checks");
    expect(projection.capabilities.files.status).toBe("completed");
    expect(projection.capabilities.preview.status).toBe("ready");
    expect(projection.capabilities.deployment).toMatchObject({
      status: "completed",
      deploymentId: "dep-123",
      publicUrl: "https://site.example.com",
      verified: true,
    });
    expect(projection.capabilities.verification.status).toBe("completed");
    expect(projection.tools.completed).toContain("files.write");
    expect(projection.failure).toBeNull();
  });

  it("surfaces a durable pending approval as the blocking state", () => {
    const projection = buildActionRunProjection({
      run: run({ status: "waiting_for_user", approvalReference: "paused-one" }),
      events: [event("approval.required", { toolId: "project.deploy" })],
      pausedRuns: [pausedRun()],
    });

    expect(projection.displayState).toBe("awaiting_approval");
    expect(projection.pendingApprovals).toHaveLength(1);
    expect(projection.pendingApprovals[0]).toMatchObject({
      id: "paused-one",
      toolId: "project.deploy",
      actionRunId: "run-one",
    });
  });

  it("reports explicit cancellation without inventing deployment success", () => {
    const projection = buildActionRunProjection({
      run: run({ status: "cancelled", cancellationRequestedAt: "2026-09-23T00:00:10.000Z" }),
      events: [
        event("tool.started", { toolId: "terminal.execute" }),
        event("cancellation.requested"),
        event("run.cancelled"),
      ],
      pausedRuns: [pausedRun()],
    });

    expect(projection.displayState).toBe("stopped");
    expect(projection.capabilities.deployment.status).toBe("not_started");
    expect(projection.capabilities.terminal.status).toBe("cancelled");
    expect(projection.pendingApprovals).toHaveLength(0);
    expect(projection.deployment.publicUrl).toBeNull();
    expect(projection.tools.running).not.toContain("terminal.execute");
  });

  it("keeps failed stages truthful and finds the last human-readable failure", () => {
    const projection = buildActionRunProjection({
      run: run({ status: "failed", failureCode: "DEPLOY_FAILED" }),
      events: [
        event("deployment.started", { toolId: "project.deploy" }),
        event("deployment.failed", { toolId: "project.deploy", error: "Railway build failed" }),
      ],
      pausedRuns: [],
    });

    expect(projection.displayState).toBe("failed");
    expect(projection.capabilities.deployment.status).toBe("failed");
    expect(projection.failure).toMatchObject({
      code: "DEPLOY_FAILED",
      message: "Railway build failed",
    });
  });
});
