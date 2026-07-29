"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useProfile } from "@/context/ProfileContext";
import { parseBuilderLocalCommand } from "../lib/builder-command-router";
import { detectIntent, type IntentResult } from "../lib/studio-intent";
import { useConnectionSummary } from "./useConnectionSummary";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import {
  useStudioAgentStore,
  AGENT_META,
  type ChatMessage,
  type AgentId,
} from "../stores/useStudioAgentStore";
import { useStudioModelStore } from "../stores/useStudioModelStore";
import { useBuilderSessions } from "./useBuilderSessions";
import type { StudioTool } from "../components/StudioSidebar";
import type { AgentSlug, Conversation, ConversationMessage } from "@/lib/studio/types";
import {
  useConversationStore,
  toChatMessage as toCanonicalChatMessage,
  parseConversationFromUrl,
  serializeConversationToUrl,
} from "../stores/useConversationStore";

export interface SendResult {
  accepted: boolean;
  reply?: string;
}

const ACTIVE_PROJECT_KEY = "litt:active-project-id";

function getActiveProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_PROJECT_KEY);
}

function generateClientRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Convert canonical ChatMessage (from useConversationStore) to the
 * ChatMessage type expected by StudioTranscript and CommandComposer.
 */
function toUIMessage(
  msg: ReturnType<typeof useConversationStore.getState>["messagesByConversationId"][string][number],
): ChatMessage {
  return {
    role: msg.role,
    content: msg.content,
    createdAt: new Date(msg.createdAt).getTime() || Date.now(),
  };
}

/**
 * useCanonicalConversation — the V12 conversation controller.
 *
 * Replaces useStudioConversation. Same return contract, but:
 * - Messages come from the canonical conversation store (not agent threads)
 * - LLM calls go to /api/studio/conversations/[conversationId]/messages
 * - Conversations are persisted server-side with revision control
 * - Agent switching stays within the same conversation
 * - URL syncs with ?conversation= and ?agent=
 */
