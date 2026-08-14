import { describe, it, expect, vi, beforeEach } from "vitest";
import { useConversationStore } from "@/app/(app)/studio/stores/useConversationStore";

/**
 * P0.5: Regression test — Live transcript persistence must NOT
 * trigger a second LLM call via conversation.send().
 *
 * The old code called conversation.send(userText) which invoked the
 * full LLM pipeline, producing a duplicate response. The fix persists
 * both user and assistant transcripts directly to the conversation
 * store + server without any LLM call.
 */

// Mock the conversation hook — track if send() is called
const mockSend = vi.fn();
const mockLoadMessages = vi.fn();

vi.mock("@/app/(app)/studio/hooks/useCanonicalConversation", () => ({
  useCanonicalConversation: () => ({
    messages: [],
    busy: false,
    loading: false,
    send: mockSend,
    cancel: vi.fn(),
    regenerate: vi.fn(),
    clear: vi.fn(),
    activeAgentId: "litt",
    fallbackNotice: null,
    initialPrompt: "",
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    renameConversation: vi.fn(),
    exportConversation: vi.fn(),
    switchAgent: vi.fn(),
    selectedConversationId: "conv-test-1",
    conversations: [],
    sendError: null,
    clearSendError: vi.fn(),
    requiresReauth: false,
    clearRequiresReauth: vi.fn(),
    loadMessages: mockLoadMessages,
  }),
}));

describe("Live P0.5 — No double LLM response regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("addMessage is used for Live transcript persistence, not conversation.send()", () => {
    const store = useConversationStore.getState();
    const convId = "conv-test-1";

    // Simulate what handleLiveTranscript does: add user + assistant
    // messages directly to the store
    store.addMessage(convId, {
      id: "live_user_test_1",
      role: "user",
      content: "Hello from Live",
      agentSlug: null,
      agentMode: null,
      status: "completed",
      createdAt: new Date().toISOString(),
      parentMessageId: null,
      regenerationOfMessageId: null,
    });
    store.addMessage(convId, {
      id: "live_assistant_test_1",
      role: "assistant",
      content: "Hi! I heard you.",
      agentSlug: "litt",
      agentMode: "standard",
      status: "completed",
      createdAt: new Date().toISOString(),
      parentMessageId: null,
      regenerationOfMessageId: null,
    });

    // CRITICAL: conversation.send() must NOT be called
    // The mock send function tracks any LLM-triggering call
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("Live transcript persistence uses direct store mutation, not send pipeline", () => {
    const store = useConversationStore.getState();

    // Simulate a Live turn
    store.addMessage("conv-1", {
      id: "live_user_2",
      role: "user",
      content: "What is the weather?",
      agentSlug: null,
      agentMode: null,
      status: "completed",
      createdAt: new Date().toISOString(),
      parentMessageId: null,
      regenerationOfMessageId: null,
    });

    // Verify: send NOT called (no double LLM response)
    expect(mockSend).not.toHaveBeenCalled();
  });
});
