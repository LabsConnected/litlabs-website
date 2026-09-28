import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { littAuthHeaders } from "./auth-headers";
import { createLittConversationsClient } from "./conversations";
import { littConversationPaths } from "./endpoints";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("littAuthHeaders", () => {
  it("matches Studio: JSON content type on demand, bearer only when Clerk returns a token", async () => {
    await expect(littAuthHeaders(async () => "tok_123", true)).resolves.toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer tok_123",
    });
    await expect(littAuthHeaders(async () => null, false)).resolves.toEqual({});
    await expect(littAuthHeaders(undefined, true)).resolves.toEqual({
      "Content-Type": "application/json",
    });
  });

  it("is the same header shape the Studio hook still builds inline", () => {
    const hook = readFileSync("src/app/(app)/studio/hooks/useCanonicalConversation.ts", "utf8");
    expect(hook).toContain("Authorization: `Bearer ${token}`");
    expect(hook).toContain('...(json ? { "Content-Type": "application/json" } : {})');
  });
});

describe("createLittConversationsClient", () => {
  it("sends list, create, messages, cancel, regenerate, patch, delete, and action-run with the Studio paths", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch;
    const client = createLittConversationsClient({
      fetchImpl,
      getToken: async () => "session-token",
    });

    await client.list("proj/1");
    await client.create({ projectId: "proj/1", activeAgentSlug: "litt" });
    await client.getMessages("conv-1");
    await client.sendMessage("conv-1", {
      message: "Build a page",
      clientRequestId: "req-1",
      expectedRevision: 3,
      requestedAgentSlug: "litt",
      agentMode: "standard",
      executionMode: "act",
      model: "auto",
      images: ["https://cdn.example/a.png"],
    });
    await client.cancel("conv-1", "req-1");
    await client.regenerate("conv-1", {
      assistantMessageId: "asst-1",
      clientRequestId: "req-2",
      expectedRevision: 4,
    });
    await client.patch("conv-1", { expectedRevision: 4, patch: { title: "Rename" } });
    await client.remove("conv-1");
    await client.getActionRun("conv/1");

    const calls = vi.mocked(fetchImpl).mock.calls;
    expect(calls.map((call) => [call[0], (call[1] as RequestInit).method ?? "GET"])).toEqual([
      [littConversationPaths.list("proj/1"), "GET"],
      [littConversationPaths.collection, "POST"],
      [littConversationPaths.messages("conv-1"), "GET"],
      [littConversationPaths.messages("conv-1"), "POST"],
      [littConversationPaths.cancel("conv-1"), "POST"],
      [littConversationPaths.regenerate("conv-1"), "POST"],
      [littConversationPaths.conversation("conv-1"), "PATCH"],
      [littConversationPaths.conversation("conv-1"), "DELETE"],
      [littConversationPaths.actionRun("conv/1"), "GET"],
    ]);

    for (const call of calls) {
      const init = call[1] as RequestInit;
      expect(init.credentials).toBe("include");
      expect(init.headers).toMatchObject({ Authorization: "Bearer session-token" });
    }

    const send = calls[3][1] as RequestInit;
    expect(send.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(send.body))).toEqual({
      message: "Build a page",
      clientRequestId: "req-1",
      expectedRevision: 3,
      requestedAgentSlug: "litt",
      agentMode: "standard",
      executionMode: "act",
      model: "auto",
      images: ["https://cdn.example/a.png"],
    });
    expect(JSON.parse(String((calls[4][1] as RequestInit).body))).toEqual({ clientRequestId: "req-1" });
    expect(calls[0][0]).toBe("/api/studio/conversations?projectId=proj%2F1");
    expect(calls[8][0]).toBe("/api/studio/conversations/conv%2F1/action-run");
    expect((calls[0][1] as RequestInit).cache).toBe("no-store");
    expect((calls[2][1] as RequestInit).headers).not.toHaveProperty("Content-Type");
  });

  it("omits the bearer when Clerk has no token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    const client = createLittConversationsClient({ fetchImpl, getToken: async () => null });
    await client.getMessages("conv-1");
    expect((vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit).headers).toEqual({});
  });
});