export function useCanonicalConversation({
  onRouteTool,
}: {
  onRouteTool?: (tool: StudioTool, command?: string) => void;
} = {}) {
  const [busy, setBusy] = useState(false);
  const sessionManager = useBuilderSessions();
  const { capabilities } = useConnectionSummary();
  const { voiceTransportConnected, voiceInputState } = useVoiceSession();

  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const setActiveAgentId = useStudioAgentStore((s) => s.setActiveAgent);

  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const fallbackNotice = useStudioModelStore((s) => s.fallbackNotice);
  const setFallbackNotice = useStudioModelStore((s) => s.setFallbackNotice);

  const store = useConversationStore();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isSyncingFromUrl = useRef(false);

  const { profile } = useProfile();
  const initialPrompt = searchParams.get("mission") || "";

  // Convert canonical store messages to UI ChatMessage format
  const messages = useMemo(() => {
    const canonical = store.getMessages();
    return canonical.map(toUIMessage);
  }, [store]);

  // Load messages for a conversation
  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/studio/conversations/${conversationId}/messages`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      const msgs = (data.messages || []) as ConversationMessage[];
      const chatMsgs = msgs.map(toCanonicalChatMessage);
      store.setMessages(conversationId, chatMsgs);
      store.setRevision(data.revision ?? 1);
    } catch {
      // Non-fatal
    }
  }, [store]);

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

      const { conversationId, agentSlug } = parseConversationFromUrl(searchParams);
      if (conversationId && conversations.some((c) => c.id === conversationId)) {
        store.selectConversation(conversationId);
        if (agentSlug) {
          store.setActiveAgent(agentSlug);
          setActiveAgentId(agentSlug);
        }
        await loadMessages(conversationId);
      } else if (conversations.length > 0) {
        store.selectConversation(conversations[0].id);
        await loadMessages(conversations[0].id);
      }
    } catch {
      // Non-fatal — offline or server unavailable
    } finally {
      store.setLoading(false);
    }
  }, [searchParams, store, setActiveAgentId, loadMessages]);

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
          activeAgentSlug: activeAgentId,
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
  }, [store, activeAgentId]);

  // Sync URL when conversation or agent changes
  const syncUrl = useCallback(() => {
    if (isSyncingFromUrl.current) return;
    const params = serializeConversationToUrl(
      store.selectedConversationId,
      activeAgentId as AgentSlug,
      searchParams,
    );
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
  }, [store.selectedConversationId, activeAgentId, searchParams, router, pathname]);

  // Sync from URL on mount and browser navigation
  useEffect(() => {
    isSyncingFromUrl.current = true;
    const { conversationId, agentSlug } = parseConversationFromUrl(searchParams);
    if (conversationId !== store.selectedConversationId) {
      if (conversationId && store.conversations.some((c) => c.id === conversationId)) {
        store.selectConversation(conversationId);
        void loadMessages(conversationId);
      } else if (!conversationId && store.selectedConversationId) {
        store.selectConversation(null);
      }
    }
    if (agentSlug && agentSlug !== activeAgentId) {
      store.setActiveAgent(agentSlug);
      setActiveAgentId(agentSlug);
    }
    isSyncingFromUrl.current = false;
  }, [searchParams, store, loadMessages, activeAgentId, setActiveAgentId]);

  // Sync URL when state changes
  useEffect(() => {
    syncUrl();
  }, [syncUrl]);

  // Load conversations on mount
  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // The send function — matches useStudioConversation's contract
  const send = useCallback(
    async (value: string, attachments?: string[]): Promise<SendResult> => {
      const text = value.trim();
      if ((!text && !attachments?.length) || busy) return { accepted: false };

      // 1. Slash commands — local, no server call
      const localCommand = parseBuilderLocalCommand(text);
      if (localCommand) {
        switch (localCommand.type) {
          case "clear":
            store.setMessages(store.selectedConversationId ?? "", []);
            return { accepted: true };
          case "new":
            void createConversation();
            return { accepted: true };
          case "terminal":
            onRouteTool?.("terminal");
            return { accepted: true };
          case "sessions":
            return { accepted: true };
          case "delete":
            if (sessionManager.activeSession && window.confirm(`Delete "${sessionManager.activeSession.title}"?`)) {
              sessionManager.remove(sessionManager.activeSession.id);
            }
            return { accepted: true };
          case "rename":
            if (localCommand.title && sessionManager.activeSession) {
              sessionManager.rename(sessionManager.activeSession.id, localCommand.title);
            }
            return { accepted: true };
          case "help":
            return { accepted: true };
          default:
            return { accepted: true };
        }
      }

      // 2. Deterministic product intents before any LLM call
      const intent = detectIntent(text);
      if (intent && intent.intent !== "generate_code" && intent.intent !== "chat" && intent.intent !== "unknown") {
        const intentMessage = buildIntentResponseMessage(intent);
        const convId = store.selectedConversationId ?? "";
        if (convId) {
          store.addMessage(convId, {
            id: `local_user_${Date.now()}`,
            role: "user",
            content: text,
            agentSlug: null,
            status: "completed",
            createdAt: new Date().toISOString(),
            parentMessageId: null,
            regenerationOfMessageId: null,
          });
          store.addMessage(convId, {
            id: `local_assistant_${Date.now()}`,
            role: "assistant",
            content: intentMessage,
            agentSlug: activeAgentId as AgentSlug,
            status: "completed",
            createdAt: new Date().toISOString(),
            parentMessageId: null,
            regenerationOfMessageId: null,
          });
        }
        if (intent.tool) onRouteTool?.(intent.tool);
        if (intent.intent === "connect_github" && typeof window !== "undefined") {
          window.location.href = "/api/github/install";
        }
        return { accepted: true, reply: intentMessage };
      }

      // 3. Ensure we have a conversation
      let conversationId = store.selectedConversationId;
      if (!conversationId) {
        const conv = await createConversation();
        if (!conv) return { accepted: false };
        conversationId = conv.id;
      }

      // 4. Real LLM call through canonical API
      const clientRequestId = generateClientRequestId();
      const expectedRevision = store.revision;

      // Optimistic: add user message to UI
      const optimisticUserId = `optimistic_${clientRequestId}`;
      store.addMessage(conversationId, {
        id: optimisticUserId,
        role: "user",
        content: text,
        agentSlug: null,
        status: "completed",
        createdAt: new Date().toISOString(),
        parentMessageId: null,
        regenerationOfMessageId: null,
      });

      // Optimistic: add pending assistant message
      const optimisticAssistantId = `optimistic_assistant_${clientRequestId}`;
      store.addMessage(conversationId, {
        id: optimisticAssistantId,
        role: "assistant",
        content: "",
        agentSlug: activeAgentId as AgentSlug,
        status: "streaming",
        createdAt: new Date().toISOString(),
        parentMessageId: optimisticUserId,
        regenerationOfMessageId: null,
      });

      setBusy(true);
      try {
        const isAutoBest = selectedModel.id === "auto" || selectedModel.category === "auto";
        const response = await fetch(`/api/studio/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            clientRequestId,
            expectedRevision,
            requestedAgentSlug: activeAgentId,
            provider: isAutoBest ? undefined : selectedModel.apiProvider || selectedModel.provider,
            category: isAutoBest ? "auto" : selectedModel.category,
            model: selectedModel.model,
            images: attachments,
          }),
        });

        const data = await response.json();

        if (response.status === 409) {
          await loadMessages(conversationId);
          return { accepted: false };
        }

        if (!response.ok) {
          store.updateMessage(conversationId, optimisticAssistantId, {
            status: "failed",
            content: data.error || "Failed to get response",
          });
          return { accepted: true, reply: data.error || "Failed" };
        }

        // Check for duplicate (idempotent response)
        if (data.duplicate) {
          const userMsg = data.userMessage as ConversationMessage;
          store.updateMessage(conversationId, optimisticUserId, {
            id: userMsg.id,
            content: userMsg.content,
            createdAt: userMsg.createdAt,
          });

          if (data.assistantMessage) {
            const assistantMsg = data.assistantMessage as ConversationMessage;
            store.updateMessage(conversationId, optimisticAssistantId, {
              id: assistantMsg.id,
              content: assistantMsg.content,
              status: "completed",
              createdAt: assistantMsg.createdAt,
            });
            store.setRevision(data.revision ?? expectedRevision);
            return { accepted: true, reply: assistantMsg.content };
          } else {
            // Still processing — remove optimistic assistant, poll for result
            store.setMessages(
              conversationId,
              store.getMessages().filter((m) => m.id !== optimisticAssistantId),
            );
            store.setRevision(data.revision ?? expectedRevision);
            setTimeout(() => void loadMessages(conversationId!), 2000);
            return { accepted: true };
          }
        }

        // Normal response — replace optimistic messages with real ones
        const userMsg = data.userMessage as ConversationMessage;
        const assistantMsg = data.assistantMessage as ConversationMessage;

        store.updateMessage(conversationId, optimisticUserId, {
          id: userMsg.id,
          content: userMsg.content,
          createdAt: userMsg.createdAt,
        });

        store.updateMessage(conversationId, optimisticAssistantId, {
          id: assistantMsg.id,
          content: assistantMsg.content,
          status: "completed",
          createdAt: assistantMsg.createdAt,
        });

        store.setRevision(data.revision ?? expectedRevision + 1);

        if (data.usedFallbackModel) {
          setFallbackNotice(`${selectedModel.label} was unavailable. This response used ${data.usedFallbackModel}.`);
        }

        return { accepted: true, reply: assistantMsg.content };
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : `${AGENT_META[activeAgentId].displayName} is reconnecting`;
        const reply = sanitizeErrorMessage(rawMessage);
        store.updateMessage(conversationId!, optimisticAssistantId, {
          status: "failed",
          content: reply,
        });
        return { accepted: true, reply };
      } finally {
        setBusy(false);
      }
    },
    [busy, store, createConversation, loadMessages, onRouteTool, selectedModel, activeAgentId, sessionManager, setFallbackNotice],
  );

  // Regenerate — calls canonical regenerate API
  const regenerate = useCallback(async () => {
    const conversationId = store.selectedConversationId;
    if (!conversationId || busy) return;

    const allMessages = store.getMessages();
    const lastAssistantIdx = allMessages.findLastIndex((m) => m.role === "assistant" && m.status === "completed");
    if (lastAssistantIdx === -1) return;
    const lastAssistant = allMessages[lastAssistantIdx];

    setBusy(true);
    try {
      const response = await fetch(`/api/studio/conversations/${conversationId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantMessageId: lastAssistant.id,
          clientRequestId: generateClientRequestId(),
          expectedRevision: store.revision,
        }),
      });

      const data = await response.json();

      if (response.status === 409) {
        await loadMessages(conversationId);
        return;
      }

      if (!response.ok) return;

      const newMsg = data.assistantMessage as ConversationMessage;
      store.addMessage(conversationId, toCanonicalChatMessage(newMsg));
      store.setRevision(data.revision ?? store.revision + 1);
    } catch {
      // Non-fatal
    } finally {
      setBusy(false);
    }
  }, [busy, store, loadMessages]);

  // Clear — clears visible transcript
  const clear = useCallback(() => {
    const convId = store.selectedConversationId;
    if (convId) {
      store.setMessages(convId, []);
    }
  }, [store]);

  // Agent switching — stays within the same conversation
  const switchAgent = useCallback((id: AgentId) => {
    setActiveAgentId(id);
    store.setActiveAgent(id as AgentSlug);
    const conversationId = store.selectedConversationId;
    if (conversationId) {
      void (async () => {
        try {
          await fetch(`/api/studio/conversations/${conversationId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: store.revision,
              patch: { activeAgentSlug: id },
            }),
          });
        } catch {
          // Non-fatal
        }
      })();
    }
  }, [setActiveAgentId, store]);

  return {
    messages,
    busy,
    send,
    regenerate,
    clear,
    activeAgentId,
    fallbackNotice,
    initialPrompt,
    // Session management (preserved for compatibility, messages NOT stored in sessions)
    sessions: sessionManager.sessions,
    activeSessionId: sessionManager.activeId,
    selectSession: sessionManager.setActiveId,
    newSession: () => sessionManager.create(),
    renameSession: sessionManager.rename,
    deleteSession: sessionManager.remove,
    deleteAllSessions: sessionManager.removeAll,
    // Canonical conversation management
    switchAgent,
    selectedConversationId: store.selectedConversationId,
    conversations: store.conversations,
    loading: store.loading,
  };
}

