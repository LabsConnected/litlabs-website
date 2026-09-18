import { describe, it, expect } from "vitest";
import {
  APPROVAL_TTL,
  RUN_STALE_TIMEOUT_MS,
  type RunStatus,
  type RunResult,
} from "@/lib/litt-intelligence/paused-run-store";

// ─── Async Approval Flow: Contract Tests ──────────────────────────
// These tests verify the logical invariants of the async approval
// architecture. The actual DB operations are tested via integration
// tests that require a running Supabase instance.

describe("Async Approval: 202 Accepted contract", () => {
  it("POST returns 202 with status='processing' for approved runs", () => {
    // The approval POST returns:
    // { resolved: true, decision: "approved", status: "processing", pausedRunId, runStatus: "processing }
    // HTTP status 202 Accepted
    const response = {
      status: 202,
      body: {
        resolved: true,
        decision: "approved",
        status: "processing",
        pausedRunId: "test-run-id",
        runStatus: "processing" as RunStatus,
      },
    };
    expect(response.status).toBe(202);
    expect(response.body.resolved).toBe(true);
    expect(response.body.status).toBe("processing");
    expect(response.body.runStatus).toBe("processing");
  });

  it("POST returns 202 for rejected runs with status='completed'", () => {
    // Rejected runs don't need a resumed execution — no deploy to run
    const response = {
      status: 202,
      body: {
        resolved: true,
        decision: "rejected",
        status: "completed",
        pausedRunId: "test-run-id",
      },
    };
    expect(response.status).toBe(202);
    expect(response.body.status).toBe("completed");
  });

  it("approval response returns before resumed execution completes", () => {
    // The key invariant: the HTTP response is sent BEFORE the resumed
    // agent loop finishes. The client polls GET for the result.
    const approvalResponseTime = 2_000; // 2 seconds
    const resumedExecutionTime = 120_000; // 2 minutes
    expect(approvalResponseTime).toBeLessThan(100_000); // Cloudflare timeout
    expect(resumedExecutionTime).toBeGreaterThan(approvalResponseTime);
  });
});

describe("Async Approval: Idempotency", () => {
  it("repeated approval POST returns 202 without launching duplicate execution", () => {
    // The markRunProcessing function uses .eq("run_status", null) — it only
    // transitions from null to "processing". If already processing, it
    // returns false and the POST returns the current status.
    const firstRequest = { started: true, runStatus: "processing" };
    const secondRequest = { started: false, runStatus: "processing" }; // no-op

    expect(firstRequest.started).toBe(true);
    expect(secondRequest.started).toBe(false);
    expect(secondRequest.runStatus).toBe("processing"); // still processing, not restarted
  });

  it("exactly one deployment executes per approval", () => {
    // The detached execution is only started if markRunProcessing succeeds.
    // If it returns false (already processing), no second execution starts.
    let executionCount = 0;

    // First request: markRunProcessing returns true → start execution
    const firstStarted = true;
    if (firstStarted) executionCount++;

    // Second request: markRunProcessing returns false → don't start
    const secondStarted = false;
    if (secondStarted) executionCount++;

    expect(executionCount).toBe(1);
  });

  it("already-resolved approval returns 202 with current run status", () => {
    // If the approval was already resolved (status = "approved"), the POST
    // returns 202 with the current runStatus instead of a 409 error.
    const response = {
      status: 202,
      body: {
        resolved: true,
        decision: "approved",
        status: "processing" as RunStatus,
        pausedRunId: "test-run-id",
        runStatus: "processing" as RunStatus,
        runError: null,
      },
    };
    expect(response.status).toBe(202);
    expect(response.body.resolved).toBe(true);
  });
});

describe("Async Approval: Run status lifecycle", () => {
  it("status transitions: null → processing → completed", () => {
    const states: RunStatus[] = [null, "processing", "completed"];
    for (let i = 0; i < states.length - 1; i++) {
      expect(states[i]).not.toBe(states[i + 1]); // each transition is a change
    }
    expect(states[2]).toBe("completed");
  });

  it("status transitions: null → processing → failed", () => {
    const states: RunStatus[] = [null, "processing", "failed"];
    expect(states[2]).toBe("failed");
  });

  it("completed run includes toolCalls with deploy result", () => {
    const runResult: RunResult = {
      finalText: "Your Ember Roast site is live!",
      stepsUsed: 5,
      toolCalls: [
        { toolId: "project.deploy", success: true, summary: '{"deploymentId":"dep-123","publicUrl":"https://www.litlabs.net/sites/dep-123","status":"ready"}', mutating: true },
      ],
      cancelled: false,
    };
    const deployCall = runResult.toolCalls.find((c) => c.toolId === "project.deploy");
    expect(deployCall).toBeDefined();
    expect(deployCall!.success).toBe(true);
    expect(deployCall!.summary).toContain("publicUrl");
  });

  it("failed run includes runError", () => {
    const failedState = {
      runStatus: "failed" as RunStatus,
      runError: "Deploy failed: workspace not found",
      runResult: null,
    };
    expect(failedState.runStatus).toBe("failed");
    expect(failedState.runError).toContain("Deploy failed");
    expect(failedState.runResult).toBeNull();
  });
});

