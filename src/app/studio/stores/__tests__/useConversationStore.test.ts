import { describe, it, expect } from "vitest";
import {
  parseConversationFromUrl,
  serializeConversationToUrl,
  toChatMessage,
  useConversationStore,
} from "../../stores/useConversationStore";
import type { ConversationMessage } from "@/lib/studio/types";

describe("useConversationStore", () => {
  describe("toChatMessage", () => {
    it("converts a user ConversationMessage to ChatMessage", () => {
      const msg: ConversationMessage = {
        id: "msg-1",
        conversationId: "conv-1",
        ownerId: "user-1",
        projectId: "proj-1",
        role: "user",
        agentSlug: null,
        agentInstanceId: null,
        content: "Hello",
        status: "completed",
        parentMessageId: null,
        regenerationOfMessageId: null,
        clientRequestId: "req-1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };

      const chatMsg = toChatMessage(msg);
      expect(chatMsg.id).toBe("msg-1");
      expect(chatMsg.role).toBe("user");
      expect(chatMsg.content).toBe("Hello");
      expect(chatMsg.status).toBe("completed");
    });

    it("converts an assistant ConversationMessage to ChatMessage", () => {
      const msg: ConversationMessage = {
        id: "msg-2",
        conversationId: "conv-1",
        ownerId: "user-1",
        projectId: "proj-1",
        role: "assistant",
        agentSlug: "litt",
        agentInstanceId: null,
        content: "Hi there!",
        status: "completed",
        parentMessageId: "msg-1",
        regenerationOfMessageId: null,
        clientRequestId: null,
        createdAt: "2026-01-01T00:00:01Z",
        updatedAt: "2026-01-01T00:00:01Z",
      };

      const chatMsg = toChatMessage(msg);
      expect(chatMsg.role).toBe("assistant");
      expect(chatMsg.agentSlug).toBe("litt");
    });

    it("maps system/tool roles to assistant for UI safety", () => {
      const systemMsg: ConversationMessage = {
        id: "msg-sys",
        conversationId: "conv-1",
        ownerId: "user-1",
        projectId: "proj-1",
        role: "system",
        agentSlug: null,
        agentInstanceId: null,
        content: "System message",
        status: "completed",
        parentMessageId: null,
        regenerationOfMessageId: null,
        clientRequestId: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };

      const chatMsg = toChatMessage(systemMsg);
      expect(chatMsg.role).toBe("assistant");
    });
  });

  describe("parseConversationFromUrl", () => {
    it("parses conversation and agent from URL params", () => {
      const params = new URLSearchParams("?conversation=conv-123&agent=spark");
      const result = parseConversationFromUrl(params);
      expect(result.conversationId).toBe("conv-123");
      expect(result.agentSlug).toBe("spark");
    });

    it("returns null agentSlug for invalid agent", () => {
      const params = new URLSearchParams("?conversation=conv-123&agent=director");
      const result = parseConversationFromUrl(params);
      expect(result.conversationId).toBe("conv-123");
      expect(result.agentSlug).toBeNull();
    });

    it("returns nulls when no params present", () => {
      const params = new URLSearchParams("");
      const result = parseConversationFromUrl(params);
      expect(result.conversationId).toBeNull();
      expect(result.agentSlug).toBeNull();
    });

    it("parses nova agent slug", () => {
      const params = new URLSearchParams("?agent=nova");
      const result = parseConversationFromUrl(params);
      expect(result.agentSlug).toBe("nova");
    });

    it("parses forge agent slug", () => {
      const params = new URLSearchParams("?agent=forge");
      const result = parseConversationFromUrl(params);
      expect(result.agentSlug).toBe("forge");
    });

    it("parses echo agent slug", () => {
      const params = new URLSearchParams("?agent=echo");
      const result = parseConversationFromUrl(params);
      expect(result.agentSlug).toBe("echo");
    });

    it("parses specialist agent slugs", () => {
      expect(parseConversationFromUrl(new URLSearchParams("?agent=researcher")).agentSlug).toBe("researcher");
      expect(parseConversationFromUrl(new URLSearchParams("?agent=writer")).agentSlug).toBe("writer");
      expect(parseConversationFromUrl(new URLSearchParams("?agent=marketer")).agentSlug).toBe("marketer");
      expect(parseConversationFromUrl(new URLSearchParams("?agent=coder")).agentSlug).toBe("coder");
      expect(parseConversationFromUrl(new URLSearchParams("?agent=analyst")).agentSlug).toBe("analyst");
    });

    it("rejects invalid agent slugs", () => {
      expect(parseConversationFromUrl(new URLSearchParams("?agent=director")).agentSlug).toBeNull();
      expect(parseConversationFromUrl(new URLSearchParams("?agent=LiTT")).agentSlug).toBeNull();
      expect(parseConversationFromUrl(new URLSearchParams("?agent=")).agentSlug).toBeNull();
    });
  });

  describe("serializeConversationToUrl", () => {
    it("adds conversation and agent to existing params", () => {
      const existing = new URLSearchParams("?tool=chat");
      const params = serializeConversationToUrl("conv-123", "litt", existing);
      expect(params.get("conversation")).toBe("conv-123");
      expect(params.get("agent")).toBe("litt");
      expect(params.get("tool")).toBe("chat");
    });

    it("removes conversation and agent when null", () => {
      const existing = new URLSearchParams("?tool=chat&conversation=old&agent=litt");
      const params = serializeConversationToUrl(null, null, existing);
      expect(params.get("conversation")).toBeNull();
      expect(params.get("agent")).toBeNull();
      expect(params.get("tool")).toBe("chat");
    });
  });

  describe("store state management", () => {
    it("initializes with correct defaults", () => {
      const state = useConversationStore.getState();
      expect(state.conversations).toEqual([]);
      expect(state.selectedConversationId).toBeNull();
      expect(state.activeAgentSlug).toBe("litt");
      expect(state.revision).toBe(1);
      expect(state.loading).toBe(false);
      expect(state.streaming).toBe(false);
      expect(state.sending).toBe(false);
    });

    it("setActiveAgent updates agent slug", () => {
      useConversationStore.getState().setActiveAgent("spark");
      expect(useConversationStore.getState().activeAgentSlug).toBe("spark");
      // Reset
      useConversationStore.getState().setActiveAgent("litt");
    });

    it("setRevision updates revision", () => {
      useConversationStore.getState().setRevision(42);
      expect(useConversationStore.getState().revision).toBe(42);
      // Reset
      useConversationStore.getState().setRevision(1);
    });

    it("addMessage adds to the correct conversation", () => {
      const store = useConversationStore.getState();
      store.setMessages("conv-1", []);
      store.addMessage("conv-1", {
        id: "test-msg",
        role: "user",
        content: "Test",
        agentSlug: null,
        status: "completed",
        createdAt: new Date().toISOString(),
        parentMessageId: null,
        regenerationOfMessageId: null,
      });
      const messages = useConversationStore.getState().messagesByConversationId["conv-1"];
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Test");
    });

    it("updateMessage patches an existing message", () => {
      const store = useConversationStore.getState();
      store.setMessages("conv-2", [{
        id: "msg-to-update",
        role: "assistant",
        content: "",
        agentSlug: "litt",
        status: "streaming",
        createdAt: new Date().toISOString(),
        parentMessageId: null,
        regenerationOfMessageId: null,
      }]);
      store.updateMessage("conv-2", "msg-to-update", {
        content: "Updated content",
        status: "completed",
      });
      const msg = useConversationStore.getState().messagesByConversationId["conv-2"][0];
      expect(msg.content).toBe("Updated content");
      expect(msg.status).toBe("completed");
    });
  });
});