function buildIntentResponseMessage(intent: IntentResult): string {
  if (intent.intent === "open_terminal") {
    return "Opening Terminal.\n\nYour project workspace is not ready yet, so the PTY cannot start.\n\n[Connect GitHub] [Start Blank Project]";
  }
  if (intent.intent === "connect_github") {
    return "Connecting GitHub. Redirecting to GitHub App installation...";
  }
  if (intent.intent === "start_blank_project") {
    return "Starting a blank project. Workspace will be ready in a moment.";
  }
  if (intent.intent === "run_command") {
    return "Opening Terminal to run that command.";
  }
  if (intent.intent === "generate_image") {
    return "Opening the image generator.";
  }
  return intent.message || "Done.";
}

function sanitizeErrorMessage(raw: string): string {
  if (/All LLM providers failed/i.test(raw)) {
    return "LiTT couldn't reach the selected AI model. I tried the available backups, but none responded.\n\nTry again, or choose a different model from the selector.";
  }
  if (/OpenRouter \d{3}/i.test(raw)) {
    return "The selected model is temporarily unavailable. Try Auto Best or choose another model.";
  }
  if (/GROQ_API_KEY not set/i.test(raw)) {
    return "Groq is not configured. Try Auto Best or Gemini.";
  }
  if (/OPENROUTER_API_KEY not set/i.test(raw)) {
    return "OpenRouter is not configured. Try Auto Best or Gemini.";
  }
  return raw;
}

export type StudioConversation = ReturnType<typeof useCanonicalConversation>;
export type { AgentId };
