// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for the explicit Studio execution cancellation endpoint.
 *
 * Browser/SSE disconnects do NOT cancel execution — this endpoint is the
 * only supported Stop path. It must be authenticated, conversation-scoped,
 * user-scoped, and idempotent.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/rate-limiter", () => ({
  withRateLimit: (handler: any) => handler,
}));

vi.mock("@/lib/studio/conversation-service", () => ({
  getConversation: vi.fn(),
}));

vi.mock("@/lib/studio/logger", () => ({
  studioLog: vi.fn(),
}));

vi.mock("@/lib/action-runtime", () => ({
  requestActionRunCancellation: vi.fn(() =>
    Promise.resolve({ id: "run-db-1", status: "waiting_for_user" }),
  ),
  findActiveActionRunForRequest: vi.fn(() => Promise.resolve(null)),
  transitionActionRun: vi.fn(() => Promise.resolve({})),
  isTerminalActionRunStatus: (s: string) =>
    s === "completed" || s === "failed" || s === "cancelled",
}));

import { auth } from "@/lib/auth";
import { getConversation } from "@/lib/studio/conversation-service";
import {
  registerExecution,
  requestExecutionCancellation,
  resetExecutionRegistryForTests,
  getActiveExecution,
} from "@/lib/studio/execution-registry";
import {
  findActiveActionRunForRequest,
  requestActionRunCancellation,
  transitionActionRun,
} from "@/lib/action-runtime";
import { POST } from "./route";

