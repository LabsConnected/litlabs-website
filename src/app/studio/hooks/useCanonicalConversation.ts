"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
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

const ACTIVE_PROJECT_KEY_PREFIX = "litt:active-project-id";

/**
 * Build a user-scoped localStorage key for the active project ID.
 * This prevents cross-user contamination when multiple users share
 * the same browser (sign out → sign in as different user).
 */
function activeProjectKey(userId: string | null): string {
  return userId ? `${ACTIVE_PROJECT_KEY_PREFIX}:${userId}` : ACTIVE_PROJECT_KEY_PREFIX;
}

function getActiveProjectId(serverProjectId: string | null | undefined, userId: string | null | undefined): string | null {
  if (typeof window === "undefined") return serverProjectId ?? null;
  // Server-resolved project ID is authoritative.
  // localStorage is only a fallback cache, scoped by user.
  return serverProjectId ?? localStorage.getItem(activeProjectKey(userId ?? null)) ?? null;
}

/**
 * Persist the active project ID to localStorage, scoped by user.
 */
function setActiveProjectId(projectId: string, userId: string | null | undefined) {
  if (typeof window === "undefined") return;
  localStorage.setItem(activeProjectKey(userId ?? null), projectId);
}

/**
 * Clear stale project IDs for other users (called on sign-in).
 */
