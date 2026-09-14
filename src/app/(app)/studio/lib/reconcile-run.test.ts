import { describe, it, expect, vi } from "vitest";
import {
  reconcileRunState,
  reconciledAssistantStatus,
  type ReconcileSnapshot,
} from "./reconcile-run";
import type { ConversationMessage } from "@/lib/studio/types";

/**
 * Regression tests for post-disconnect canonical state reconciliation.
 *
 * When the SSE transport dies after the server accepted a send, the client
 * must reload persisted conversation state instead of declaring failure —
 * and must never resend the mutation.
 */

function makeMsg(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    ownerId: "user-1",
    projectId: "proj-1",
    role: "user",
    agentSlug: "litt",
    agentMode: "standard",
    agentInstanceId: null,
    content: "",
    status: "completed",
    parentMessageId: null,
    regenerationOfMessageId: null,
    clientRequestId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function snapshot(messages: ConversationMessage[], revision = 5): ReconcileSnapshot {
  return { messages, revision };
}

const userMsg = (clientRequestId = "req-1") =>
  makeMsg({ id: "user-msg-1", role: "user", content: "build me a site", clientRequestId });
const assistantMsg = (status: ConversationMessage["status"], content = "") =>
  makeMsg({ id: "asst-1", role: "assistant", parentMessageId: "user-msg-1", status, content });

const noSleep = () => Promise.resolve();

describe("reconcileRunState", () => {
  it("recovers a completed assistant response persisted after SSE loss", async () => {
    const fetchSnapshot = vi.fn(async () =>
      snapshot([userMsg(), assistantMsg("completed", "I built your landing page.")]),
    );
    const result = await reconcileRunState({
      clientRequestId: "req-1",
      fetchSnapshot,
      sleep: noSleep,
    });
    expect(result.state).toBe("completed");
    expect(result.assistantMessage?.content).toBe("I built your landing page.");
    expect(result.userMessage?.id).toBe("user-msg-1");
    expect(result.revision).toBe(5);
  });

  it("polls until a streaming run reaches a terminal state", async () => {
    const fetchSnapshot = vi
      .fn<() => Promise<ReconcileSnapshot>>()
      .mockResolvedValueOnce(snapshot([userMsg(), assistantMsg("streaming")]))
      .mockResolvedValueOnce(snapshot([userMsg(), assistantMsg("streaming")]))
      .mockResolvedValueOnce(snapshot([userMsg(), assistantMsg("completed", "done")]));
    const result = await reconcileRunState({
      clientRequestId: "req-1",
      fetchSnapshot,
      sleep: noSleep,
    });
    expect(result.state).toBe("completed");
    expect(fetchSnapshot).toHaveBeenCalledTimes(3);
  });

  it("surfaces a persisted server-side failure truthfully", async () => {
    const fetchSnapshot = vi.fn(async () =>
      snapshot([userMsg(), assistantMsg("failed", "The build did not pass checks.")]),
    );
    const result = await reconcileRunState({ clientRequestId: "req-1", fetchSnapshot, sleep: noSleep });
    expect(result.state).toBe("failed");
    expect(result.assistantMessage?.content).toContain("did not pass");
  });

  it("surfaces a persisted cancelled state", async () => {
    const fetchSnapshot = vi.fn(async () =>
      snapshot([userMsg(), assistantMsg("cancelled", "Cancelled: Cancelled by user")]),
    );
    const result = await reconcileRunState({ clientRequestId: "req-1", fetchSnapshot, sleep: noSleep });
    expect(result.state).toBe("cancelled");
  });

  it("surfaces awaiting_approval as a terminal state", async () => {
    const fetchSnapshot = vi.fn(async () =>
      snapshot([userMsg(), assistantMsg("awaiting_approval", "I need approval to deploy.")]),
    );
    const result = await reconcileRunState({ clientRequestId: "req-1", fetchSnapshot, sleep: noSleep });
    expect(result.state).toBe("awaiting_approval");
  });

  it("reports 'running' when the run is still streaming at the poll bound — never a false failure", async () => {
    const fetchSnapshot = vi.fn(async () =>
      snapshot([userMsg(), assistantMsg("streaming")]),
    );
    const result = await reconcileRunState({
      clientRequestId: "req-1",
      fetchSnapshot,
      sleep: noSleep,
      maxAttempts: 4,
    });
    expect(result.state).toBe("running");
    expect(result.sawServerState).toBe(true);
    expect(result.assistantMessage?.status).toBe("streaming");
    expect(fetchSnapshot).toHaveBeenCalledTimes(4);
  });

  it("reports 'unknown' after repeated fetch failures (device offline)", async () => {
    const fetchSnapshot = vi.fn(async () => null);
    const result = await reconcileRunState({
      clientRequestId: "req-1",
      fetchSnapshot,
      sleep: noSleep,
      maxAttempts: 8,
    });
    expect(result.state).toBe("unknown");
    expect(result.sawServerState).toBe(false);
    // Gives up early after 3 consecutive failures rather than burning all attempts.
    expect(fetchSnapshot).toHaveBeenCalledTimes(3);
  });

  it("matches the correct user message by clientRequestId, not just the latest", async () => {
    const olderUser = makeMsg({ id: "user-msg-0", role: "user", clientRequestId: "req-0" });
    const olderAssistant = makeMsg({
      id: "asst-0",
      role: "assistant",
      parentMessageId: "user-msg-0",
      status: "completed",
      content: "old reply",
    });
    const fetchSnapshot = vi.fn(async () =>
      snapshot([olderUser, olderAssistant, userMsg("req-1"), assistantMsg("completed", "new reply")]),
    );
    const result = await reconcileRunState({ clientRequestId: "req-1", fetchSnapshot, sleep: noSleep });
    expect(result.state).toBe("completed");
    expect(result.assistantMessage?.id).toBe("asst-1");
    expect(result.assistantMessage?.content).toBe("new reply");
  });

  it("only ever reads canonical state — reconciliation cannot resend work", async () => {
    // fetchSnapshot is the ONLY I/O the helper performs. Count calls and
    // assert it is invoked strictly as a read (no mutation arguments exist).
    const fetchSnapshot = vi.fn(async () =>
      snapshot([userMsg(), assistantMsg("completed", "done")]),
    );
    const result = await reconcileRunState({ clientRequestId: "req-1", fetchSnapshot, sleep: noSleep });
    expect(result.state).toBe("completed");
    for (const call of fetchSnapshot.mock.calls) {
      expect(call.length).toBe(0); // read-only signature — no body/payload
    }
  });

  it("returns 'running' when the user message persisted but no assistant row is visible yet", async () => {
    const fetchSnapshot = vi.fn(async () => snapshot([userMsg()]));
    const result = await reconcileRunState({
      clientRequestId: "req-1",
      fetchSnapshot,
      sleep: noSleep,
      maxAttempts: 3,
    });
    expect(result.state).toBe("running");
    expect(result.userMessage?.id).toBe("user-msg-1");
    expect(result.assistantMessage).toBeNull();
  });

  it("NEVER falls back to an unrelated latest user message — unknown beats guessing", async () => {
    // Another send (another tab/session/newer request) exists with its own
    // completed assistant response. Matching it to OUR run would be a lie.
    const otherUser = makeMsg({ id: "user-other", role: "user", clientRequestId: "req-OTHER" });
    const otherAssistant = makeMsg({
      id: "asst-other",
      role: "assistant",
      parentMessageId: "user-other",
      status: "completed",
      content: "someone else's result",
    });
    const fetchSnapshot = vi.fn(async () => snapshot([otherUser, otherAssistant]));
    const result = await reconcileRunState({
      clientRequestId: "req-1",
      fetchSnapshot,
      sleep: noSleep,
      maxAttempts: 3,
    });
    expect(result.state).toBe("unknown");
    expect(result.userMessage).toBeNull();
    expect(result.assistantMessage).toBeNull();
  });

  it("returns 'unknown' when the exact run identity was never persisted (send never landed)", async () => {
    // Server reachable, conversation loads fine — but no user message with
    // this clientRequestId exists. The run cannot be claimed "running".
    const fetchSnapshot = vi.fn(async () => snapshot([]));
    const result = await reconcileRunState({
      clientRequestId: "req-1",
      fetchSnapshot,
      sleep: noSleep,
      maxAttempts: 3,
    });
    expect(result.state).toBe("unknown");
    expect(result.sawServerState).toBe(true);
  });
});

describe("reconciledAssistantStatus — non-terminal states are never faked", () => {
  it("maps terminal canonical states to their persisted statuses", () => {
    expect(reconciledAssistantStatus("completed")).toBe("completed");
    expect(reconciledAssistantStatus("failed")).toBe("failed");
    expect(reconciledAssistantStatus("cancelled")).toBe("cancelled");
    expect(reconciledAssistantStatus("awaiting_approval")).toBe("awaiting_approval");
  });

  it("maps 'running' to non-terminal 'streaming' — not failed, not cancelled", () => {
    expect(reconciledAssistantStatus("running")).toBe("streaming");
  });

  it("maps 'unknown' to non-terminal 'streaming' — inability to observe is not failure", () => {
    expect(reconciledAssistantStatus("unknown")).toBe("streaming");
  });
});