function makeRequest(body?: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/studio/conversations/conv-123/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

const params = { params: Promise.resolve({ conversationId: "conv-123" }) };

describe("POST /api/studio/conversations/[conversationId]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExecutionRegistryForTests();
    vi.mocked(findActiveActionRunForRequest).mockResolvedValue(null);
    vi.mocked(requestActionRunCancellation).mockResolvedValue({
      id: "run-db-1",
      status: "waiting_for_user",
    } as any);

    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getConversation).mockResolvedValue({
      id: "conv-123",
      ownerId: "user_123",
      projectId: "proj-123",
      revision: 3,
    } as any);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null, clerkId: null } as any);
    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(401);
  });

  it("returns 404 when the conversation is not owned by the user", async () => {
    vi.mocked(getConversation).mockResolvedValue(null);
    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(404);
  });

  it("aborts the active execution's AbortController", async () => {
    const controller = new AbortController();
    registerExecution({
      conversationId: "conv-123",
      userId: "user_123",
      clientRequestId: "req-abc",
      assistantMessageId: "msg-1",
      controller,
    });

    const res = await POST(makeRequest({ clientRequestId: "req-abc" }), params);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cancelled).toBe(true);
    expect(data.status).toBe("aborted");
    expect(controller.signal.aborted).toBe(true);
  });

  it("binds explicit Stop to the durable parent ActionRun", async () => {
    const controller = new AbortController();
    registerExecution({
      conversationId: "conv-123",
      userId: "user_123",
      clientRequestId: "req-runtime",
      assistantMessageId: "msg-runtime",
      actionRunId: "action-run-123",
      controller,
    });

    const res = await POST(makeRequest({ clientRequestId: "req-runtime" }), params);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cancelled).toBe(true);
    expect(data.actionRunId).toBe("action-run-123");
    expect(data.actionRunCancellation).toBe("requested");
    expect(requestActionRunCancellation).toHaveBeenCalledWith("action-run-123", "user_123");
  });

  it("requires clientRequestId — rejects without touching the registry", async () => {
    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(400);
    // No pending stamp was recorded — a later registration is unaffected.
    const controller = new AbortController();
    registerExecution({
      conversationId: "conv-123",
      userId: "user_123",
      clientRequestId: "req-later",
      assistantMessageId: "msg-later",
      controller,
    });
    expect(controller.signal.aborted).toBe(false);
  });

  it("is idempotent — safe when no execution is active", async () => {
    const res = await POST(makeRequest({ clientRequestId: "req-none" }), params);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("recorded");
  });

  it("is safe when called repeatedly", async () => {
    const controller = new AbortController();
    registerExecution({
      conversationId: "conv-123",
      userId: "user_123",
      clientRequestId: "req-abc",
      assistantMessageId: "msg-1",
      controller,
    });
    await POST(makeRequest({ clientRequestId: "req-abc" }), params);
    expect(controller.signal.aborted).toBe(true);
    // Second call — execution already aborted; still a safe 200.
    const res2 = await POST(makeRequest({ clientRequestId: "req-abc" }), params);
    expect(res2.status).toBe(200);
  });

  it("cannot cancel another user's execution (tenant isolation)", async () => {
    // An execution owned by a different user is registered under the same
    // conversation id. getConversation still resolves (mocked), but the
    // registry enforces the execution-level ownership check.
    const controller = new AbortController();
    registerExecution({
      conversationId: "conv-123",
      userId: "user_456",
      clientRequestId: "req-x",
      assistantMessageId: "msg-x",
      controller,
    });

    const res = await POST(makeRequest({ clientRequestId: "req-x" }), params);
    expect(res.status).toBe(403);
    expect(controller.signal.aborted).toBe(false);
    expect(getActiveExecution("conv-123")?.controller.signal.aborted).toBe(false);
  });

  it("does not abort a run whose clientRequestId does not match", async () => {
    const controller = new AbortController();
    registerExecution({
      conversationId: "conv-123",
      userId: "user_123",
      clientRequestId: "req-current",
      assistantMessageId: "msg-1",
      controller,
    });

    const res = await POST(makeRequest({ clientRequestId: "req-stale" }), params);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("not_found");
    expect(controller.signal.aborted).toBe(false);
  });

  it("cancels the durable run on registry miss (cross-replica / paused run)", async () => {
    // No local execution — the run is either on another replica or paused at
    // an approval gate. The durable run resolved by exact request identity
    // must still reach a terminal state.
    vi.mocked(findActiveActionRunForRequest).mockResolvedValue({
      id: "run-remote-9",
      status: "waiting_for_user",
    } as any);

    const res = await POST(makeRequest({ clientRequestId: "req-remote" }), params);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.actionRunId).toBe("run-remote-9");
    expect(data.actionRunCancellation).toBe("requested");
    expect(findActiveActionRunForRequest).toHaveBeenCalledWith(
      "user_123",
      "conv-123",
      "req-remote",
    );
    expect(requestActionRunCancellation).toHaveBeenCalledWith("run-remote-9", "user_123");
    // Paused run — no executor will consume the stamp; settle it directly.
    expect(transitionActionRun).toHaveBeenCalledWith(
      "run-remote-9",
      "user_123",
      "cancelled",
      { currentActivity: "Stopped by user" },
    );
  });

  it("does not settle a DB-resolved run that is already terminal", async () => {
    vi.mocked(findActiveActionRunForRequest).mockResolvedValue({
      id: "run-done",
      status: "waiting_for_user",
    } as any);
    vi.mocked(requestActionRunCancellation).mockResolvedValue({
      id: "run-done",
      status: "completed",
    } as any);

    const res = await POST(makeRequest({ clientRequestId: "req-done" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).actionRunCancellation).toBe("requested");
    expect(transitionActionRun).not.toHaveBeenCalled();
  });

  it("a stale request id cannot reach a different run via the DB fallback", async () => {
    // An active execution exists for a NEWER request. A cancel carrying an
    // old clientRequestId must not find or cancel that run — the idempotency
    // key match is exact.
    const controller = new AbortController();
    registerExecution({
      conversationId: "conv-123",
      userId: "user_123",
      clientRequestId: "req-current",
      assistantMessageId: "msg-1",
      actionRunId: "run-current",
      controller,
    });

    const res = await POST(makeRequest({ clientRequestId: "req-stale" }), params);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("not_found");
    expect(controller.signal.aborted).toBe(false);
    expect(findActiveActionRunForRequest).toHaveBeenCalledWith(
      "user_123",
      "conv-123",
      "req-stale",
    );
    expect(requestActionRunCancellation).not.toHaveBeenCalled();
  });

  it("registry hit keeps the single-path cancellation (no double settle)", async () => {
    const controller = new AbortController();
    registerExecution({
      conversationId: "conv-123",
      userId: "user_123",
      clientRequestId: "req-local",
      assistantMessageId: "msg-local",
      actionRunId: "run-local",
      controller,
    });

    const res = await POST(makeRequest({ clientRequestId: "req-local" }), params);
    expect(res.status).toBe(200);
    expect(controller.signal.aborted).toBe(true);
    expect(requestActionRunCancellation).toHaveBeenCalledWith("run-local", "user_123");
    // Local executor exists — launch flow settles the terminal transition.
    expect(transitionActionRun).not.toHaveBeenCalled();
    expect(findActiveActionRunForRequest).not.toHaveBeenCalled();
  });

  it("a pending cancellation pre-aborts a run that registers moments later (Stop race)", async () => {
    // Stop arrives while the send POST is still in flight — before the
    // stream registers its execution.
    const res = await POST(makeRequest({ clientRequestId: "req-late" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("recorded");

    const controller = new AbortController();
    registerExecution({
      conversationId: "conv-123",
      userId: "user_123",
      clientRequestId: "req-late",
      assistantMessageId: "msg-late",
      controller,
    });
    expect(controller.signal.aborted).toBe(true);
  });

  it("an unowned conversation returns 404 and records no pending cancellation", async () => {
    // Attacker knows/guesses a conversation id they don't own. Ownership is
    // verified BEFORE the registry is touched, so no pending stamp may be
    // created for the real owner's next run.
    vi.mocked(getConversation).mockResolvedValue(null);
    const res = await POST(makeRequest({ clientRequestId: "req-target" }), params);
    expect(res.status).toBe(404);

    // Prove no pending stamp exists: a run registering with the attacked
    // request id must NOT be pre-aborted.
    const controller = new AbortController();
    registerExecution({
      conversationId: "conv-123",
      userId: "user_123",
      clientRequestId: "req-target",
      assistantMessageId: "msg-target",
      controller,
    });
    expect(controller.signal.aborted).toBe(false);
    expect(getActiveExecution("conv-123")?.controller.signal.aborted).toBe(false);
  });
});
