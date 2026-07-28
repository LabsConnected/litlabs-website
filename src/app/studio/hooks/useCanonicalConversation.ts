"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useConversationStore, toChatMessage, parseConversationFromUrl, serializeConversationToUrl } from "../stores/useConversationStore";
import type { AgentSlug, Conversation, ConversationMessage } from "@/lib/studio/types";

const ACTIVE_PROJECT_KEY = "litt:active-project-id";

function getActiveProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_PROJECT_KEY);
}

function generateClientRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * useCanonicalConversation — the single conversation controller for V12.
 * Replaces useStudioConversation + useBuilderSessions + useStudioAgentStore threads.
 *
 * One store, one transcript, one composer. No duplicate chat UI.
 */
export function useCanonicalConversation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const store = useConversationStore();
  const isSyncingFromUrl = useRef(false);

  // Load conversations from server on mount
  const loadConversations = useCallback(async () => {
    const projectId = getActiveProjectId();
    if (!projectId) return;

    store.setLoading(true);
    try {
      const res = await fetch(`/api/studio/conversations?projectId=${encodeURIComponent(projectId)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      const conversations = (data.conversations || []) as Conversation[];
      store.setConversations(conversations);

      // If URL has a conversation ID, select it
      const { conversationId, agentSlug } = parseConversationFromUrl(searchParams);
      if (conversationId && conversations.some((c) => c.id === conversationId)) {
        store.selectConversation(conversationId);
        if (agentSlug) store.setActiveAgent(agentSlug);
        await loadMessages(conversationId);
      } else if (conversations.length > 0) {
        // Auto-select most recent conversation
        store.selectConversation(conversations[0].id);
        await loadMessages(conversations[0].id);
      }
    } catch {
      // Non-fatal — offline or server unavailable
    } finally {
      store.setLoading(false);
    }
  }, [searchParams, store]);

  // Load messages for a conversation
  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/studio/conversations/${conversationId}/messages`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      const messages = (data.messages || []) as ConversationMessage[];
      const chatMessages = messages.map(toChatMessage);
      store.setMessages(conversationId, chatMessages);
      store.setRevision(data.revision ?? 1);
    } catch {
      // Non-fatal
    }
  }, [store]);

  // Create a new conversation
  const createConversation = useCallback(async (): Promise<Conversation | null> => {
    const projectId = getActiveProjectId();
    if (!projectId) return null;

    try {
      const res = await fetch("/api/studio/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          activeAgentSlug: store.activeAgentSlug,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const conversation = data.conversation as Conversation;
      store.setConversations([conversation, ...store.conversations]);
      store.selectConversation(conversation.id);
      store.setMessages(conversation.id, []);
      store.setRevision(1);
      return conversation;
    } catch {
      return null;
    }
  }, [store]);

  // Send a message (idempotent via clientRequestId)
  const sendMessage = useCallback(async (text: string): Promise<{ ok: boolean; error?: string }> => {
    const conversationId = store.selectedConversationId;
    if (!conversationId || !text.trim() || store.sending) {
      return { ok: false };
    }

    const clientRequestId = generateClientRequestId();
    const expectedRevision = store.revision;

    // Optimistic: add user message to UI immediately
    const optimisticUserMsg = {
      id: `optimistic_${clientRequestId}`,
      role: "user" as const,
      content: text,
      agentSlug: null,
      status: "completed" as const,
      createdAt: new Date().toISOString(),
      parentMessageId: null,
      regenerationOfMessageId: null,
    };
    store.addMessage(conversationId, optimisticUserMsg);

    // Optimistic: add pending assistant message
    const optimisticAssistantId = `optimistic_assistant_${clientRequestId}`;
    store.addMessage(conversationId, {
      id: optimisticAssistantId,
      role: "assistant",
      content: "",
      agentSlug: store.activeAgentSlug,
      status: "streaming",
      createdAt: new Date().toISOString(),
      parentMessageId: optimisticUserMsg.id,
      regenerationOfMessageId: null,
    });

    store.setSending(true);
    store.setStreaming(true);

    try {
      const res = await fetch(`/api/studio/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          clientRequestId,
          expectedRevision,
          requestedAgentSlug: store.activeAgentSlug,
        }),
      });

      const data = await res.json();

      if (res.status === 409) {
        // Stale revision — reload from server
        store.setError("Conversation was modified. Reloading...");
        await loadMessages(conversationId);
        await loadConversations();
        store.setError(null);
        return { ok: false, error: "stale-revision" };
      }

      if (!res.ok) {
        // Update optimistic assistant message to failed
        store.updateMessage(conversationId, optimisticAssistantId, {
          status: "failed",
          content: data.error || "Failed to get response",
        });
        return { ok: false, error: data.error };
      }

      // Replace optimistic messages with real ones
      const userMsg = data.userMessage as ConversationMessage;
      const assistantMsg = data.assistantMessage as ConversationMessage;

      // Replace optimistic user message
      store.updateMessage(conversationId, optimisticUserMsg.id, {
        id: userMsg.id,
        content: userMsg.content,
        createdAt: userMsg.createdAt,
      });

      // Replace optimistic assistant message
      store.updateMessage(conversationId, optimisticAssistantId, {
        id: assistantMsg.id,
        content: assistantMsg.content,
        status: "completed",
        createdAt: assistantMsg.createdAt,
      });

      // Update revision
      store.setRevision(data.revision ?? expectedRevision + 1);

      return { ok: true };
    } catch (err) {
      store.updateMessage(conversationId, optimisticAssistantId, {
        status: "failed",
        content: err instanceof Error ? err.message : "Network error",
      });
      return { ok: false, error: "network-error" };
    } finally {
      store.setSending(false);
      store.setStreaming(false);
    }
  }, [store, loadMessages, loadConversations]);

  // Regenerate an assistant message
  const regenerate = useCallback(async (assistantMessageId: string): Promise<{ ok: boolean; error?: string }> => {
    const conversationId = store.selectedConversationId;
    if (!conversationId || store.sending) return { ok: false };

    store.setSending(true);
    store.setStreaming(true);

    try {
      const res = await fetch(`/api/studio/conversations/${conversationId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantMessageId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { ok: false, error: data.error };
      }

      // Add the new assistant message to the store
      const newMsg = data.assistantMessage as ConversationMessage;
      store.addMessage(conversationId, toChatMessage(newMsg));
      store.setRevision(data.revision ?? store.revision + 1);

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    } finally {
      store.setSending(false);
      store.setStreaming(false);
    }
  }, [store]);

  // Switch agent
  const switchAgent = useCallback((slug: AgentSlug) => {
    store.setActiveAgent(slug);

    // Update conversation on server if one is selected
    const conversationId = store.selectedConversationId;
    if (conversationId) {
      void (async () => {
        try {
          await fetch(`/api/studio/conversations/${conversationId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: store.revision,
              patch: { activeAgentSlug: slug },
            }),
          });
        } catch {
          // Non-fatal — agent switch is optimistic
        }
      })();
    }
  }, [store]);

  // Select conversation and sync URL
  const selectConversation = useCallback((id: string | null) => {
    store.selectConversation(id);
    if (id) {
      void loadMessages(id);
    }
  }, [store, loadMessages]);

  // Sync URL when conversation or agent changes
  const syncUrl = useCallback(() => {
    if (isSyncingFromUrl.current) return;
    const params = serializeConversationToUrl(
      store.selectedConversationId,
      store.activeAgentSlug,
      searchParams,
    );
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
  }, [store.selectedConversationId, store.activeAgentSlug, searchParams, router, pathname]);

  // Sync from URL on mount and browser navigation
  useEffect(() => {
    isSyncingFromUrl.current = true;
    const { conversationId, agentSlug } = parseConversationFromUrl(searchParams);
    if (conversationId !== store.selectedConversationId) {
      if (conversationId && store.conversations.some((c) => c.id === conversationId)) {
        store.selectConversation(conversationId);
        void loadMessages(conversationId);
      } else if (!conversationId && store.selectedConversationId) {
        // URL cleared conversation — deselect
        store.selectConversation(null);
      }
    }
    if (agentSlug && agentSlug !== store.activeAgentSlug) {
      store.setActiveAgent(agentSlug);
    }
    isSyncingFromUrl.current = false;
  }, [searchParams, store, loadMessages]);

  // Sync URL when state changes
  useEffect(() => {
    syncUrl();
  }, [syncUrl]);

  // Load conversations on mount
  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  return {
    conversations: store.conversations,
    selectedConversationId: store.selectedConversationId,
    selectedConversation: store.getSelectedConversation(),
    messages: store.getMessages(),
    activeAgentSlug: store.activeAgentSlug,
    revision: store.revision,
    loading: store.loading,
    streaming: store.streaming,
    sending: store.sending,
    error: store.error,
    sendMessage,
    regenerate,
    switchAgent,
    selectConversation,
    createConversation,
    loadConversations,
    loadMessages,
  };
}
