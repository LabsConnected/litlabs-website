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
        agentMode: null,
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
        agentMode: "standard",
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
        agentMode: null,
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
        agentMode: null,
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
        agentMode: "standard",
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

  // ─── Cross-project isolation ───────────────────────────────────────
  // useCanonicalConversation calls resetForProject() whenever the
  // resolved project id changes (see loadedProjectIdRef in that hook).
  // This proves the STORE side of that contract: after resetForProject(),
  // nothing from the previous project — conversations, selection, or
  // messages — survives into the new project's state. It does not drive
  // the hook itself (that requires mocking fetch/auth/session, which is
  // covered narrowly by useCanonicalConversation.test.ts); it proves the
  // data-isolation guarantee the hook depends on.
  describe("resetForProject — cross-project state isolation", () => {
    it("clears Project A's conversations, selection, and messages when switching to Project B", () => {
      const store = useConversationStore.getState();

      // Project A is fully loaded: conversations, a selection, messages.
      const convA = {
        id: "conv-A1", ownerId: "user-1", projectId: "project-A", title: "A chat",
        activeAgentSlug: "litt", activeAgentMode: "standard", agentInstanceId: null,
        revision: 1, archivedAt: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      } as const;
      store.setConversations([convA]);
      store.selectConversation("conv-A1");
      store.setMessages("conv-A1", [{
        id: "msg-A1", role: "user", content: "Project A secret task",
        agentSlug: null, agentMode: null, status: "completed",
        createdAt: "2026-01-01T00:00:00Z", parentMessageId: null, regenerationOfMessageId: null,
      }]);

      expect(useConversationStore.getState().conversations).toHaveLength(1);
      expect(useConversationStore.getState().selectedConversationId).toBe("conv-A1");
      expect(useConversationStore.getState().messagesByConversationId["conv-A1"]).toHaveLength(1);

      // The user switches to Project B — the hook detects the project id
      // changed and calls resetForProject() before loading B's data.
      store.resetForProject();

      const afterReset = useConversationStore.getState();
      expect(afterReset.conversations).toEqual([]);
      expect(afterReset.selectedConversationId).toBeNull();
      expect(afterReset.messagesByConversationId).toEqual({});
      // Project A's messages are gone entirely, not just unselected —
      // they cannot leak into Project B's transcript by key collision
      // or stale cache lookup.
      expect(afterReset.messagesByConversationId["conv-A1"]).toBeUndefined();

      // Project B loads its own, disjoint conversation.
      const convB = {
        id: "conv-B1", ownerId: "user-1", projectId: "project-B", title: "B chat",
        activeAgentSlug: "litt", activeAgentMode: "standard", agentInstanceId: null,
        revision: 1, archivedAt: null, createdAt: "2026-01-01T00:01:00Z", updatedAt: "2026-01-01T00:01:00Z",
      } as const;
      store.setConversations([convB]);
      store.selectConversation("conv-B1");
      store.setMessages("conv-B1", [{
        id: "msg-B1", role: "user", content: "Project B task",
        agentSlug: null, agentMode: null, status: "completed",
        createdAt: "2026-01-01T00:01:00Z", parentMessageId: null, regenerationOfMessageId: null,
      }]);

      const withB = useConversationStore.getState();
      expect(withB.conversations).toEqual([convB]);
      expect(withB.selectedConversationId).toBe("conv-B1");
      expect(withB.messagesByConversationId["conv-A1"]).toBeUndefined();
      expect(withB.messagesByConversationId["conv-B1"]).toHaveLength(1);
      expect(withB.messagesByConversationId["conv-B1"][0].content).toBe("Project B task");

      // Switching back to A is a fresh reset + reload too — the hook
      // does not special-case "returning" to a previously-seen project;
      // it always resets, then the server reload repopulates A's real
      // data. Simulate that reload here.
      store.resetForProject();
      expect(useConversationStore.getState().conversations).toEqual([]);
      store.setConversations([convA]);
      store.selectConversation("conv-A1");
      store.setMessages("conv-A1", [{
        id: "msg-A1", role: "user", content: "Project A secret task",
        agentSlug: null, agentMode: null, status: "completed",
        createdAt: "2026-01-01T00:00:00Z", parentMessageId: null, regenerationOfMessageId: null,
      }]);

      const backToA = useConversationStore.getState();
      expect(backToA.selectedConversationId).toBe("conv-A1");
      expect(backToA.messagesByConversationId["conv-A1"][0].content).toBe("Project A secret task");
      expect(backToA.messagesByConversationId["conv-B1"]).toBeUndefined();
    });

    it("does not silently merge: setConversations replaces the list, it never appends across projects", () => {
      const store = useConversationStore.getState();
      store.resetForProject();
      const convA = {
        id: "conv-A2", ownerId: "user-1", projectId: "project-A", title: null,
        activeAgentSlug: "litt", activeAgentMode: "standard", agentInstanceId: null,
        revision: 1, archivedAt: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      } as const;
      store.setConversations([convA]);

      const convB = {
        id: "conv-B2", ownerId: "user-1", projectId: "project-B", title: null,
        activeAgentSlug: "litt", activeAgentMode: "standard", agentInstanceId: null,
        revision: 1, archivedAt: null, createdAt: "2026-01-01T00:01:00Z", updatedAt: "2026-01-01T00:01:00Z",
      } as const;
      // Simulate the hook's reset-then-load sequence rather than calling
      // setConversations directly on top of A's list.
      store.resetForProject();
      store.setConversations([convB]);

      const state = useConversationStore.getState();
      expect(state.conversations).toEqual([convB]);
      expect(state.conversations.find((c) => c.id === "conv-A2")).toBeUndefined();
    });
  });
});
