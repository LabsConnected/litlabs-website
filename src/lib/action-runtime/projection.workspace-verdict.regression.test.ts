import { describe, expect, it } from "vitest";

import { buildActionRunProjection } from "./projection";
import type { ActionEvent, ActionRun } from "./types";

/**
 * Regression tests — the Verify stage can see the workspace verdict
 * (Repair R3, Diagnosis E4-S4/R5).
 *
 * The defect: the projection's verification capability was driven ONLY
 * by deploy-verification tool ids (deploy.verify / deployment.verify /
 * site.verify / url.verify) and deployment verification. A static
 * build — whose only verification IS the workspace-change verdict —
 * could therefore show "Verify · —" forever, even though the verdict
 * was persisted on the run as an agent.status action event with
 * payload.kind "workspace_change" (progress-event-persistence).
 *
 * The wiring: the projection now consumes that persisted event. It is
 * exposed verbatim as projection.workspaceChange, and — only when NO
 * deploy-verification evidence exists — the verification capability
 * reflects it: changed/unchanged means the verification ran and
 * answered ("completed"); unknown means it could not answer
 * ("failed", surfaced — never dressed up as success). Deploy
 * verification keeps precedence wherever it exists.
 */

function run(overrides: Partial<ActionRun> = {}): ActionRun {
  return {
    id: "run-one",
    userId: "user-one",
    projectId: "project-one",
    conversationId: "conversation-one",
    kind: "composite",
    status: "working",
    createdAt: "2026-10-20T00:00:00.000Z",
    startedAt: "2026-10-20T00:00:01.000Z",
    updatedAt: "2026-10-20T00:00:02.000Z",
    completedAt: null,
    currentActivity: "Building",
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
    createdAt: `2026-10-20T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload,
  };
}

/** The persisted shape progress-event-persistence writes for a verdict. */
function workspaceChangeEvent(status: "changed" | "unchanged" | "unknown", fileCount = 0) {
  return event("agent.status", {
    kind: "workspace_change",
    status,
    fileCount,
    files: status === "changed" ? ["index.html"] : [],
    label: status === "changed" ? `Workspace changed: ${fileCount} file` : `Workspace ${status}`,
  });
}

describe("buildActionRunProjection — workspace verdict wiring (R3/E4-R5)", () => {
  it("exposes the persisted verdict and completes Verify from it on a static build", () => {
    const projection = buildActionRunProjection({
      run: run({ status: "completed" }),
      events: [event("run.created"), workspaceChangeEvent("changed", 1)],
    });

    expect(projection.workspaceChange).toMatchObject({
      status: "changed",
      fileCount: 1,
      files: ["index.html"],
    });
    expect(projection.capabilities.verification.status).toBe("completed");
  });

  it("an unknown verdict surfaces Verify as failed — never as success or silence", () => {
    const projection = buildActionRunProjection({
      run: run({ status: "completed" }),
      events: [event("run.created"), workspaceChangeEvent("unknown")],
    });

    expect(projection.workspaceChange).toMatchObject({ status: "unknown" });
    expect(projection.capabilities.verification.status).toBe("failed");
  });

  it("deploy verification keeps precedence over the workspace verdict", () => {
    const projection = buildActionRunProjection({
      run: run({ status: "completed" }),
      events: [
        event("run.created"),
        workspaceChangeEvent("unknown"),
        event("tool.completed", { toolId: "deploy.verify" }),
      ],
    });

    // The deploy-verification tool completed: Verify is completed by
    // THAT evidence, exactly as before — the (unknown) workspace
    // verdict must not drag it down.
    expect(projection.capabilities.verification.status).toBe("completed");
    expect(projection.workspaceChange).toMatchObject({ status: "unknown" });
  });

  it("no verdict event → workspaceChange is null and Verify stays untouched", () => {
    const projection = buildActionRunProjection({
      run: run(),
      events: [event("run.created")],
    });

    expect(projection.workspaceChange).toBeNull();
    expect(projection.capabilities.verification.status).toBe("not_started");
  });
});
