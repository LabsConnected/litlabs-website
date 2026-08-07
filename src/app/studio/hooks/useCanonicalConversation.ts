"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
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
import type { InspectorTab } from "../lib/studio-destinations";
import type { AgentSlug, Conversation, ConversationMessage } from "@/lib/studio/types";
import {
  useConversationStore,
  EMPTY_CONVERSATION_MESSAGES,
  type ChatMessage as CanonicalChatMessage,
  toChatMessage as toCanonicalChatMessage,
  parseConversationFromUrl,
  serializeConversationToUrl,
} from "../stores/useConversationStore";

export type SendErrorKind = "auth" | "conflict" | "network" | "provider" | "validation";

export interface SendResult {
  accepted: boolean;
  persisted: boolean;
  reply?: string;
  errorKind?: SendErrorKind;
}

const ACTIVE_PROJECT_KEY_PREFIX = "litt:active-project-id";
const OPTIMISTIC_CONVERSATION_ID_PREFIX = "pending_";

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
    id: msg.id,
    role: msg.role,
    content: msg.content,
    status: msg.status,
    agentSlug: msg.agentSlug,
    agentMode: msg.agentMode ?? null,
    createdAt: new Date(msg.createdAt).getTime() || Date.now(),
    reasoning: msg.reasoning,
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
  onRouteToolAction,
  onRouteInspectorAction,
  onRunHealthChecks,
  serverProjectId,
}: {
  onRouteToolAction?: (tool: StudioTool, command?: string) => void;
  onRouteInspectorAction?: (tab: InspectorTab) => void;
  /** Triggered when LiTT should run all project health checks */
  onRunHealthChecks?: () => void;
  serverProjectId?: string | null;
} = {}) {
  const [busy, setBusy] = useState(false);
  const [sendError, setSendErrorState] = useState<string | null>(null);
  const sendErrorRef = useRef<string | null>(null);
  const setSendError = useCallback((value: string | null) => {
    sendErrorRef.current = value;
    setSendErrorState(value);
  }, []);
  const [requiresReauth, setRequiresReauth] = useState(false);
  const requestAbortRef = useRef<AbortController | null>(null);
  const { capabilities } = useConnectionSummary();
  const { voiceTransportConnected, voiceInputState, voiceState, voiceOutputState } = useVoiceSession();
  const { userId, getToken, isLoaded, isSignedIn } = useClerkAuth();

  // Same-origin cookies normally carry Clerk auth, but an explicit bearer
  // token keeps Studio API calls authenticated across production proxy/CDN
  // boundaries and makes a lost session distinguishable from project setup.
  const authHeaders = useCallback(async (json = false): Promise<HeadersInit> => {
    const token = await getToken?.();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [getToken]);

  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const activeAgentMode = useStudioAgentStore((s) => s.activeAgentMode);
  const activeAgentInstanceId = useStudioAgentStore((s) => s.activeAgentInstanceId);
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

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isSyncingFromUrl = useRef(false);
  const activeAgentIdRef = useRef(activeAgentId);
  useEffect(() => { activeAgentIdRef.current = activeAgentId; }, [activeAgentId]);

  // Ref to read current searchParams inside loadConversations without
  // depending on it — prevents the loadConversations → syncUrl →
  // router.replace → searchParams change → loadConversations infinite loop.
  const searchParamsRef = useRef(searchParams);
  useEffect(() => { searchParamsRef.current = searchParams; }, [searchParams]);
  const loadedProjectIdRef = useRef<string | null | undefined>(undefined);

  const initialPrompt = searchParams.get("mission") || searchParams.get("prompt") || "";
  const runtimeContext = useMemo(() => ({
    terminalExecution: capabilities.terminalExecution,
    terminalStatus: capabilities.terminalStatus,
    terminalSessionId: capabilities.terminalSessionId,
    voiceTransportConnected,
    voiceInputState,
    voiceMicrophoneOn: voiceInputState === "listening",
    voiceState,
    voiceOutputState,
    voiceHealth: capabilities.voiceHealth,
    writeAccess: capabilities.writeAccess,
    activeBranch: capabilities.activeBranch,
    repositoryName: capabilities.repositoryName,
    workspaceStatus: capabilities.workspaceStatus,
    selectedModelLabel: selectedModel.label,
    selectedModelId: selectedModel.id,
  }), [capabilities, voiceTransportConnected, voiceInputState, voiceState, voiceOutputState, selectedModel]);

  // Subscribe to the messages slice reactively (selector pattern, matching
  // CanvasPanel). The no-selector + store.getMessages() approach relies on the
  // whole-state object identity changing on every set(), which is fragile.
  const canonicalMessages = useConversationStore(
    (s) =>
      s.messagesByConversationId[s.selectedConversationId ?? ""] ??
      EMPTY_CONVERSATION_MESSAGES,
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
        credentials: "include",
        headers: await authHeaders(),
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
  }, [getStore, authHeaders]);

  // Load conversations from server on mount
  const loadConversations = useCallback(async () => {
    const projectId = getActiveProjectId(serverProjectId, userId);
    const s = getStore();
    if (loadedProjectIdRef.current !== projectId) {
      s.resetForProject();
      loadedProjectIdRef.current = projectId;
    }
    if (!projectId) return;

    s.setLoading(true);
    try {
      const res = await fetch(`/api/studio/conversations?projectId=${encodeURIComponent(projectId)}`, {
        cache: "no-store",
        credentials: "include",
        headers: await authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      const conversations = (data.conversations || []) as Conversation[];
      s.setConversations(conversations);

      const { conversationId, agentSlug } = parseConversationFromUrl(searchParamsRef.current);
      const agentInstanceFromUrl = searchParamsRef.current?.get("agentInstance") ?? null;
      if (conversationId && conversations.some((c) => c.id === conversationId)) {
        s.selectConversation(conversationId);
        if (agentInstanceFromUrl) {
          useStudioAgentStore.getState().setActiveAgentInstance(agentInstanceFromUrl, agentSlug ?? undefined);
        } else if (agentSlug) {
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
  }, [getStore, setActiveAgentId, loadMessages, serverProjectId, userId, authHeaders]);

  // Create a new conversation
  const createConversation = useCallback(async (
    options?: { optimisticConversationId?: string },
  ): Promise<Conversation | null> => {
    let projectId = getActiveProjectId(serverProjectId, userId);

    try {
      const res = await fetch("/api/studio/conversations", {
        method: "POST",
        credentials: "include",
        headers: await authHeaders(true),
        body: JSON.stringify({
          projectId: projectId || undefined,
          activeAgentSlug: activeAgentId,
        }),
      });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          const secs = retryAfter ? parseInt(retryAfter, 10) : 60;
          setSendError(`You're sending messages too fast. Try again in ${secs} second${secs > 1 ? "s" : ""}.`);
        } else {
          setSendError(res.status === 401
            ? "Your Studio session expired. Refresh the page and sign in again."
            : errorBody?.error || `Failed to create conversation (${res.status}).`);
        }
        return null;
      }
      const data = await res.json();
      const conversation = data.conversation as Conversation;
      projectId = data.projectId ?? conversation.projectId ?? projectId;
      if (projectId) setActiveProjectId(projectId, userId);
      const s = getStore();
      if (options?.optimisticConversationId) {
        const optimisticMessages = s.messagesByConversationId[options.optimisticConversationId] ?? [];
        if (optimisticMessages.length > 0) {
          s.setMessages(conversation.id, optimisticMessages);
        }
      }
      s.setConversations([conversation, ...s.conversations]);
      s.selectConversation(conversation.id);
      if (!options?.optimisticConversationId) {
        s.setMessages(conversation.id, []);
      }
      s.setRevision(1);
      return conversation;
    } catch {
      setSendError("Network error while creating conversation.");
      return null;
    }
  }, [getStore, activeAgentId, serverProjectId, userId, authHeaders, setSendError]);

  // Sync URL when conversation or agent changes
  const syncUrl = useCallback(() => {
    if (isSyncingFromUrl.current) return;
    const conversationForUrl = selectedConversationId?.startsWith(OPTIMISTIC_CONVERSATION_ID_PREFIX)
      ? null
      : selectedConversationId;
    const params = serializeConversationToUrl(
      conversationForUrl,
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
    if (s.selectedConversationId?.startsWith(OPTIMISTIC_CONVERSATION_ID_PREFIX)) {
      isSyncingFromUrl.current = false;
      return;
    }
    const { conversationId, agentSlug } = parseConversationFromUrl(searchParams);
    const agentInstanceFromUrl = searchParams.get("agentInstance") ?? null;
    if (conversationId !== s.selectedConversationId) {
      if (conversationId && s.conversations.some((c) => c.id === conversationId)) {
        s.selectConversation(conversationId);
        void loadMessages(conversationId);
      } else if (!conversationId && s.selectedConversationId) {
        s.selectConversation(null);
      }
    }
    if (agentInstanceFromUrl) {
      useStudioAgentStore.getState().setActiveAgentInstance(agentInstanceFromUrl, agentSlug ?? undefined);
    } else if (agentSlug && agentSlug !== activeAgentIdRef.current) {
      s.setActiveAgent(agentSlug);
      setActiveAgentId(agentSlug);
    }
    isSyncingFromUrl.current = false;
  }, [searchParams, getStore, loadMessages, setActiveAgentId]);

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

  // Clear requiresReauth when Clerk reports a valid signed-in session again
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      setRequiresReauth(false);
    }
  }, [isLoaded, isSignedIn]);

  // Load conversations on mount
  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // The send function — matches useStudioConversation's contract
  const send = useCallback(
    async (value: string, attachments?: string[]): Promise<SendResult> => {
      const text = value.trim();
      if ((!text && !attachments?.length) || busy) return { accepted: false, persisted: false };

      // Do not send until Clerk has loaded the session, and block sends
      // while reauthentication is required (expired session banner shown).
      if (!isLoaded) return { accepted: false, persisted: false };
      if (requiresReauth) return { accepted: false, persisted: false, errorKind: "auth" };

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
            agentMode: activeAgentMode,
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
            return { accepted: true, persisted: true };
          case "new":
            void createConversation();
            return { accepted: true, persisted: true };
          case "terminal":
            onRouteToolAction?.("terminal");
            addLocalMessage("Opening Terminal.");
            return { accepted: true, persisted: true };
          case "sessions": {
            const sessionsList = s.conversations.length > 0
              ? s.conversations.map((c, i) => `${i + 1}. ${c.title || "Untitled"}${c.id === convId ? " (active)" : ""}`).join("\n")
              : "No conversations yet. Type /new to start one.";
            addLocalMessage(`Your conversations:\n\n${sessionsList}`);
            return { accepted: true, persisted: true };
          }
          case "delete": {
            const convId = s.selectedConversationId;
            const conv = s.getSelectedConversation();
            if (convId && conv && window.confirm(`Delete "${conv.title || "this conversation"}"?`)) {
              try {
                await fetch(`/api/studio/conversations/${convId}`, {
                  method: "DELETE",
                  credentials: "include",
                  headers: await authHeaders(),
                });
                s.setConversations(s.conversations.filter((c) => c.id !== convId));
                s.selectConversation(null);
              } catch {
                // Non-fatal
              }
            }
            return { accepted: true, persisted: true };
          }
          case "rename": {
            const convId = s.selectedConversationId;
            if (localCommand.title && convId) {
              try {
                await fetch(`/api/studio/conversations/${convId}`, {
                  method: "PATCH",
                  credentials: "include",
                  headers: await authHeaders(true),
                  body: JSON.stringify({ expectedRevision: s.revision, patch: { title: localCommand.title } }),
                });
                s.setConversations(s.conversations.map((c) => c.id === convId ? { ...c, title: localCommand.title! } : c));
              } catch {
                // Non-fatal
              }
            }
            return { accepted: true, persisted: true };
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
            return { accepted: true, persisted: true };
          default:
            return { accepted: true, persisted: true };
        }
      }

      // 2. Deterministic product intents before any LLM call
      const intent = detectIntent(text);
      if (intent && intent.intent !== "generate_code" && intent.intent !== "chat" && intent.intent !== "unknown") {
        const intentMessage = buildIntentResponseMessage(intent, {
          terminalConnected: runtimeContext.terminalStatus === "connected",
        });
        const s = getStore();
        const convId = s.selectedConversationId ?? "";
        if (convId) {
          s.addMessage(convId, {
            id: `local_user_${Date.now()}`,
            role: "user",
            content: text,
            agentSlug: null,
            agentMode: null,
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
            agentMode: activeAgentMode,
            status: "completed",
            createdAt: new Date().toISOString(),
            parentMessageId: null,
            regenerationOfMessageId: null,
          });
        }
        if (intent.intent === "open_files" || intent.intent === "file_question") {
          onRouteInspectorAction?.("files");
        } else if (intent.intent === "open_preview" || intent.intent === "visual_output") {
          onRouteInspectorAction?.("preview");
        } else if (intent.intent === "project_health") {
          onRouteInspectorAction?.("checks");
          // Trigger real check execution — not just panel navigation
          onRunHealthChecks?.();
        } else if (intent.intent === "open_approvals") {
          onRouteInspectorAction?.("approvals");
        } else if (intent.tool) {
          onRouteToolAction?.(intent.tool);
        }
        if (intent.intent === "connect_github" && typeof window !== "undefined") {
          window.location.href = "/api/github/install";
        }
        return { accepted: true, persisted: true, reply: intentMessage };
      }

      // 3. Ensure we have a conversation
      const s = getStore();
      let conversationId = s.selectedConversationId;
      // Snapshot state before seeding optimistic messages so we can roll back
      // cleanly on any failure (401, 403, network, conflict, abort).
      const previousConversationId = s.selectedConversationId;
      const previousMessagesByConversationId = { ...s.messagesByConversationId };
      const clientRequestId = generateClientRequestId();
      const optimisticUserId = `optimistic_${clientRequestId}`;
      const optimisticAssistantId = `optimistic_assistant_${clientRequestId}`;
      const optimisticTimestamp = new Date().toISOString();
      const optimisticUserMessage = {
        id: optimisticUserId,
        role: "user",
        content: text,
        agentSlug: null,
        agentMode: null,
        status: "completed",
        createdAt: optimisticTimestamp,
        parentMessageId: null,
        regenerationOfMessageId: null,
      } as CanonicalChatMessage;
      const optimisticAssistantMessage = {
        id: optimisticAssistantId,
        role: "assistant",
        content: "",
        agentSlug: activeAgentId as AgentSlug,
        agentMode: activeAgentMode,
        status: "streaming",
        createdAt: optimisticTimestamp,
        parentMessageId: optimisticUserId,
        regenerationOfMessageId: null,
      } as CanonicalChatMessage;

      const seedOptimisticMessages = (id: string) => {
        const current = getStore();
        current.selectConversation(id);
        // Preserve the visible transcript. Replacing this array on every send
        // made earlier LiTT replies appear to vanish from the page.
        current.setMessages(id, [
          ...current.getMessages().filter((m) => !m.id.startsWith("optimistic_")),
          optimisticUserMessage,
          optimisticAssistantMessage,
        ]);
      };

      // Rollback helper — removes both optimistic messages and restores the
      // previous conversation selection. Called on every failure path where
      // the user message was NOT persisted to the server.
      const rollbackOptimistic = (targetConversationId: string | null) => {
        const rb = getStore();
        if (targetConversationId) {
          const existing = previousMessagesByConversationId[targetConversationId] ?? [];
          rb.setMessages(targetConversationId, existing);
        }
        // If a temporary pending_* conversation was created, clean up its
        // messages and restore the previous selection.
        if (
          previousConversationId !== targetConversationId &&
          targetConversationId?.startsWith(OPTIMISTIC_CONVERSATION_ID_PREFIX)
        ) {
          rb.setMessages(targetConversationId, []);
          rb.selectConversation(previousConversationId);
        }
      };

      setBusy(true);

      if (!conversationId) {
        const optimisticConversationId = `${OPTIMISTIC_CONVERSATION_ID_PREFIX}${clientRequestId}`;
        seedOptimisticMessages(optimisticConversationId);
        const conv = await createConversation({ optimisticConversationId });
        if (!conv) {
          // Conversation creation failed (401/403/network) — roll back all
          // optimistic state and require reauthentication if it was a 401.
          rollbackOptimistic(optimisticConversationId);
          setBusy(false);
          if (sendErrorRef.current?.includes("session expired")) {
            setRequiresReauth(true);
            return { accepted: false, persisted: false, errorKind: "auth" };
          }
          return { accepted: false, persisted: false, errorKind: "network" };
        }
        conversationId = conv.id;
      } else {
        seedOptimisticMessages(conversationId);
      }

      // Clear any previous send error
      setSendError(null);

      // 4. Real LLM call through canonical API
      getStore().setStreaming(true);
      let requestController: AbortController | null = null;
      let requestTimeoutId: ReturnType<typeof setTimeout> | null = null;
      try {
        const s = getStore();
        const expectedRevision = s.revision;
        const isAutoBest = selectedModel.id === "auto" || selectedModel.category === "auto";
        // Abort after 120s — the route now streams (maxDuration=120), so
        // reasoning/thinking models get room to think before emitting text
        // instead of being killed at 55s ("cut out").
        const controller = new AbortController();
        requestController = controller;
        requestAbortRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), 120_000);
        requestTimeoutId = timeoutId;
        const makeRequest = async (revision: number) => fetch(`/api/studio/conversations/${conversationId}/messages`, {
          method: "POST",
          credentials: "include",
          headers: await authHeaders(true),
          body: JSON.stringify({
            message: text,
            clientRequestId,
            expectedRevision: revision,
            requestedAgentSlug: activeAgentId,
            agentMode: activeAgentMode,
            agentInstanceId: activeAgentInstanceId || undefined,
            provider: isAutoBest ? undefined : selectedModel.apiProvider || selectedModel.provider,
            category: isAutoBest ? "auto" : selectedModel.category,
            model: selectedModel.model,
            images: attachments,
            runtimeContext,
          }),
          signal: controller.signal,
        });
        let response = await makeRequest(expectedRevision);

        // Error / conflict paths still return JSON.
        if (response.status === 409) {
          // Revision conflict — reload messages from server and retry once with
          // the refreshed revision so the user's message still sends.
          await loadMessages(conversationId);
          const s409 = getStore();
          s409.setMessages(
            conversationId,
            s409.getMessages().filter((m) => !m.id.startsWith("optimistic_")),
          );
          seedOptimisticMessages(conversationId);
          response = await makeRequest(s409.revision);
          if (response.status === 409) {
            await loadMessages(conversationId);
            const sFinal409 = getStore();
            sFinal409.setMessages(
              conversationId,
              sFinal409.getMessages().filter((m) => !m.id.startsWith("optimistic_")),
            );
            setSendError("Conversation was updated by another session. Your message was not sent — please try again.");
            return { accepted: false, persisted: false, errorKind: "conflict" };
          }
        }

        // NOTE: Do NOT clear the timeout here — the response headers have
        // arrived but the SSE body is still streaming. Clearing now would
        // leave the streaming phase with no abort protection, so a stalled
        // provider would hang the client forever. The timeout is cleared in
        // the finally block below after the stream is fully consumed.
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const isAuthError = response.status === 401 || response.status === 403;
          if (isAuthError) {
            // Auth failure — roll back optimistic messages entirely (the
            // user message was NOT persisted) and require reauthentication.
            rollbackOptimistic(conversationId);
            setRequiresReauth(true);
            setSendError("Your Studio session expired. Refresh the page and sign in again.");
            return { accepted: false, persisted: false, errorKind: "auth" };
          }
          if (response.status === 429) {
            // Rate limited — show a friendly message with the retry window.
            // The user message was not persisted; roll back optimistic msgs.
            rollbackOptimistic(conversationId);
            const retryAfter = response.headers.get("Retry-After");
            const secs = retryAfter ? parseInt(retryAfter, 10) : 60;
            const friendly = secs > 60
              ? `You're sending messages too fast. Try again in ${Math.ceil(secs / 60)} minute${Math.ceil(secs / 60) > 1 ? "s" : ""}.`
              : `You're sending messages too fast. Try again in ${secs} second${secs > 1 ? "s" : ""}.`;
            setSendError(friendly);
            return { accepted: false, persisted: false, errorKind: "network" };
          }
          // Non-auth HTTP failure — the user message was not persisted.
          // Roll back optimistic messages and show the error.
          rollbackOptimistic(conversationId);
          const errorText = data.detail
            ? `${data.error}: ${data.detail}`
            : data.error || `Request failed (${response.status})`;
          setSendError(errorText);
          return { accepted: false, persisted: false, errorKind: "network" };
        }

        const contentType = response.headers.get("content-type") || "";

        // JSON responses are used for completed and duplicate requests.
        if (!contentType.includes("text/event-stream")) {
          const data = await response.json().catch(() => null) as {
            duplicate?: boolean;
            error?: string;
            detail?: string;
            userMessage?: ConversationMessage;
            assistantMessage?: ConversationMessage;
            revision?: number;
            usedFallbackModel?: string;
          } | null;
          if (!data) {
            // JSON parse failed — server returned non-JSON for a 200 response
            rollbackOptimistic(conversationId);
            const errorText = "Server returned an invalid response (not JSON). Check network tab.";
            setSendError(errorText);
            return { accepted: false, persisted: false, errorKind: "network" };
          }
          if (data?.userMessage && data.assistantMessage) {
            const s2 = getStore();
            const userMsg = data.userMessage;
            const assistantMsg = data.assistantMessage;
            s2.updateMessage(conversationId, optimisticUserId, {
              id: userMsg.id,
              content: userMsg.content,
              createdAt: userMsg.createdAt,
            });
            if (!assistantMsg.content?.trim()) {
              s2.updateMessage(conversationId, optimisticAssistantId, {
                id: assistantMsg.id,
                content: "The response was empty. Please try again.",
                status: "failed",
                createdAt: assistantMsg.createdAt,
              });
              setSendError("The AI returned an empty response. Please try again.");
              return { accepted: false, persisted: true, errorKind: "provider" };
            }
            s2.updateMessage(conversationId, optimisticAssistantId, {
              id: assistantMsg.id,
              content: assistantMsg.content,
              status: "completed",
              createdAt: assistantMsg.createdAt,
            });
            s2.setRevision(data.revision ?? expectedRevision + 1);
            if (data.usedFallbackModel) {
              setFallbackNotice(`${selectedModel.label} was unavailable. This response used ${data.usedFallbackModel}.`);
            }
            return { accepted: true, persisted: true, reply: assistantMsg.content };
          }
          if (data?.duplicate) {
            const s2 = getStore();
            const userMsg = data.userMessage;
            s2.updateMessage(conversationId, optimisticUserId, {
              id: userMsg?.id ?? optimisticUserId,
              content: userMsg?.content ?? text,
              createdAt: userMsg?.createdAt ?? optimisticTimestamp,
            });
            if (data.assistantMessage) {
              const assistantMsg = data.assistantMessage;
              s2.updateMessage(conversationId, optimisticAssistantId, {
                id: assistantMsg.id,
                content: assistantMsg.content,
                status: "completed",
                createdAt: assistantMsg.createdAt,
              });
              s2.setRevision(data.revision ?? expectedRevision);
              return { accepted: true, persisted: true, reply: assistantMsg.content };
            }
            s2.setMessages(
              conversationId,
              s2.getMessages().filter((m) => m.id !== optimisticAssistantId),
            );
            s2.setRevision(data.revision ?? expectedRevision);
            setTimeout(() => void loadMessages(conversationId!), 2000);
            return { accepted: true, persisted: true };
          }
          const errorText = data?.error
            ? (data.detail ? `${data.error}: ${data.detail}` : data.error)
            : `Server returned an unexpected response format (status ${response.status}, keys: ${Object.keys(data).join(",") || "none"}). Check network tab.`;
          getStore().updateMessage(conversationId, optimisticAssistantId, {
            status: "failed",
            content: errorText,
          });
          setSendError(errorText);
          return { accepted: false, persisted: false, errorKind: "validation" };
        }

        // ---- SSE streaming path ----
        // Consume the event stream and update the optimistic assistant
        // message incrementally so tokens (and reasoning) appear live.
        if (!response.body) {
          getStore().updateMessage(conversationId, optimisticAssistantId, {
            status: "failed",
            content: "No response body from server.",
          });
          setSendError("No response body from server.");
          return { accepted: false, persisted: false, errorKind: "network" };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantText = "";
        let reasoningText = "";
        let donePayload: Record<string, unknown> | null = null;
        let errorPayload: { message?: string; partialText?: string } | null = null;

        const flushUpdate = () => {
          getStore().updateMessage(conversationId, optimisticAssistantId, {
            content: assistantText,
            reasoning: reasoningText || undefined,
            status: "streaming",
          });
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const evt = JSON.parse(payload) as { type: string; text?: string; message?: string; partialText?: string };
              if (evt.type === "text" && typeof evt.text === "string") {
                assistantText += evt.text;
                flushUpdate();
              } else if (evt.type === "reasoning" && typeof evt.text === "string") {
                reasoningText += evt.text;
                flushUpdate();
              } else if (evt.type === "done") {
                donePayload = evt as unknown as Record<string, unknown>;
              } else if (evt.type === "error") {
                errorPayload = { message: evt.message, detail: evt.detail, partialText: evt.partialText };
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }

        if (errorPayload) {
          const partial = errorPayload.partialText;
          const detail = (errorPayload as { detail?: string }).detail;
          const reply = sanitizeErrorMessage(errorPayload.message || "Provider unavailable");
          if (detail) {
            console.error("[studio] provider error detail:", detail);
          }
          getStore().updateMessage(conversationId, optimisticAssistantId, {
            status: "failed",
            content: partial ? partial : reply,
            reasoning: reasoningText || undefined,
          });
          setSendError(reply);
          // User message was persisted (server accepted the 200), but the
          // provider failed. Don't restore the draft — show Retry instead.
          return { accepted: false, persisted: true, errorKind: "provider" };
        }

        if (donePayload) {
          const userMsg = donePayload.userMessage as ConversationMessage;
          const assistantMsg = donePayload.assistantMessage as ConversationMessage;
          const s3 = getStore();
          s3.updateMessage(conversationId, optimisticUserId, {
            id: userMsg.id,
            content: userMsg.content,
            createdAt: userMsg.createdAt,
          });

          // Guard against empty assistant response
          if (!assistantMsg.content || !assistantMsg.content.trim()) {
            s3.updateMessage(conversationId, optimisticAssistantId, {
              id: assistantMsg.id,
              content: "The response was empty. Please try again.",
              status: "failed",
              createdAt: assistantMsg.createdAt,
            });
            setSendError("The AI returned an empty response. Please try again.");
            // User message persisted, provider returned empty — don't restore draft.
            return { accepted: false, persisted: true, errorKind: "provider" };
          }

          s3.updateMessage(conversationId, optimisticAssistantId, {
            id: assistantMsg.id,
            content: assistantMsg.content,
            reasoning: reasoningText || undefined,
            status: "completed",
            createdAt: assistantMsg.createdAt,
            // CRITICAL: Update agent identity from the server response.
            // This ensures the message identity always matches the backend run,
            // not the composer state at the time the optimistic message was created.
            agentSlug: assistantMsg.agentSlug ?? activeAgentId as AgentSlug,
            agentMode: assistantMsg.agentMode ?? activeAgentMode,
          });

          s3.setRevision((donePayload.revision as number) ?? expectedRevision + 1);

          if (donePayload.usedFallbackModel) {
            setFallbackNotice(`${selectedModel.label} was unavailable. This response used ${donePayload.usedFallbackModel}.`);
          }

          return { accepted: true, persisted: true, reply: assistantMsg.content };
        }

        // Stream ended without an explicit done/error event — keep whatever
        // text we accumulated but mark completed so the bubble doesn't hang.
        const sFinal = getStore();
        if (assistantText.trim()) {
          sFinal.updateMessage(conversationId, optimisticAssistantId, {
            content: assistantText,
            reasoning: reasoningText || undefined,
            status: "completed",
          });
          return { accepted: true, persisted: true, reply: assistantText };
        }
        sFinal.updateMessage(conversationId, optimisticAssistantId, {
          status: "failed",
          content: "The stream ended unexpectedly. Please try again.",
        });
        setSendError("The stream ended unexpectedly. Please try again.");
        // User message was persisted (200 received), stream just ended early.
        return { accepted: false, persisted: true, errorKind: "network" };
      } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        // Remove the empty streaming bubble on failure — it should not
        // remain permanently as an empty or error-filled bubble.
        const s = getStore();
        if (isAbort) {
          // Timeout/abort — distinguish from other errors. The user message
          // may or may not have been persisted; roll back the assistant bubble
          // but keep the user message (the server may have persisted it).
          s.setMessages(
            conversationId!,
            s.getMessages().filter((m) => m.id !== optimisticAssistantId),
          );
          setSendError("The request timed out. Please try again.");
          return { accepted: false, persisted: true, errorKind: "network" };
        }
        const rawMessage = error instanceof Error ? error.message : `${AGENT_META[activeAgentId].displayName} is reconnecting`;
        const reply = sanitizeErrorMessage(rawMessage);
        s.updateMessage(conversationId!, optimisticAssistantId, {
          status: "failed",
          content: reply,
        });
        setSendError(reply);
        // Network error during streaming — user message was likely persisted.
        return { accepted: false, persisted: true, errorKind: "network" };
      } finally {
        if (requestTimeoutId) clearTimeout(requestTimeoutId);
        if (requestController && requestAbortRef.current === requestController) requestAbortRef.current = null;
        getStore().setStreaming(false);
        setBusy(false);
      }
    },
    [busy, getStore, createConversation, loadMessages, onRouteToolAction, onRouteInspectorAction, onRunHealthChecks, selectedModel, activeAgentId, activeAgentMode, activeAgentInstanceId, setFallbackNotice, authHeaders, isLoaded, requiresReauth, runtimeContext, setSendError],
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
    getStore().setStreaming(true);
    try {
      const response = await fetch(`/api/studio/conversations/${conversationId}/regenerate`, {
        method: "POST",
        credentials: "include",
        headers: await authHeaders(true),
        body: JSON.stringify({
          assistantMessageId: lastAssistant.id,
          clientRequestId: generateClientRequestId(),
          expectedRevision: s.revision,
          runtimeContext,
        }),
      });

      const data = await response.json();

      if (response.status === 409) {
        await loadMessages(conversationId);
        setSendError("This conversation changed in another session. It was refreshed; please try again.");
        return;
      }

      if (!response.ok) {
        const message = typeof data?.error === "string" ? data.error : `Regeneration failed (${response.status}).`;
        setSendError(message);
        return;
      }

      const newMsg = data.assistantMessage as ConversationMessage;
      if (!newMsg?.content?.trim()) {
        setSendError("The regenerated response was empty. Please try again.");
        return;
      }
      const s2 = getStore();
      s2.addMessage(conversationId, toCanonicalChatMessage(newMsg));
      s2.setRevision(data.revision ?? s2.revision + 1);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Regeneration failed. Please try again.");
    } finally {
      getStore().setStreaming(false);
      setBusy(false);
    }
  }, [busy, getStore, loadMessages, authHeaders, runtimeContext, setSendError]);

  const cancel = useCallback(() => {
    requestAbortRef.current?.abort();
  }, []);

  // Clear — clears visible transcript
  const clear = useCallback(() => {
    const s = getStore();
    const convId = s.selectedConversationId;
    if (convId) {
      s.setMessages(convId, []);
    }
    setSendError(null);
  }, [getStore, setSendError]);

  // Delete the active server-side conversation.
  const deleteConversation = useCallback(async (): Promise<boolean> => {
    const s = getStore();
    const conversationId = s.selectedConversationId;
    const conversation = s.getSelectedConversation();
    if (!conversationId || !conversation) return false;
    if (!window.confirm(`Delete "${conversation.title || "this conversation"}"?`)) return false;

    try {
      const response = await fetch(`/api/studio/conversations/${conversationId}`, {
        method: "DELETE",
        credentials: "include",
        headers: await authHeaders(),
      });
      if (!response.ok) {
        setSendError("Failed to delete this conversation.");
        return false;
      }
      const remaining = s.conversations.filter((item) => item.id !== conversationId);
      s.setConversations(remaining);
      s.selectConversation(remaining[0]?.id ?? null);
      if (remaining[0]) {
        await loadMessages(remaining[0].id);
      }
      return true;
    } catch {
      setSendError("Network error while deleting this conversation.");
      return false;
    }
  }, [getStore, authHeaders, loadMessages, setSendError]);

  // Rename the active conversation (server-side PATCH).
  const renameConversation = useCallback(async (title: string): Promise<boolean> => {
    const s = getStore();
    const conversationId = s.selectedConversationId;
    if (!conversationId || !title.trim()) return false;
    try {
      const response = await fetch(`/api/studio/conversations/${conversationId}`, {
        method: "PATCH",
        credentials: "include",
        headers: await authHeaders(true),
        body: JSON.stringify({ expectedRevision: s.revision, patch: { title: title.trim() } }),
      });
      if (!response.ok) {
        setSendError("Failed to rename this conversation.");
        return false;
      }
      s.setConversations(s.conversations.map((c) => c.id === conversationId ? { ...c, title: title.trim() } : c));
      return true;
    } catch {
      setSendError("Network error while renaming this conversation.");
      return false;
    }
  }, [getStore, authHeaders, setSendError]);

  // Export the active conversation as a JSON download.
  const exportConversation = useCallback(() => {
    const s = getStore();
    const conversationId = s.selectedConversationId;
    const conversation = s.getSelectedConversation();
    if (!conversationId || !conversation) return;
    const payload = {
      id: conversationId,
      title: conversation.title,
      exportedAt: new Date().toISOString(),
      messages: s.messagesByConversationId[conversationId] ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(conversation.title || "conversation").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
            credentials: "include",
            headers: await authHeaders(true),
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
  }, [setActiveAgentId, getStore, authHeaders]);

  return {
    messages,
    busy,
    send,
    cancel,
    regenerate,
    clear,
    activeAgentId,
    fallbackNotice,
    initialPrompt,
    // Canonical conversation management (sessions are server-side conversations)
    createConversation,
    deleteConversation,
    renameConversation,
    exportConversation,
    switchAgent,
    selectedConversationId,
    conversations,
    loading: loadingState,
    sendError,
    clearSendError: () => setSendError(null),
    requiresReauth,
    clearRequiresReauth: () => setRequiresReauth(false),
  };
}

function buildIntentResponseMessage(
  intent: IntentResult,
  runtime: { terminalConnected: boolean },
): string {
  if (intent.intent === "open_terminal") {
    return runtime.terminalConnected
      ? "Opening Terminal."
      : "The terminal is not connected yet. Use Workspace status → Open Terminal & Connect when you want to start it.";
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
  if (intent.intent === "project_health") {
    return runtime.terminalConnected
      ? "I'm running a complete project health check now — TypeScript, lint, tests, build, and security audit. Results will appear in the Project Health panel."
      : "I'll run a complete project health check. The workspace is being resolved — results will stream into the Project Health panel once the terminal connects.";
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
