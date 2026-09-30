import { describe, expect, it } from "vitest";
import { canonicalBrowserJobsForScope } from "./canonical-browser";
import type { ActionRun } from "@/lib/action-runtime/types";
import type { StudioTask } from "./task-types";

const run = (id: string, projectId: string): ActionRun => ({
  id, userId: "user-1", projectId, conversationId: `${id}-conversation`, kind: "browser", status: "completed",
  createdAt: "2026-09-29T00:00:00.000Z", startedAt: null, updatedAt: "2026-09-29T00:00:00.000Z", completedAt: null,
  currentActivity: null, browserSessionId: `${id}-session`, cancellationRequestedAt: null, approvalReference: null,
  failureCode: null, failureMessage: null,
});

const task = (id: string, projectId: string, actionRunId: string): StudioTask => ({
  id, userId: "user-1", projectId, title: id, taskType: "browser", status: "complete", conversationId: `${id}-conversation`,
  activeActionRunId: null, latestActionRunId: actionRunId, browserSessionId: `${actionRunId}-session`, previewWorkspaceId: null,
  previewUrl: null, selectedArtifact: null, verificationState: {}, metadata: {}, lastOpenedSurface: "browser",
  lastOpenedAt: null, archivedAt: null, createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z",
});

describe("canonical Studio Browser ownership", () => {
  it("only renders task-linked ActionRuns", () => {
    const jobs = canonicalBrowserJobsForScope([run("run-a", "project-a"), run("run-b", "project-b")], [task("task-a", "project-a", "run-a")]);
    expect(jobs.map((job) => job.jobId)).toEqual(["run-a"]);
  });

  it("returns an honest empty state for a fresh project", () => {
    expect(canonicalBrowserJobsForScope([run("run-a", "project-a")], [])).toEqual([]);
  });
});
