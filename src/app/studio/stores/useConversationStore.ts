"use client";

import { create } from "zustand";
import type { AgentSlug, Conversation, ConversationMessage } from "@/lib/studio/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentSlug: AgentSlug | null;
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  createdAt: string;
  parentMessageId: string | null;
  regenerationOfMessageId: string | null;
}

// Zustand selectors are backed by useSyncExternalStore. Returning a fresh []
// for an empty conversation makes every snapshot look different to React 19
// and can trigger "Maximum update depth exceeded" before data finishes loading.
export const EMPTY_CONVERSATION_MESSAGES: ChatMessage[] = [];

interface ConversationStore {
  // State
  conversations: Conversation[];
  selectedConversationId: string | null;
  messagesByConversationId: Record<string, ChatMessage[]>;
  activeAgentSlug: AgentSlug;
  revision: number;
  loading: boolean;
  streaming: boolean;
  sending: boolean;
  error: string | null;

  // Actions
  setConversations: (conversations: Conversation[]) => void;
  selectConversation: (id: string | null) => void;
  setMessages: (conversationId: string, messages: ChatMessage[]) => void;
  addMessage: (conversationId: string, message: ChatMessage) => void;
  updateMessage: (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  setActiveAgent: (slug: AgentSlug) => void;
  setRevision: (revision: number) => void;
  setLoading: (loading: boolean) => void;
  setStreaming: (streaming: boolean) => void;
  setSending: (sending: boolean) => void;
  setError: (error: string | null) => void;

  // Computed helpers
  getMessages: () => ChatMessage[];
  getSelectedConversation: () => Conversation | null;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  conversations: [],
  selectedConversationId: null,
  messagesByConversationId: {},
  activeAgentSlug: "litt",
  revision: 1,
  loading: false,
  streaming: false,
  sending: false,
  error: null,

  setConversations: (conversations) => set({ conversations }),

  selectConversation: (id) => {
    const state = get();
    if (id === state.selectedConversationId) return;
    const conversation = state.conversations.find((c) => c.id === id);
    set({
      selectedConversationId: id,
      activeAgentSlug: conversation?.activeAgentSlug ?? state.activeAgentSlug,
      revision: conversation?.revision ?? 1,
    });
  },

  setMessages: (conversationId, messages) =>
    set((state) => ({
      messagesByConversationId: {
        ...state.messagesByConversationId,
        [conversationId]: messages,
      },
    })),

  addMessage: (conversationId, message) =>
    set((state) => ({
      messagesByConversationId: {
        ...state.messagesByConversationId,
        [conversationId]: [
          ...(state.messagesByConversationId[conversationId] ?? []),
          message,
        ],
      },
    })),

  updateMessage: (conversationId, messageId, patch) =>
    set((state) => ({
      messagesByConversationId: {
        ...state.messagesByConversationId,
        [conversationId]: (state.messagesByConversationId[conversationId] ?? []).map((m) =>
          m.id === messageId ? { ...m, ...patch } : m,
        ),
      },
    })),

  setActiveAgent: (slug) => set({ activeAgentSlug: slug }),
  setRevision: (revision) => set({ revision }),
  setLoading: (loading) => set({ loading }),
  setStreaming: (streaming) => set({ streaming }),
  setSending: (sending) => set({ sending }),
  setError: (error) => set({ error }),

  getMessages: () => {
    const state = get();
    return state.messagesByConversationId[state.selectedConversationId ?? ""] ?? [];
  },

  getSelectedConversation: () => {
    const state = get();
    return state.conversations.find((c) => c.id === state.selectedConversationId) ?? null;
  },
}));

/**
 * Convert a canonical ConversationMessage to a ChatMessage for the UI.
 */
export function toChatMessage(msg: ConversationMessage): ChatMessage {
  return {
    id: msg.id,
    role: msg.role === "user" || msg.role === "assistant" ? msg.role : "assistant",
    content: msg.content,
    agentSlug: msg.agentSlug,
    status: msg.status,
    createdAt: msg.createdAt,
    parentMessageId: msg.parentMessageId,
    regenerationOfMessageId: msg.regenerationOfMessageId,
  };
}

/**
 * Parse conversation/agent from URL search params.
 */
export function parseConversationFromUrl(searchParams: URLSearchParams): {
  conversationId: string | null;
  agentSlug: AgentSlug | null;
} {
  const conversationId = searchParams.get("conversation");
  const agentRaw = searchParams.get("agent");
  const agentSlug: AgentSlug | null =
    agentRaw === "litt" || agentRaw === "spark" ? agentRaw : null;
  return { conversationId, agentSlug };
}

/**
 * Serialize conversation/agent to URL search params.
 */
export function serializeConversationToUrl(
  conversationId: string | null,
  agentSlug: AgentSlug | null,
  existing: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(existing.toString());
  if (conversationId) {
    params.set("conversation", conversationId);
  } else {
    params.delete("conversation");
  }
  if (agentSlug) {
    params.set("agent", agentSlug);
  } else {
    params.delete("agent");
  }
  return params;
}
