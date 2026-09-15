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

import { auth } from "@/lib/auth";
import { getConversation } from "@/lib/studio/conversation-service";
import {
  registerExecution,
  requestExecutionCancellation,
  resetExecutionRegistryForTests,
  getActiveExecution,
} from "@/lib/studio/execution-registry";
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
