// @vitest-environment node
/**
 * Studio regenerate must refuse the provider call when the wallet cannot
 * cover the estimate, and must mark the placeholder assistant message failed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  authMock,
  meteredLlmCallMock,
  getConversationMock,
  getMessageMock,
  listMessagesMock,
  insertMessageMock,
  updateMessageStatusMock,
  resolveAgentMock,
  buildStudioContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  meteredLlmCallMock: vi.fn(),
  getConversationMock: vi.fn(),
  getMessageMock: vi.fn(),
  listMessagesMock: vi.fn(),
  insertMessageMock: vi.fn(),
  updateMessageStatusMock: vi.fn(),
  resolveAgentMock: vi.fn(),
  buildStudioContextMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: (handler: unknown) => handler }));
vi.mock("@/lib/metered-llm-call", () => ({ meteredLlmCall: meteredLlmCallMock }));
vi.mock("@/lib/studio/conversation-service", () => ({
  getConversation: getConversationMock,
  getMessage: getMessageMock,
  listMessages: listMessagesMock,
  insertMessage: insertMessageMock,
  updateMessageStatus: updateMessageStatusMock,
}));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/studio/agent-registry", () => ({ resolveAgent: resolveAgentMock }));
vi.mock("@/lib/studio/project-resolver", () => ({
  buildStudioContext: buildStudioContextMock,
  buildProjectContextBlock: vi.fn(() => ""),
}));
vi.mock("@/lib/studio/memory-service", () => ({
  recallMemories: vi.fn(async () => []),
  formatMemoryContext: vi.fn(() => ""),
}));
vi.mock("@/lib/context/context-engine", () => ({
  buildUserContext: vi.fn(async () => ({})),
  buildContextBlock: vi.fn(() => ""),
}));
vi.mock("@/lib/studio/logger", () => ({ studioLog: vi.fn() }));
vi.mock("@/lib/capabilities/translate", () => ({
  translateCapabilities: vi.fn(() => ({ contextBlock: "" })),
}));
vi.mock("@/lib/litt-kernel", () => ({
  routeKernel: vi.fn(() => ({ decision: {} })),
  composeSystemPrompt: vi.fn(() => ""),
  adaptLegacyCapability: vi.fn(),
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: "clerk_studio" });
  getConversationMock.mockResolvedValue({
    id: "conv-1",
    projectId: "proj-1",
    activeAgentSlug: "director",
    revision: 2,
    title: "Chat",
  });
  getMessageMock.mockImplementation(async (id: string) => {
    if (id === "asst-old") {
      return {
        id: "asst-old",
        conversationId: "conv-1",
        role: "assistant",
        parentMessageId: "user-1",
        agentSlug: "director",
        content: "old",
        status: "completed",
      };
    }
    return {
      id: "user-1",
      conversationId: "conv-1",
      role: "user",
      content: "redraw it",
      status: "completed",
    };
  });
  listMessagesMock.mockResolvedValue([
    { id: "user-1", role: "user", content: "redraw it", status: "completed" },
    { id: "asst-old", role: "assistant", content: "old", status: "completed" },
  ]);
  resolveAgentMock.mockReturnValue({ displayName: "LiTT" });
  buildStudioContextMock.mockResolvedValue({
    projectId: "proj-1",
    projectName: "Lab",
    repositoryName: null,
    activeBranch: null,
    capabilities: {
      repositoryConnected: false,
      terminalConnected: false,
      availableTools: [],
      connectionSummary: "",
    },
  });
  insertMessageMock.mockResolvedValue({
    message: { id: "asst-new", content: "", status: "streaming" },
  });
  updateMessageStatusMock.mockResolvedValue(true);
});

describe("POST regenerate billing", () => {
  it("returns 402, marks the new assistant failed, and does not complete it", async () => {
    meteredLlmCallMock.mockResolvedValue({
      ok: false,
      status: 402,
      error: "Insufficient LiTTBits",
      code: "insufficient_credits",
    });

    const req = new NextRequest("http://localhost/api/studio/conversations/conv-1/regenerate", {
      method: "POST",
      body: JSON.stringify({ assistantMessageId: "asst-old" }),
    });
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-1" }) });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("insufficient_credits");
    expect(body.assistantMessage.status).toBe("failed");
    expect(meteredLlmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkId: "clerk_studio",
        feature: "studio-regenerate",
        callId: "studio-regenerate:asst-new",
      }),
    );
    expect(updateMessageStatusMock).toHaveBeenCalledWith(
      "asst-new",
      "clerk_studio",
      "failed",
      "Insufficient LiTTBits",
    );
    expect(updateMessageStatusMock).not.toHaveBeenCalledWith(
      "asst-new",
      "clerk_studio",
      "completed",
      expect.anything(),
    );
  });

  it("returns the debit RPC error and marks the assistant failed", async () => {
    meteredLlmCallMock.mockResolvedValue({
      ok: false,
      status: 503,
      error: "debit_credits failed: ledger down",
      code: "billing_unavailable",
    });

    const req = new NextRequest("http://localhost/api/studio/conversations/conv-1/regenerate", {
      method: "POST",
      body: JSON.stringify({ assistantMessageId: "asst-old" }),
    });
    const res = await POST(req, { params: Promise.resolve({ conversationId: "conv-1" }) });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("debit_credits failed: ledger down");
    expect(body.code).toBe("billing_unavailable");
    expect(body.assistantMessage.status).toBe("failed");
    expect(updateMessageStatusMock).toHaveBeenCalledWith(
      "asst-new",
      "clerk_studio",
      "failed",
      "debit_credits failed: ledger down",
    );
    expect(updateMessageStatusMock).not.toHaveBeenCalledWith(
      "asst-new",
      "clerk_studio",
      "completed",
      expect.anything(),
    );
  });
});
