import { describe, expect, it } from "vitest";
import { filterBrowserJobsForScope, type BrowserJob } from "./browser-jobs";

function job(id: string, params: Record<string, unknown>): BrowserJob {
  return {
    id,
    userId: "user-1",
    jobType: "ghl.workflow.inspect",
    goal: id,
    riskLevel: "low",
    requestedBy: "studio",
    idempotencyKey: id,
    status: "completed",
    params,
    result: null,
    error: null,
    progress: { step: 0, totalSteps: 0, steps: [] },
    browserSessionId: null,
    liveViewUrl: null,
    approvedBy: null,
    approvedAt: null,
    attempts: 1,
    maxAttempts: 3,
    createdAt: "2026-09-29T00:00:00.000Z",
    startedAt: null,
    completedAt: "2026-09-29T00:01:00.000Z",
    updatedAt: "2026-09-29T00:01:00.000Z",
  };
}

describe("browser job Studio scope", () => {
  it("does not show project A or unbound history in project B", () => {
    const jobs = [
      job("a", { projectId: "project-a", conversationId: "conv-a" }),
      job("b", { project_id: "project-b", conversation_id: "conv-b" }),
      job("legacy", { workflowName: "old unbound session" }),
    ];

    expect(filterBrowserJobsForScope(jobs, { projectId: "project-b", conversationId: "conv-b" }).map((j) => j.id)).toEqual(["b"]);
    expect(filterBrowserJobsForScope(jobs, { projectId: "project-a", conversationId: "conv-new" }).map((j) => j.id)).toEqual([]);
    expect(filterBrowserJobsForScope(jobs, { projectId: "project-b" }).map((j) => j.id)).toEqual(["b"]);
  });
});
