import { describe, expect, it } from "vitest";

import { toChatMessage } from "./useConversationStore";
import type { ConversationMessage } from "@/lib/studio/types";

/**
 * PR #1114 Greptile thread 2 — the reload path must carry the failure
 * reason all the way into the UI message's execution record, where
 * StudioTranscript.deriveWorkLog reads it. The server re-attaches
 * `failureReason` to failed messages on GET; toChatMessage is the
 * client half of that chain.
 */

function serverMessage(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: "m1",
    conversationId: "conv-1",
    ownerId: "user_1",
    projectId: "proj-1",
    role: "assistant",
    agentSlug: "litt",
    content: "We hit a snag, try again.",
    status: "failed",
    parentMessageId: null,
    regenerationOfMessageId: null,
    clientRequestId: null,
    createdAt: "2026-11-24T19:10:02.000Z",
    updatedAt: "2026-11-24T19:10:32.000Z",
    ...overrides,
  } as ConversationMessage;
}

describe("toChatMessage — failure reason read-back", () => {
  it("maps a re-attached failureReason into execution.failureReason for the work log", () => {
    const chat = toChatMessage(
      serverMessage({ failureReason: "files.write: workspace transport unavailable" }),
    );
    expect(chat.execution?.failureReason).toBe("files.write: workspace transport unavailable");
    // The bubble text itself is untouched — the reason is work-log data.
    expect(chat.content).toBe("We hit a snag, try again.");
  });

  it("leaves execution absent when the stored message carries no failure reason", () => {
    const chat = toChatMessage(serverMessage({ status: "completed", content: "Done." }));
    expect(chat.execution).toBeUndefined();
  });
});