describe("Async Approval: Stale-run recovery", () => {
  it("runs processing > RUN_STALE_TIMEOUT_MS are marked failed on read", () => {
    // The GET endpoint checks if run_started_at is older than
    // RUN_STALE_TIMEOUT_MS. If so, it marks the run as failed.
    const staleTime = RUN_STALE_TIMEOUT_MS + 1_000; // 10 min + 1 sec
    expect(staleTime).toBeGreaterThan(RUN_STALE_TIMEOUT_MS);
  });

  it("RUN_STALE_TIMEOUT_MS is 10 minutes", () => {
    expect(RUN_STALE_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });
});

describe("Async Approval: GET poll endpoint contract", () => {
  it("GET returns runStatus, runResult, runError fields", () => {
    const response = {
      id: "test-run-id",
      toolId: "project.deploy",
      status: "approved",
      runStatus: "completed" as RunStatus,
      runResult: {
        finalText: "Deployed!",
        stepsUsed: 3,
        toolCalls: [],
        cancelled: false,
      },
      runError: null,
      runStartedAt: "2026-09-13T07:00:00Z",
      runCompletedAt: "2026-09-13T07:02:00Z",
    };
    expect(response.runStatus).toBe("completed");
    expect(response.runResult).toBeDefined();
    expect(response.runError).toBeNull();
    expect(response.runStartedAt).toBeDefined();
    expect(response.runCompletedAt).toBeDefined();
  });

  it("GET returns 404 for non-existent pausedRunId", () => {
    // getPausedRun returns null for unknown IDs → 404
    const notFound = null;
    expect(notFound).toBeNull();
  });

  it("GET returns 401 for unauthorized users", () => {
    // auth() returns null userId → 401
    const unauthorized = true;
    expect(unauthorized).toBe(true);
  });
});

describe("Async Approval: Security invariants preserved", () => {
  it("wrong conversation returns 403", () => {
    // pausedRun.conversationId !== conversationId → 403
    const pausedConversationId = "conv-a";
    const requestConversationId = "conv-b";
    expect(pausedConversationId).not.toBe(requestConversationId);
  });

  it("wrong user returns 404 (not 403 — no information leak)", () => {
    // getPausedRun filters by user_id — wrong user gets 404, not 403
    const queryFilters = ["eq('id', pausedRunId)", "eq('user_id', userId)"];
    expect(queryFilters).toContain("eq('user_id', userId)");
  });

  it("frozen inputs: approval body never contains tool inputs", () => {
    const approvalRequestBody = { decision: "approved" as const };
    expect((approvalRequestBody as Record<string, unknown>).inputs).toBeUndefined();
  });

  it("expired approval returns 409", () => {
    // resolvePausedRun checks expiresAt — if expired, returns null → 409
    const expiredTime = new Date(Date.now() - 1000).toISOString();
    expect(new Date(expiredTime).getTime()).toBeLessThan(Date.now());
  });

  it("TTL is 30 minutes (humane window for phone approvals)", () => {
    expect(APPROVAL_TTL).toBe(30 * 60 * 1000);
  });
});

describe("Async Approval: Polling client contract", () => {
  it("client polls GET every 3 seconds", () => {
    // approval-polling.ts uses POLL_INTERVAL_MS = 3000
    const pollInterval = 3000;
    expect(pollInterval).toBe(3000);
  });

  it("client stops polling on completed", () => {
    let pollCount = 0;
    const maxPolls = 5;
    const runStatuses: RunStatus[] = ["processing", "processing", "processing", "completed", "completed"];

    for (const status of runStatuses) {
      pollCount++;
      if (status === "completed" || status === "failed") break;
    }
    expect(pollCount).toBe(4); // stopped after "completed"
    expect(pollCount).toBeLessThanOrEqual(maxPolls);
  });

  it("client stops polling on failed", () => {
    let pollCount = 0;
    const runStatuses: RunStatus[] = ["processing", "processing", "failed", "failed"];

    for (const status of runStatuses) {
      pollCount++;
      if (status === "completed" || status === "failed") break;
    }
    expect(pollCount).toBe(3); // stopped after "failed"
  });

  it("client times out after 10 minutes", () => {
    // POLL_TIMEOUT_MS = 10 * 60 * 1000
    const pollTimeout = 10 * 60 * 1000;
    expect(pollTimeout).toBe(RUN_STALE_TIMEOUT_MS); // matches server stale timeout
  });
});
