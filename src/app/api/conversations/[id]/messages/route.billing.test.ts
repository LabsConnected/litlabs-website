// @vitest-environment node
/**
 * Conversation messages must pre-check balance and debit idempotently.
 * A 402 must not persist an assistant reply.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authMock, meteredLlmCallMock, fromMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  meteredLlmCallMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/metered-llm-call", () => ({ meteredLlmCall: meteredLlmCallMock }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: fromMock } }));

import { POST } from "./route";

function query(table: string) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = self;
  builder.eq = self;
  builder.order = self;
  builder.update = self;
  builder.limit = () => Promise.resolve({ data: [{ role: "user", content: "hi" }], error: null });
  builder.insert = (row: { role?: string }) => {
    builder.inserted = row;
    return builder;
  };
  builder.single = async () => {
    if (table === "users") return { data: { id: "db-user-1" }, error: null };
    if (table === "conversations") {
      return {
        data: {
          id: "conv-1",
          agent: { name: "Nova", system_prompt: "Be Nova", personality: "calm", role: "guide" },
        },
        error: null,
      };
    }
    const inserted = builder.inserted as { role?: string; content?: string } | undefined;
    return { data: { id: inserted?.role === "assistant" ? "asst-1" : "user-msg-1", ...inserted }, error: null };
  };
  return builder;
}

function request() {
  return new NextRequest("http://localhost/api/conversations/conv-1/messages", {
    method: "POST",
    body: JSON.stringify({ content: "hello" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: "clerk_convo" });
  fromMock.mockImplementation((table: string) => query(table));
});

describe("POST /api/conversations/[id]/messages billing", () => {
  it("returns 402 and does not insert an assistant message", async () => {
    meteredLlmCallMock.mockResolvedValue({
      ok: false,
      status: 402,
      error: "Insufficient LiTTBits",
      code: "insufficient_credits",
    });

    const res = await POST(request(), { params: Promise.resolve({ id: "conv-1" }) });
    expect(res.status).toBe(402);

    const messageInserts = fromMock.mock.calls
      .filter((call) => call[0] === "messages")
      .length;
    // user row is inserted before the gate; the assistant row is not.
    const inserts = fromMock.mock.results
      .map((result) => result.value?.inserted)
      .filter(Boolean);
    expect(inserts).toEqual([expect.objectContaining({ role: "user" })]);
    expect(messageInserts).toBeGreaterThan(0);
    expect(meteredLlmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkId: "clerk_convo",
        feature: "conversations-messages",
        callId: "conversations-messages:user-msg-1",
      }),
    );
  });
});