function clearStaleProjectIds(currentUserId: string) {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(localStorage).filter(
      (k) => k.startsWith(ACTIVE_PROJECT_KEY_PREFIX) && k !== activeProjectKey(currentUserId),
    );
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // ignore
  }
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
  serverProjectId,
}: {
  onRouteTool?: (tool: StudioTool, command?: string) => void;
  serverProjectId?: string | null;
} = {}) {
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const { capabilities } = useConnectionSummary();
  const { voiceTransportConnected, voiceInputState } = useVoiceSession();
  const { userId } = useClerkAuth();

  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const setActiveAgentId = useStudioAgentStore((s) => s.setActiveAgent);

  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const fallbackNotice = useStudioModelStore((s) => s.fallbackNotice);
  const setFallbackNotice = useStudioModelStore((s) => s.setFallbackNotice);

  // Reactive state slices for render — using selectors avoids the whole-state
  // subscription that caused infinite re-render loops (every set() created a new
  // state object, which changed every useCallback identity, which re-ran effects).
  const selectedConversationId = useConversationStore((s) => s.selectedConversationId);
  const conversations = useConversationStore((s) => s.conversations);
  const loadingState = useConversationStore((s) => s.loading);

  // Stable accessor — getState() always returns the latest snapshot and the
  // action functions are stable references defined once in create().
  const getStore = useConversationStore.getState;
  const store = useMemo(
    () =>
      new Proxy({} as ReturnType<typeof useConversationStore.getState>, {
        get: (_target, property) => getStore()[property as keyof ReturnType<typeof getStore>],
      }),
    [getStore],
  );

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isSyncingFromUrl = useRef(false);

  const { profile } = useProfile();
  const initialPrompt = searchParams.get("mission") || "";

  // Subscribe to the messages slice reactively (selector pattern, matching
  // CanvasPanel). The no-selector + store.getMessages() approach relies on the
  // whole-state object identity changing on every set(), which is fragile.
  const canonicalMessages = useConversationStore(
    (s) => s.messagesByConversationId[s.selectedConversationId ?? ""] ?? [],
  );

  // Convert canonical store messages to UI ChatMessage format
  const messages = useMemo(
    () => canonicalMessages.map(toUIMessage),
    [canonicalMessages],
  );

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
      const s = getStore();
      s.setMessages(conversationId, chatMsgs);
      s.setRevision(data.revision ?? 1);
    } catch {
      // Non-fatal
    }
  }, [getStore]);

  // Load conversations from server on mount
  const loadConversations = useCallback(async () => {
    const projectId = getActiveProjectId(serverProjectId, userId);
    if (!projectId) return;

    const s = getStore();
    s.setLoading(true);
    try {
      const res = await fetch(`/api/studio/conversations?projectId=${encodeURIComponent(projectId)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      const conversations = (data.conversations || []) as Conversation[];
      s.setConversations(conversations);

      const { conversationId, agentSlug } = parseConversationFromUrl(searchParams);
      if (conversationId && conversations.some((c) => c.id === conversationId)) {
        s.selectConversation(conversationId);
        if (agentSlug) {
          s.setActiveAgent(agentSlug);
          setActiveAgentId(agentSlug);
        }
        await loadMessages(conversationId);
      } else if (conversations.length > 0) {
        s.selectConversation(conversations[0].id);
        await loadMessages(conversations[0].id);
      }
    } catch {
      // Non-fatal — offline or server unavailable
    } finally {
      getStore().setLoading(false);
    }
  }, [searchParams, getStore, setActiveAgentId, loadMessages, serverProjectId, userId]);

  // Create a new conversation
  const createConversation = useCallback(async (): Promise<Conversation | null> => {
    let projectId = getActiveProjectId(serverProjectId, userId);

    // Auto-provision a blank project if the user has none yet. Without this,
    // chat is completely dead for new users — createConversation fails and the
    // only feedback is a buried red banner, so the transcript stays empty.
    if (!projectId) {
      try {
        const projRes = await fetch("/api/studio-projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceType: "blank",
            name: "My First Project",
            templateId: "blank-static",
          }),
        });
        if (projRes.ok) {
          const projData = await projRes.json();
          projectId = projData.project?.id ?? null;
          if (projectId) {
            setActiveProjectId(projectId, userId);
          }
        }
      } catch {
        // fall through to the error below
      }
    }

    if (!projectId) {
      setSendError("LiTT couldn't start this conversation because no active project was resolved.");
      return null;
    }

    try {
      const res = await fetch("/api/studio/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          activeAgentSlug: activeAgentId,
        }),
      });
      if (!res.ok) {
        setSendError(`Failed to create conversation (${res.status}).`);
        return null;
      }
      const data = await res.json();
      const conversation = data.conversation as Conversation;
      const s = getStore();
      s.setConversations([conversation, ...s.conversations]);
      s.selectConversation(conversation.id);
      s.setMessages(conversation.id, []);
      s.setRevision(1);
      return conversation;
    } catch {
      setSendError("Network error while creating conversation.");
      return null;
    }
  }, [getStore, activeAgentId, serverProjectId, userId]);

  // Sync URL when conversation or agent changes
  const syncUrl = useCallback(() => {
    if (isSyncingFromUrl.current) return;
    const params = serializeConversationToUrl(
      selectedConversationId,
      activeAgentId as AgentSlug,
      searchParams,
    );
    const target = `${pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    // Avoid router.replace loop — only replace if the URL actually changes
    if (target !== `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`) {
      router.replace(target, { scroll: false });
    }
  }, [selectedConversationId, activeAgentId, searchParams, router, pathname]);

  // Sync from URL on mount and browser navigation
  useEffect(() => {
    isSyncingFromUrl.current = true;
    const s = getStore();
    const { conversationId, agentSlug } = parseConversationFromUrl(searchParams);
    if (conversationId !== s.selectedConversationId) {
      if (conversationId && s.conversations.some((c) => c.id === conversationId)) {
        s.selectConversation(conversationId);
        void loadMessages(conversationId);
      } else if (!conversationId && s.selectedConversationId) {
        s.selectConversation(null);
      }
    }
    if (agentSlug && agentSlug !== activeAgentId) {
      s.setActiveAgent(agentSlug);
      setActiveAgentId(agentSlug);
    }
    isSyncingFromUrl.current = false;
  }, [searchParams, getStore, loadMessages, activeAgentId, setActiveAgentId]);

  // Sync URL when state changes
  useEffect(() => {
    syncUrl();
  }, [syncUrl]);

  // Clear stale project IDs from other users on sign-in
  useEffect(() => {
    if (userId) {
      clearStaleProjectIds(userId);
    }
  }, [userId]);

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
        const s = getStore();
        const convId = s.selectedConversationId ?? "";
        // Helper to add a local-only ephemeral message (not persisted to server)
        const addLocalMessage = (content: string) => {
          if (!convId) return;
          s.addMessage(convId, {
            id: `local_assistant_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: "assistant",
            content,
            agentSlug: activeAgentId as AgentSlug,
            status: "completed",
            createdAt: new Date().toISOString(),
            parentMessageId: null,
            regenerationOfMessageId: null,
          });
        };
        switch (localCommand.type) {
          case "clear":
            s.setMessages(convId, []);
            addLocalMessage("Screen cleared. Previous messages are still saved on the server and will reappear on refresh.");
            return { accepted: true };
          case "new":
            void createConversation();
            return { accepted: true };
          case "terminal":
            onRouteTool?.("terminal");
            addLocalMessage("Opening Terminal.");
            return { accepted: true };
          case "sessions": {
            const sessionsList = s.conversations.length > 0
              ? s.conversations.map((c, i) => `${i + 1}. ${c.title || "Untitled"}${c.id === convId ? " (active)" : ""}`).join("\n")
              : "No conversations yet. Type /new to start one.";
            addLocalMessage(`Your conversations:\n\n${sessionsList}`);
            return { accepted: true };
          }
          case "delete": {
            const convId = s.selectedConversationId;
            const conv = s.getSelectedConversation();
            if (convId && conv && window.confirm(`Delete "${conv.title || "this conversation"}"?`)) {
              try {
                await fetch(`/api/studio/conversations/${convId}`, { method: "DELETE" });
                s.setConversations(s.conversations.filter((c) => c.id !== convId));
                s.selectConversation(null);
              } catch {
                // Non-fatal
              }
            }
            return { accepted: true };
          }
          case "rename": {
            const convId = s.selectedConversationId;
            if (localCommand.title && convId) {
              try {
                await fetch(`/api/studio/conversations/${convId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ expectedRevision: s.revision, patch: { title: localCommand.title } }),
                });
                s.setConversations(s.conversations.map((c) => c.id === convId ? { ...c, title: localCommand.title! } : c));
              } catch {
                // Non-fatal
              }
            }
            return { accepted: true };
          }
          case "help":
            addLocalMessage([
              "Studio Commands:",
              "  /new — Start a new conversation",
              "  /rename <title> — Rename this conversation",
              "  /delete — Delete this conversation",
              "  /sessions — List your conversations",
              "  /clear — Clear the screen (messages stay on server)",
              "  /terminal — Open the terminal",
              "  /help — Show this help",
            ].join("\n"));
            return { accepted: true };
          default:
            return { accepted: true };
        }
      }

      // 2. Deterministic product intents before any LLM call
      const intent = detectIntent(text);
      if (intent && intent.intent !== "generate_code" && intent.intent !== "chat" && intent.intent !== "unknown") {
        const intentMessage = buildIntentResponseMessage(intent);
        const s = getStore();
        const convId = s.selectedConversationId ?? "";
        if (convId) {
          s.addMessage(convId, {
            id: `local_user_${Date.now()}`,
            role: "user",
            content: text,
            agentSlug: null,
            status: "completed",
            createdAt: new Date().toISOString(),
            parentMessageId: null,
            regenerationOfMessageId: null,
          });
          s.addMessage(convId, {
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
      let conversationId = getStore().selectedConversationId;
      if (!conversationId) {
        const conv = await createConversation();
        if (!conv) return { accepted: false };
        conversationId = conv.id;
      }

      // Clear any previous send error
      setSendError(null);

      // 4. Real LLM call through canonical API
      const clientRequestId = generateClientRequestId();
      const s = getStore();
      const expectedRevision = s.revision;

      // Optimistic: add user message to UI
      const optimisticUserId = `optimistic_${clientRequestId}`;
      s.addMessage(conversationId, {
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
      s.addMessage(conversationId, {
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
        // Abort after 55s so a hanging provider doesn't leave an empty
        // streaming bubble forever (the route has maxDuration=60s).
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 55_000);
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
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await response.json();

        if (response.status === 409) {
          // Revision conflict — reload messages from server, restore unsent text
          await loadMessages(conversationId);
          // Remove optimistic messages — the server has newer state
          const s409 = getStore();
          s409.setMessages(
            conversationId,
            s409.getMessages().filter((m) => m.id !== optimisticUserId && m.id !== optimisticAssistantId),
          );
          setSendError("Conversation was updated by another session. Your message was not sent — please try again.");
          return { accepted: false };
        }

        if (!response.ok) {
          // HTTP failure — remove both optimistic messages so the composer
          // can restore the user's text without transcript duplication.
          getStore().setMessages(
            conversationId,
            getStore().getMessages().filter(
              (m) => m.id !== optimisticUserId && m.id !== optimisticAssistantId,
            ),
          );
          setSendError(data.error || `Request failed (${response.status})`);
          return { accepted: false };
        }

        // Check for duplicate (idempotent response)
        if (data.duplicate) {
          const s2 = getStore();
          const userMsg = data.userMessage as ConversationMessage;
          s2.updateMessage(conversationId, optimisticUserId, {
            id: userMsg.id,
            content: userMsg.content,
            createdAt: userMsg.createdAt,
          });

          if (data.assistantMessage) {
            const assistantMsg = data.assistantMessage as ConversationMessage;
            s2.updateMessage(conversationId, optimisticAssistantId, {
              id: assistantMsg.id,
              content: assistantMsg.content,
              status: "completed",
              createdAt: assistantMsg.createdAt,
            });
            s2.setRevision(data.revision ?? expectedRevision);
            return { accepted: true, reply: assistantMsg.content };
          } else {
            // Still processing — remove optimistic assistant, poll for result
            s2.setMessages(
              conversationId,
              s2.getMessages().filter((m) => m.id !== optimisticAssistantId),
            );
            s2.setRevision(data.revision ?? expectedRevision);
            setTimeout(() => void loadMessages(conversationId!), 2000);
            return { accepted: true };
          }
        }

        // Normal response — replace optimistic messages with real ones
        const userMsg = data.userMessage as ConversationMessage;
        const assistantMsg = data.assistantMessage as ConversationMessage;
        const s3 = getStore();

        s3.updateMessage(conversationId, optimisticUserId, {
          id: userMsg.id,
          content: userMsg.content,
          createdAt: userMsg.createdAt,
        });

        // Guard against empty assistant response — don't leave an empty
        // streaming bubble permanently. If the response is empty, mark
        // as failed with a helpful message.
        if (!assistantMsg.content || !assistantMsg.content.trim()) {
          s3.updateMessage(conversationId, optimisticAssistantId, {
            id: assistantMsg.id,
            content: "The response was empty. Please try again.",
            status: "failed",
            createdAt: assistantMsg.createdAt,
          });
          setSendError("The AI returned an empty response. Please try again.");
          return { accepted: false };
        }

        s3.updateMessage(conversationId, optimisticAssistantId, {
          id: assistantMsg.id,
          content: assistantMsg.content,
          status: "completed",
          createdAt: assistantMsg.createdAt,
        });

        s3.setRevision(data.revision ?? expectedRevision + 1);

        if (data.usedFallbackModel) {
          setFallbackNotice(`${selectedModel.label} was unavailable. This response used ${data.usedFallbackModel}.`);
        }

        return { accepted: true, reply: assistantMsg.content };
      } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        // Remove the empty streaming bubble on failure — it should not
        // remain permanently as an empty or error-filled bubble.
        const s = getStore();
        if (isAbort) {
          // Timeout/abort — remove both optimistic messages, distinguish from other errors
          s.setMessages(
            conversationId!,
            s.getMessages().filter(
              (m) => m.id !== optimisticUserId && m.id !== optimisticAssistantId,
            ),
          );
          setSendError("The request timed out. Please try again.");
          return { accepted: false };
        }
        // Network error — remove both optimistic messages so composer can restore text
        const rawMessage = error instanceof Error ? error.message : `${AGENT_META[activeAgentId].displayName} is reconnecting`;
        const reply = sanitizeErrorMessage(rawMessage);
        s.setMessages(
          conversationId!,
          s.getMessages().filter(
            (m) => m.id !== optimisticUserId && m.id !== optimisticAssistantId,
          ),
        );
        setSendError(reply);
        return { accepted: false };
      } finally {
        setBusy(false);
      }
    },
    [busy, getStore, createConversation, loadMessages, onRouteTool, selectedModel, activeAgentId, setFallbackNotice],
  );

  // Regenerate — calls canonical regenerate API
  const regenerate = useCallback(async () => {
    const s = getStore();
    const conversationId = s.selectedConversationId;
    if (!conversationId || busy) return;

    const allMessages = s.getMessages();
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
          expectedRevision: s.revision,
        }),
      });

      const data = await response.json();

      if (response.status === 409) {
        await loadMessages(conversationId);
        return;
      }

      if (!response.ok) return;

      const newMsg = data.assistantMessage as ConversationMessage;
      const s2 = getStore();
      s2.addMessage(conversationId, toCanonicalChatMessage(newMsg));
      s2.setRevision(data.revision ?? s2.revision + 1);
    } catch {
      // Non-fatal
    } finally {
      setBusy(false);
    }
  }, [busy, getStore, loadMessages]);

  // Clear — clears visible transcript
  const clear = useCallback(() => {
    const s = getStore();
    const convId = s.selectedConversationId;
    if (convId) {
      s.setMessages(convId, []);
    }
  }, [getStore]);

  // Agent switching — stays within the same conversation
  const switchAgent = useCallback((id: AgentId) => {
    setActiveAgentId(id);
    const s = getStore();
    s.setActiveAgent(id as AgentSlug);
    const conversationId = s.selectedConversationId;
    if (conversationId) {
      void (async () => {
        try {
          await fetch(`/api/studio/conversations/${conversationId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: s.revision,
              patch: { activeAgentSlug: id },
            }),
          });
        } catch {
          // Non-fatal
        }
      })();
    }
  }, [setActiveAgentId, getStore]);

  return {
    messages,
    busy,
    send,
    regenerate,
    clear,
    activeAgentId,
    fallbackNotice,
    initialPrompt,
    // Canonical conversation management (sessions are server-side conversations)
    switchAgent,
    selectedConversationId,
    conversations,
    loading: loadingState,
    sendError,
    clearSendError: () => setSendError(null),
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
