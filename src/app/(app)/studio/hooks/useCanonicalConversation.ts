"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findRetryResendText } from "@/lib/studio/retry-strategy";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { parseBuilderLocalCommand } from "../lib/builder-command-router";
import { buildIntentResponseMessage, detectIntent, dispatchStudioIntent } from "../lib/studio-intent";
import { useConnectionSummary, type ConnectionCapabilities } from "./useConnectionSummary";
import { useVoiceSession } from "@/app/(app)/studio/context/VoiceSessionContext";
import {
  useStudioAgentStore,
  type ChatMessage,
  type AgentId,
  type MessageExecution,
} from "../stores/useStudioAgentStore";
import { useStudioModelStore } from "../stores/useStudioModelStore";
import type { StudioTool } from "../lib/studio-destinations";
import type { InspectorTab } from "../lib/studio-destinations";
import type { AgentSlug, Conversation, ConversationMessage } from "@/lib/studio/types";
import {
  useConversationStore,
  EMPTY_CONVERSATION_MESSAGES,
  type ChatMessage as CanonicalChatMessage,
  toChatMessage as toCanonicalChatMessage,
  parseConversationFromUrl,
  serializeConversationToUrl,
  shouldDeferConversationUrlSync,
} from "../stores/useConversationStore";
import { useExecutionStore, feedSSEEventToExecutionStore } from "../stores/useExecutionStore";
import { mobileDiag } from "../lib/mobileDiagnostics";
import {
  reconcileRunState,
  reconciledAssistantStatus,
  type ReconcileResult,
} from "../lib/reconcile-run";

export type SendErrorKind = "auth" | "conflict" | "network" | "provider" | "validation" | "cancelled";

/**
 * Identity of the server-side execution started by send(). Tracked so an
 * explicit Stop can reach the right run via the cancel endpoint even when
 * the SSE reader is already gone. Cleared only when canonical state
 * reaches a terminal outcome — never merely because the fetch ended.
 */
interface ActiveRun {
  conversationId: string;
  clientRequestId: string;
  optimisticUserId: string;
  optimisticAssistantId: string;
}

export interface SendResult {
  accepted: boolean;
  persisted: boolean;
  reply?: string;
  errorKind?: SendErrorKind;
  pendingApproval?: { toolId: string; reason: string; pausedRunId?: string; inputs?: Record<string, unknown> } | null;
  /** True when the assistant ended by asking the user for missing information. */
  awaitingInput?: boolean;
  /**
   * P1-1: when true, the composer must NOT render the "Done · No files
   * changed" completion card for this send. Used by intents whose real
   * action is opening a surface (the Image Studio) rather than running
   * the agent — the card would read as a fake generation success.
   */
  suppressCompletion?: boolean;
}

const ACTIVE_PROJECT_KEY_PREFIX = "litt:active-project-id";
const OPTIMISTIC_CONVERSATION_ID_PREFIX = "pending_";

function endsWithClarifyingQuestion(reply: string): boolean {
  return reply.trim().endsWith("?");
}

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
    // Execution evidence drives the truthful work log. Absent = no execution.
    execution: msg.execution ?? undefined,
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
  onOpenProjectNameDialog,
  onOpenImageStudio,
  onOpenVideoStudio,
  serverProjectId,
  cameraState,
  previewSelection,
  capabilities: externalCapabilities,
}: {
  onRouteToolAction?: (tool: StudioTool, command?: string) => void;
  onRouteInspectorAction?: (tab: InspectorTab) => void;
  /** Triggered when LiTT should run all project health checks */
  onRunHealthChecks?: () => void;
  /** Triggered when LiTT should open the new-project name dialog */
  onOpenProjectNameDialog?: () => void;
  /** P1-1: open the real Image Studio surface with the prompt prefilled */
  onOpenImageStudio?: (prompt: string) => void;
  /** Open the real Video Studio surface with the prompt prefilled. */
  onOpenVideoStudio?: (prompt: string) => void;
  serverProjectId?: string | null;
  /** Camera dock state — passed to the LLM so it knows camera is available */
  cameraState?: { active: boolean; status: string };
  /** Element selected in the live preview, used as context for the next request. */
  previewSelection?: { label: string; selector: string; tagName: string } | null;
  /**
   * Shared capabilities from the caller's own useConnectionSummary. When
   * provided, the hook does NOT start a second polling instance — one
   * summary per Studio mount.
   */
  capabilities?: ConnectionCapabilities;
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
  // Distinguishes an explicit user Stop from an involuntary transport loss —
  // only the former is a cancellation. Transport loss triggers reconciliation.
  const explicitCancelRef = useRef(false);
  // The run currently in flight, so Stop can reach the server-side
  // execution. Survives the end of the fetch/reader lifecycle — transport
  // lifetime != execution lifetime on the client side too.
  const activeRunRef = useRef<ActiveRun | null>(null);
  // Prefer the caller's shared capabilities; the internal instance is
  // disabled then so Studio runs exactly one capability/runtime poll stack.
  const { capabilities: internalCapabilities } = useConnectionSummary({ disabled: Boolean(externalCapabilities) });
  const capabilities = externalCapabilities ?? internalCapabilities;
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
  const executionMode = useStudioAgentStore((s) => s.executionMode);
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
  const previewSelectionRef = useRef(previewSelection);
  useEffect(() => { previewSelectionRef.current = previewSelection; }, [previewSelection]);

  // Ref to read current searchParams inside loadConversations without
  // depending on it — prevents the loadConversations → syncUrl →
  // router.replace → searchParams change → loadConversations infinite loop.
  const searchParamsRef = useRef(searchParams);
  useEffect(() => { searchParamsRef.current = searchParams; }, [searchParams]);
  const loadedProjectIdRef = useRef<string | null | undefined>(undefined);
  // Keep the URL conversation identity intact until the first server
  // conversation list has hydrated. On a hard refresh the store starts empty;
  // syncing that empty state too early deletes ?conversation= before the
  // server can restore the selected conversation.
  const conversationsHydratedRef = useRef(false);
  // Bumped every time the active project actually changes. Sends capture
  // the generation at start; a send that hasn't dispatched yet is cancelled
  // when the project switches under it, so a message can never land in the
  // wrong project's conversation.
  const projectGenerationRef = useRef(0);

  const initialPrompt = searchParams.get("mission") || searchParams.get("prompt") || "";
  const runtimeContext = useMemo(() => ({
    terminalExecution: capabilities.terminalExecution,
    terminalStatus: capabilities.terminalStatus,
    terminalSessionId: capabilities.terminalSessionId,
    terminalFailureStage: capabilities.terminalFailureStage,
    terminalCwd: capabilities.terminalCwd,
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
    cameraActive: cameraState?.active ?? false,
    cameraStatus: cameraState?.status ?? "idle",
  }), [capabilities, voiceTransportConnected, voiceInputState, voiceState, voiceOutputState, selectedModel, cameraState]);

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
        // Bounded: a hung message list must not leave the chat in a
        // perpetual loading state.
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return;
      const data = await res.json();
      const msgs = (data.messages || []) as ConversationMessage[];
      const chatMsgs = msgs.map(toCanonicalChatMessage);
      const s = getStore();
      s.setMessages(conversationId, chatMsgs);
      s.setRevision(data.revision ?? 1);
      // Rehydrate a paused approval gate: when the latest assistant message
      // carries a resumable pausedRunId, the Approve/Reject card must remount
      // after reload. The paused message may persist as awaiting_approval or
      // streaming (the DB status CHECK predates awaiting_approval), so key
      // off the attached pendingApproval instead of the message status.
      // Live runs manage this via SSE — only restore when no run is active.
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      const exec = useExecutionStore.getState();
      if (
        (lastAssistant?.status === "awaiting_approval" || lastAssistant?.status === "streaming")
        && lastAssistant.pendingApproval?.pausedRunId
        && !exec.isRunning
        && !exec.pendingApproval
      ) {
        exec.setPendingApproval({
          toolId: lastAssistant.pendingApproval.toolId,
          reason: lastAssistant.pendingApproval.reason,
          pausedRunId: lastAssistant.pendingApproval.pausedRunId,
          // Rehydration binds to the conversation being loaded — the gate's
          // resume POSTs must target its own conversation, not the selection
          // at click time.
          conversationId: conversationId,
          inputs: lastAssistant.pendingApproval.inputs,
        });
      }
    } catch {
      // Non-fatal
    }
  }, [getStore, authHeaders]);

  // Reconcile canonical conversation state after an SSE transport loss or
  // an explicit Stop. The server-side execution keeps running after a
  // disconnect, so the persisted assistant message — not the broken
  // stream — is the source of truth for what actually happened.
  //
  // Returns the SendResult to surface plus the raw reconcile state so
  // callers can decide run lifecycle (e.g. whether Stop is still viable).
  const reconcileAndApply = useCallback(async (
    run: ActiveRun,
    opts: {
      preferCancelled?: boolean;
      partialText?: string;
      partialReasoning?: string;
    },
  ): Promise<{ sendResult: SendResult; state: ReconcileResult["state"] }> => {
    mobileDiag("streaming", "reconciliation_started");
    const result = await reconcileRunState({
      clientRequestId: run.clientRequestId,
      fetchSnapshot: async () => {
        try {
          const res = await fetch(`/api/studio/conversations/${run.conversationId}/messages`, {
            cache: "no-store",
            credentials: "include",
            headers: await authHeaders(),
          });
          if (!res.ok) return null;
          const data = await res.json() as { messages?: ConversationMessage[]; revision?: number };
          return { messages: data.messages ?? [], revision: data.revision ?? 1 };
        } catch {
          return null;
        }
      },
    });
    mobileDiag(
      "streaming",
      result.state === "unknown" ? "reconciliation_failed" : "reconciliation_completed",
      { state: result.state },
    );

    // Terminal canonical states end the tracked run — Stop no longer
    // targets it. "running"/"unknown" keep the identity so Stop remains
    // able to reach the (possibly still executing) server-side run.
    if (
      result.state !== "running" &&
      result.state !== "unknown" &&
      activeRunRef.current?.clientRequestId === run.clientRequestId
    ) {
      activeRunRef.current = null;
    }

    const s = getStore();
    if (result.userMessage) {
      s.updateMessage(run.conversationId, run.optimisticUserId, {
        id: result.userMessage.id,
        content: result.userMessage.content,
        createdAt: result.userMessage.createdAt,
      });
    }
    if (result.revision != null) {
      s.setRevision(result.revision);
    }
    const persistedAssistant = result.assistantMessage;
    const persistedAssistantPatch = persistedAssistant
      ? { id: persistedAssistant.id, createdAt: persistedAssistant.createdAt }
      : {};
    const finish = (sendResult: SendResult) => ({ sendResult, state: result.state });

    switch (result.state) {
      case "completed": {
        const content = persistedAssistant?.content || opts.partialText || "";
        s.updateMessage(run.conversationId, run.optimisticAssistantId, {
          ...persistedAssistantPatch,
          content,
          reasoning: opts.partialReasoning || undefined,
          status: "completed",
        });
        // A reconciled completion can still be a clarifying question — the
        // transport dropped mid-stream but the run finished asking the user
        // for input. Flag it so the composer never renders a Done card.
        return finish({
          accepted: true,
          persisted: true,
          reply: content,
          awaitingInput: endsWithClarifyingQuestion(content),
        });
      }
      case "awaiting_approval": {
        const pa = persistedAssistant?.pendingApproval ?? null;
        s.updateMessage(run.conversationId, run.optimisticAssistantId, {
          ...persistedAssistantPatch,
          content: persistedAssistant?.content || opts.partialText || "",
          status: "awaiting_approval",
          pendingApproval: pa,
        });
        return finish({
          accepted: true,
          persisted: true,
          reply: persistedAssistant?.content,
          pendingApproval: pa,
        });
      }
      case "failed": {
        const failureText = persistedAssistant?.content || "The run failed on the server.";
        s.updateMessage(run.conversationId, run.optimisticAssistantId, {
          ...persistedAssistantPatch,
          content: failureText,
          status: "failed",
        });
        setSendError(failureText);
        return finish({ accepted: false, persisted: true, errorKind: "provider" });
      }
      case "cancelled": {
        s.updateMessage(run.conversationId, run.optimisticAssistantId, {
          ...persistedAssistantPatch,
          content: persistedAssistant?.content || "Cancelled.",
          status: "cancelled",
        });
        setSendError("Stopped.");
        return finish({ accepted: false, persisted: true, errorKind: "cancelled" });
      }
      case "running": {
        // The server confirms the run is still alive — keep the bubble in
        // its honest non-terminal state. A pending Stop shows "Stopping…",
        // never a premature "Cancelled" the server hasn't confirmed.
        s.updateMessage(run.conversationId, run.optimisticAssistantId, {
          ...persistedAssistantPatch,
          content: persistedAssistant?.content || opts.partialText || "",
          status: reconciledAssistantStatus(result.state),
        });
        setSendError(
          opts.preferCancelled
            ? "Stopping… — waiting for the server to confirm."
            : "Connection lost, but LiTT is still working in the background. Press Stop to cancel it, or reload to see the finished result.",
        );
        return finish({ accepted: false, persisted: true, errorKind: "network" });
      }
      default: {
        // "unknown" — canonical state could not be determined. Honest
        // non-terminal status only: never fake a failure or cancellation
        // the server hasn't persisted.
        s.updateMessage(run.conversationId, run.optimisticAssistantId, {
          ...persistedAssistantPatch,
          content: opts.partialText
            || "Connection lost before LiTT's result could be confirmed. LiTT may still be working — reload the page to check.",
          status: reconciledAssistantStatus(result.state),
        });
        setSendError(
          opts.preferCancelled
            ? "Stop requested — but the server couldn't be reached to confirm. LiTT may still be working."
            : "Connection lost — couldn't confirm whether LiTT finished. Reload the page to check the result.",
        );
        return finish({ accepted: false, persisted: true, errorKind: "network" });
      }
    }
  }, [getStore, authHeaders, setSendError]);

  // Recover a run interrupted by a page refresh (or tab crash) mid-run.
  // After loadMessages, a persisted message may still be "streaming" even
  // though this page never started a run. Rebuild the exact run identity
  // from the persisted user message's clientRequestId + the assistant
  // message's id (which the server uses as parentMessageId), then run the
  // standard reconciliation: Stop keeps working, busy stays true while the
  // server is still running, and a finished run resolves from canonical
  // state instead of leaving a stuck "thinking" bubble.
  const recoverInterruptedRuns = useCallback(async (conversationId: string) => {
    const store = getStore();
    const messages = store.messagesByConversationId[conversationId] ?? [];
    const streamingAssistant = messages.find(
      (m) => m.role === "assistant" && m.status === "streaming",
    );
    if (!streamingAssistant) return;
    const userTurn = [...messages]
      .reverse()
      .find((m) => m.role === "user" && m.id === streamingAssistant.parentMessageId);
    const clientRequestId = userTurn?.clientRequestId;
    if (!clientRequestId) {
      // No run identity survived — resolve from canonical state so the
      // bubble can't stick forever. Treat it as an interrupted assistant.
      await reconcileAndApply({
        conversationId,
        clientRequestId: "",
        optimisticUserId: userTurn?.id ?? streamingAssistant.parentMessageId ?? "",
        optimisticAssistantId: streamingAssistant.id,
      }, {});
      return;
    }
    activeRunRef.current = {
      conversationId,
      clientRequestId,
      optimisticUserId: userTurn?.id ?? "",
      optimisticAssistantId: streamingAssistant.id,
    };
    setBusy(true);
    store.setStreaming(true);
    await reconcileAndApply(activeRunRef.current, {});
  }, [getStore, reconcileAndApply, setBusy]);

  // Load conversations from server on mount
  // Synchronous project-switch signal — bumped the moment the user picks
  // another project (before router state settles), so an in-flight send
  // sees the switch at its pre-dispatch checkpoint.
  useEffect(() => {
    const handler = () => { projectGenerationRef.current += 1; };
    window.addEventListener("studio:project-switching", handler);
    return () => window.removeEventListener("studio:project-switching", handler);
  }, []);

  const loadConversations = useCallback(async () => {
    const projectId = getActiveProjectId(serverProjectId, userId);
    conversationsHydratedRef.current = false;
    const s = getStore();
    if (loadedProjectIdRef.current !== projectId) {
      s.resetForProject();
      loadedProjectIdRef.current = projectId;
      projectGenerationRef.current += 1;
    }
    if (!projectId) {
      conversationsHydratedRef.current = true;
      return;
    }

    s.setLoading(true);
    try {
      const res = await fetch(`/api/studio/conversations?projectId=${encodeURIComponent(projectId)}`, {
        cache: "no-store",
        credentials: "include",
        headers: await authHeaders(),
        // Bounded: a hung list must not leave Studio in a perpetual
        // loading state on mount.
        signal: AbortSignal.timeout(15000),
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
        await recoverInterruptedRuns(conversationId);
      } else if (conversations.length > 0) {
        s.selectConversation(conversations[0].id);
        await loadMessages(conversations[0].id);
        await recoverInterruptedRuns(conversations[0].id);
      }
      conversationsHydratedRef.current = true;
    } catch {
      // Non-fatal — offline or server unavailable
    } finally {
      getStore().setLoading(false);
    }
  }, [getStore, setActiveAgentId, loadMessages, recoverInterruptedRuns, serverProjectId, userId, authHeaders]);

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
    const urlConversationId = parseConversationFromUrl(searchParams).conversationId;
    if (shouldDeferConversationUrlSync(
      conversationsHydratedRef.current,
      urlConversationId,
      selectedConversationId,
    )) return;
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

      // Capture the project generation — checked before dispatch so a
      // mid-send project switch can't route this message to the wrong
      // project's conversation.
      const sendGeneration = projectGenerationRef.current;

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
                const res = await fetch(`/api/studio/conversations/${convId}`, {
                  method: "DELETE",
                  credentials: "include",
                  headers: await authHeaders(),
                });
                if (!res.ok) {
                  setSendError("Failed to delete conversation. Please try again.");
                  return { accepted: false, persisted: false };
                }
                s.setConversations(s.conversations.filter((c) => c.id !== convId));
                s.selectConversation(null);
              } catch {
                setSendError("Network error while deleting conversation.");
                return { accepted: false, persisted: false };
              }
            }
            return { accepted: true, persisted: true };
          }
          case "rename": {
            const convId = s.selectedConversationId;
            if (localCommand.title && convId) {
              try {
                const res = await fetch(`/api/studio/conversations/${convId}`, {
                  method: "PATCH",
                  credentials: "include",
                  headers: await authHeaders(true),
                  body: JSON.stringify({ expectedRevision: s.revision, patch: { title: localCommand.title } }),
                });
                if (res.ok) {
                  s.setConversations(s.conversations.map((c) => c.id === convId ? { ...c, title: localCommand.title! } : c));
                } else {
                  setSendError("Failed to rename conversation.");
                }
              } catch {
                setSendError("Network error while renaming conversation.");
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
              "",
              "LiTT Runtime Commands (same as CLI):",
              "  /status — Show project status (git, branch, changes)",
              "  /diff — Show uncommitted changes",
              "  /check — Run TypeScript typecheck",
              "  /test — Run test suite",
              "  /build — Run production build",
              "  /debug — Run tests with verbose output",
              "  /ship — Run check → test → build (pre-flight)",
            ].join("\n"));
            return { accepted: true, persisted: true };
          case "runtime": {
            // Runtime commands route through the canonical CommandRouter
            // via the web command bridge → terminal-server → agent-core.
            // This is the SAME implementation as `litt status/diff/check/test/build`.
            const cmd = localCommand.command;
            addLocalMessage(`Running \`/${cmd}\` via canonical CommandRouter…`);

            // The bridge resolves the workspace from the project the caller
            // owns, so the active project has to be named. Without it the
            // command ran in terminal-server's own process cwd rather than
            // against this project's workspace.
            const commandProjectId = getActiveProjectId(serverProjectId, userId);
            if (!commandProjectId) {
              addLocalMessage(
                `Cannot run \`/${cmd}\` — no active project. Open or create a project first.`,
              );
              return { accepted: true, persisted: true };
            }

            try {
              const res = await fetch("/api/studio/command", {
                method: "POST",
                credentials: "include",
                headers: await authHeaders(true),
                body: JSON.stringify({
                  command: cmd,
                  args: localCommand.args ? { query: localCommand.args } : undefined,
                  projectId: commandProjectId,
                }),
              });
              const payload = await res.json().catch(() => null) as {
                ok?: boolean;
                runId?: string;
                error?: string;
                result?: {
                  command?: string;
                  result?: { success?: boolean; message?: string; data?: Record<string, unknown> };
                  project?: { name?: string; branch?: string | null; root?: string };
                };
              } | null;

              if (!res.ok || !payload) {
                addLocalMessage(`❌ \`${cmd}\` failed: ${payload?.error ?? "No response from terminal server"}`);
              } else {
                const r = payload.result?.result;
                const success = payload.ok ?? r?.success ?? false;
                const message = r?.message ?? "";
                const projectName = payload.result?.project?.name ?? "";
                const branch = payload.result?.project?.branch ?? "";

                // Format output based on command type
                let output: string;
                if (cmd === "status") {
                  output = [
                    `**${projectName || "Project"}** ${branch ? `\`${branch}\`` : ""}`,
                    "",
                    message,
                  ].filter(Boolean).join("\n");
                } else if (cmd === "diff") {
                  output = message || "(no changes)";
                } else {
                  const status = success ? "✅ PASS" : "❌ FAIL";
                  output = `${status} — \`${cmd}\`\n${message}`;
                }
                addLocalMessage(output);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Network error";
              addLocalMessage(`❌ \`${cmd}\` error: ${msg}`);
            }
            return { accepted: true, persisted: true };
          }
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
        dispatchStudioIntent(intent, {
          onRouteToolAction,
          onRouteInspectorAction,
          onRunHealthChecks,
          onOpenProjectNameDialog,
          onOpenImageStudio,
          onOpenVideoStudio,
          onNavigate: (url) => {
            if (typeof window !== "undefined") window.location.href = url;
          },
        });
        return {
          accepted: true,
          persisted: true,
          reply: intentMessage,
          // P1-1: the image intent opens the Image Studio surface — it is
          // not an agent run, so the "Done · No files changed" completion
          // card must not render (it would fake a generation success).
          suppressCompletion: intent.intent === "generate_image",
        };
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
      useExecutionStore.getState().startRun();

      if (!conversationId) {
        const optimisticConversationId = `${OPTIMISTIC_CONVERSATION_ID_PREFIX}${clientRequestId}`;
        seedOptimisticMessages(optimisticConversationId);
        const conv = await createConversation({ optimisticConversationId });
        if (!conv) {
          // Conversation creation failed (401/403/network) — roll back all
          // optimistic state and require reauthentication if it was a 401.
          rollbackOptimistic(optimisticConversationId);
          useExecutionStore.getState().endRun("failed");
          setBusy(false);
          if (sendErrorRef.current?.includes("session expired")) {
            setRequiresReauth(true);
            mobileDiag("auth", "conversation_create_reauth_required");
            return { accepted: false, persisted: false, errorKind: "auth" };
          }
          mobileDiag("chat_api", "conversation_create_failed");
          return { accepted: false, persisted: false, errorKind: "network" };
        }
        conversationId = conv.id;
      } else {
        seedOptimisticMessages(conversationId);
      }

      // After this point conversationId is guaranteed non-null (either
      // pre-existing or just created). Capture a narrowed const for closures.
      const activeConversationId = conversationId;
      // Track the run immediately so a Stop pressed before dispatch still
      // reaches the cancel endpoint — the server records it as a pending
      // cancellation that pre-aborts the run when it registers.
      const runInfo: ActiveRun = {
        conversationId: activeConversationId,
        clientRequestId,
        optimisticUserId,
        optimisticAssistantId,
      };
      activeRunRef.current = runInfo;

      // Clear any previous send error
      setSendError(null);

      // 4. Real LLM call through canonical API
      getStore().setStreaming(true);
      let requestController: AbortController | null = null;
      let requestTimeoutId: ReturnType<typeof setTimeout> | null = null;
      // True once the POST has been dispatched — a transport failure after
      // this point can mean the server accepted the run and is still
      // executing, so canonical state must be reconciled before any failure
      // is declared.
      let requestDispatched = false;
      let endRunReason: string | undefined;
      // Streamed content accumulated before any transport loss — preserved
      // through reconciliation so a dead connection doesn't erase it.
      let assistantText = "";
      let reasoningText = "";
      // Set when canonical reconciliation confirms the server is still
      // executing — the composer stays in Stop mode, the run stays
      // tracked, and busy/streaming are NOT released in finally. The
      // fetch lifecycle is not the execution lifecycle.
      let runStillActive = false;
      explicitCancelRef.current = false;

      // Transport loss (or any post-dispatch failure) must not declare a
      // false failure — reconcile the canonical persisted state instead.
      const reconcileAfterTransportLoss = async (opts: {
        preferCancelled?: boolean;
        partialText?: string;
        partialReasoning?: string;
      }): Promise<SendResult> => {
        const { sendResult, state } = await reconcileAndApply(runInfo, opts);
        if (state === "running") runStillActive = true;
        return sendResult;
      };

      try {
        const s = getStore();
        const expectedRevision = s.revision;
        const isAutoBest = selectedModel.id === "auto" || selectedModel.category === "auto";
        // Stall watchdog — abort only after 120s with NO streamed bytes.
        // A real build can legitimately stream for several minutes (the
        // launch flow runs under a 10-minute server-side budget), so a fixed
        // 120s cap killed healthy long builds mid-stream. Resetting on every
        // received chunk preserves the anti-stall protection the original
        // timer was added for.
        const controller = new AbortController();
        requestController = controller;
        requestAbortRef.current = controller;
        const resetStallWatchdog = () => {
          if (requestTimeoutId) clearTimeout(requestTimeoutId);
          requestTimeoutId = setTimeout(() => controller.abort(), 120_000);
        };
        resetStallWatchdog();
        const makeRequest = async (revision: number) => {
          requestDispatched = true;
          return fetch(`/api/studio/conversations/${activeConversationId}/messages`, {
            method: "POST",
            credentials: "include",
            headers: await authHeaders(true),
            body: JSON.stringify({
              message: text,
              clientRequestId,
              expectedRevision: revision,
              requestedAgentSlug: activeAgentId,
              agentMode: activeAgentMode,
              executionMode,
              agentInstanceId: activeAgentInstanceId || undefined,
              provider: isAutoBest ? undefined : selectedModel.apiProvider || selectedModel.provider,
              category: isAutoBest ? "auto" : selectedModel.category,
              model: selectedModel.model,
              images: attachments,
              runtimeContext,
              previewSelection: previewSelectionRef.current ?? undefined,
            }),
            signal: controller.signal,
          });
        };
        let response: Response;
        // Project-switch race: if the user picked another project after
        // this send started but before dispatch, cancel instead of sending
        // into the wrong project's conversation. (After dispatch the run is
        // correctly scoped to its conversation; reconciliation handles the
        // rest, and the server-side run continues safely.)
        if (projectGenerationRef.current !== sendGeneration) {
          rollbackOptimistic(activeConversationId);
          useExecutionStore.getState().endRun("cancelled");
          setBusy(false);
          setSendError("Project switched before your message was sent — it wasn't sent. Send it again if you still want to.");
          return { accepted: false, persisted: false, errorKind: "cancelled" };
        }
        response = await makeRequest(expectedRevision);

        // Error / conflict paths still return JSON.
        if (response.status === 409) {
          // Revision conflict — reload messages from server and retry once with
          // the refreshed revision so the user's message still sends.
          await loadMessages(activeConversationId);
          const s409 = getStore();
          s409.setMessages(
            activeConversationId,
            s409.getMessages().filter((m) => !m.id.startsWith("optimistic_")),
          );
          seedOptimisticMessages(activeConversationId);
          response = await makeRequest(s409.revision);
          if (response.status === 409) {
            await loadMessages(activeConversationId);
            const sFinal409 = getStore();
            sFinal409.setMessages(
              activeConversationId,
              sFinal409.getMessages().filter((m) => !m.id.startsWith("optimistic_")),
            );
            setSendError("Conversation was updated by another session. Your message was not sent — please try again.");
            mobileDiag("chat_api", "revision_conflict_unresolved");
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
            rollbackOptimistic(activeConversationId);
            setRequiresReauth(true);
            setSendError("Your Studio session expired. Refresh the page and sign in again.");
            mobileDiag("auth", "message_send_401_403", { status: response.status });
            return { accepted: false, persisted: false, errorKind: "auth" };
          }
          if (response.status === 429) {
            // Rate limited — show a friendly message with the retry window.
            // The user message was not persisted; roll back optimistic msgs.
            rollbackOptimistic(activeConversationId);
            const retryAfter = response.headers.get("Retry-After");
            const secs = retryAfter ? parseInt(retryAfter, 10) : 60;
            const friendly = secs > 60
              ? `You're sending messages too fast. Try again in ${Math.ceil(secs / 60)} minute${Math.ceil(secs / 60) > 1 ? "s" : ""}.`
              : `You're sending messages too fast. Try again in ${secs} second${secs > 1 ? "s" : ""}.`;
            setSendError(friendly);
            mobileDiag("chat_api", "message_send_rate_limited", { status: 429 });
            return { accepted: false, persisted: false, errorKind: "network" };
          }
          // Non-auth HTTP failure — the user message was not persisted.
          // Roll back optimistic messages and show the error.
          rollbackOptimistic(activeConversationId);
          const errorText = data.detail
            ? `${data.error}: ${data.detail}`
            : data.error || `Request failed (${response.status})`;
          setSendError(errorText);
          mobileDiag("chat_api", "message_send_failed", { status: response.status });
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
            rollbackOptimistic(activeConversationId);
            const errorText = "Server returned an invalid response (not JSON). Check network tab.";
            setSendError(errorText);
            return { accepted: false, persisted: false, errorKind: "network" };
          }
          if (data?.userMessage && data.assistantMessage) {
            const s2 = getStore();
            const userMsg = data.userMessage;
            const assistantMsg = data.assistantMessage;
            s2.updateMessage(activeConversationId, optimisticUserId, {
              id: userMsg.id,
              content: userMsg.content,
              createdAt: userMsg.createdAt,
            });
            if (!assistantMsg.content?.trim()) {
              s2.updateMessage(activeConversationId, optimisticAssistantId, {
                id: assistantMsg.id,
                content: "The response was empty. Please try again.",
                status: "failed",
                createdAt: assistantMsg.createdAt,
              });
              setSendError("The AI returned an empty response. Please try again.");
              return { accepted: false, persisted: true, errorKind: "provider" };
            }
            s2.updateMessage(activeConversationId, optimisticAssistantId, {
              id: assistantMsg.id,
              content: assistantMsg.content,
              status: "completed",
              createdAt: assistantMsg.createdAt,
            });
            s2.setRevision(data.revision ?? expectedRevision + 1);
            if (data.usedFallbackModel) {
              setFallbackNotice(`${selectedModel.label} was unavailable. This response used ${data.usedFallbackModel}.`);
            }
            return {
              accepted: true,
              persisted: true,
              reply: assistantMsg.content,
              awaitingInput: endsWithClarifyingQuestion(assistantMsg.content),
            };
          }
          if (data?.duplicate) {
            const s2 = getStore();
            const userMsg = data.userMessage;
            s2.updateMessage(activeConversationId, optimisticUserId, {
              id: userMsg?.id ?? optimisticUserId,
              content: userMsg?.content ?? text,
              createdAt: userMsg?.createdAt ?? optimisticTimestamp,
            });
            if (data.assistantMessage) {
              const assistantMsg = data.assistantMessage;
              s2.updateMessage(activeConversationId, optimisticAssistantId, {
                id: assistantMsg.id,
                content: assistantMsg.content,
                status: "completed",
                createdAt: assistantMsg.createdAt,
              });
              s2.setRevision(data.revision ?? expectedRevision);
              return {
                accepted: true,
                persisted: true,
                reply: assistantMsg.content,
                awaitingInput: endsWithClarifyingQuestion(assistantMsg.content),
              };
            }
            s2.setMessages(
              activeConversationId,
              s2.getMessages().filter((m) => m.id !== optimisticAssistantId),
            );
            s2.setRevision(data.revision ?? expectedRevision);
            setTimeout(() => void loadMessages(activeConversationId), 2000);
            return { accepted: true, persisted: true };
          }
          const errorText = data?.error
            ? (data.detail ? `${data.error}: ${data.detail}` : data.error)
            : `Server returned an unexpected response format (status ${response.status}, keys: ${Object.keys(data).join(",") || "none"}). Check network tab.`;
          getStore().updateMessage(activeConversationId, optimisticAssistantId, {
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
          getStore().updateMessage(activeConversationId, optimisticAssistantId, {
            status: "failed",
            content: "No response body from server.",
          });
          setSendError("No response body from server.");
          mobileDiag("streaming", "no_response_body");
          return { accepted: false, persisted: false, errorKind: "network" };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let donePayload: Record<string, unknown> | null = null;
        let errorPayload: { message?: string; code?: string; revision?: number; partialText?: string } | null = null;
        let pendingApprovalState: { toolId: string; reason: string; pausedRunId?: string; inputs?: Record<string, unknown> } | null = null;
        const toolActivity: Array<{ toolId: string; success?: boolean; summary: string }> = [];

        const flushUpdate = () => {
          getStore().updateMessage(activeConversationId, optimisticAssistantId, {
            content: assistantText,
            reasoning: reasoningText || undefined,
            status: "streaming",
          });
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // Any received bytes prove the server is still working — reset the
          // stall watchdog so long builds aren't killed mid-stream.
          resetStallWatchdog();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const evt = JSON.parse(payload) as {
                type: string;
                text?: string;
                message?: string;
                code?: string;
                revision?: number;
                partialText?: string;
                detail?: { message?: string; partialText?: string };
                toolId?: string;
                success?: boolean;
                summary?: string;
                reason?: string;
                pausedRunId?: string;
                inputs?: Record<string, unknown>;
                label?: string;
                gitSha?: string;
                check?: string;
                passed?: boolean;
                phase?: string;
                step?: number;
              };
              if (evt.type === "text" && typeof evt.text === "string") {
                assistantText += evt.text;
                flushUpdate();
              } else if (evt.type === "reasoning" && typeof evt.text === "string") {
                reasoningText += evt.text;
                flushUpdate();
              } else if (evt.type === "tool_execution" && evt.toolId) {
                toolActivity.push({
                  toolId: evt.toolId,
                  success: evt.success,
                  summary: evt.summary ?? "",
                });
              } else if (evt.type === "pending_approval" && evt.toolId) {
                pendingApprovalState = {
                  toolId: evt.toolId,
                  reason: evt.reason ?? "Approval required",
                  pausedRunId: evt.pausedRunId,
                  inputs: evt.inputs,
                };
              } else if (evt.type === "checkpoint" && evt.label) {
                toolActivity.push({
                  toolId: "checkpoint",
                  summary: `Checkpoint: ${evt.label} (${evt.gitSha ?? ""})`,
                });
              } else if (evt.type === "build_start" && evt.check) {
                toolActivity.push({ toolId: evt.check, summary: `Running ${evt.check}...` });
              } else if (evt.type === "build_result" && evt.check) {
                toolActivity.push({
                  toolId: evt.check,
                  success: evt.passed,
                  summary: `${evt.check}: ${evt.passed ? "passed" : "failed"}`,
                });
              } else if (evt.type === "done") {
                donePayload = evt as unknown as Record<string, unknown>;
              } else if (evt.type === "error") {
                const src = evt.detail ?? { message: evt.message, partialText: evt.partialText };
                errorPayload = {
                  message: src.message,
                  partialText: src.partialText,
                  code: evt.code,
                  revision: evt.revision,
                };
              }

              // Feed every event into the execution store for the LiTT Live
              // panel — the conversation id is stamped onto any approval
              // gate the event mounts so resume POSTs target the paused
              // run's own conversation even if the selection changes later.
              feedSSEEventToExecutionStore(evt, activeConversationId);
            } catch {
              // ignore malformed chunk
            }
          }
        }

        if (errorPayload) {
          const partial = errorPayload.partialText;
          const reply = errorPayload.code === "EMPTY_PROVIDER_RESPONSE"
            ? "The AI provider returned an empty response. Please try again."
            : sanitizeErrorMessage(errorPayload.message || "Provider unavailable");
          getStore().updateMessage(activeConversationId, optimisticAssistantId, {
            status: "failed",
            content: partial ? partial : reply,
            reasoning: reasoningText || undefined,
          });
          // A failed run still bumped the server-side revision — sync it or
          // the next send posts a stale expectedRevision and gets a 409.
          if (typeof errorPayload.revision === "number") {
            getStore().setRevision(errorPayload.revision);
          }
          setSendError(reply);
          // User message was persisted (server accepted the 200), but the
          // provider failed. Don't restore the draft — show Retry instead.
          return { accepted: false, persisted: true, errorKind: "provider" };
        }

        if (donePayload) {
          const userMsg = donePayload.userMessage as ConversationMessage;
          const assistantMsg = donePayload.assistantMessage as ConversationMessage;
          const s3 = getStore();
          s3.updateMessage(activeConversationId, optimisticUserId, {
            id: userMsg.id,
            content: userMsg.content,
            createdAt: userMsg.createdAt,
          });

          // A cancelled run delivered over a live stream (explicit Stop
          // while still connected) — surface the persisted cancelled state,
          // never the "empty response" failure below.
          if (assistantMsg.status === "cancelled") {
            s3.updateMessage(activeConversationId, optimisticAssistantId, {
              id: assistantMsg.id,
              content: assistantMsg.content || "Cancelled.",
              reasoning: reasoningText || undefined,
              status: "cancelled",
              createdAt: assistantMsg.createdAt,
            });
            s3.setRevision((donePayload.revision as number) ?? expectedRevision + 1);
            setSendError("Stopped.");
            endRunReason = "cancelled";
            return { accepted: false, persisted: true, errorKind: "cancelled" };
          }

          // Guard against empty assistant response
          if (!assistantMsg.content || !assistantMsg.content.trim()) {
            s3.updateMessage(activeConversationId, optimisticAssistantId, {
              id: assistantMsg.id,
              content: "The response was empty. Please try again.",
              status: "failed",
              createdAt: assistantMsg.createdAt,
            });
            // The run failed but the revision was still bumped — keep the
            // client in sync so a retry doesn't hit a 409 stale revision.
            s3.setRevision((donePayload.revision as number) ?? expectedRevision + 1);
            setSendError("The AI returned an empty response. Please try again.");
            // User message persisted, provider returned empty — don't restore draft.
            return { accepted: false, persisted: true, errorKind: "provider" };
          }

          s3.updateMessage(activeConversationId, optimisticAssistantId, {
            id: assistantMsg.id,
            content: assistantMsg.content,
            reasoning: reasoningText || undefined,
            status: assistantMsg.status === "failed"
              ? "failed"
              : pendingApprovalState ? "awaiting_approval" : "completed",
            createdAt: assistantMsg.createdAt,
            agentSlug: assistantMsg.agentSlug ?? activeAgentId as AgentSlug,
            agentMode: assistantMsg.agentMode ?? activeAgentMode,
            pendingApproval: pendingApprovalState ?? undefined,
            toolActivity: toolActivity.length > 0 ? toolActivity : undefined,
            execution: (assistantMsg as { execution?: MessageExecution }).execution ?? null,
          });

          s3.setRevision((donePayload.revision as number) ?? expectedRevision + 1);

          // A run the server persisted as failed is NOT an accepted send —
          // even when it produced truthful failure text. Returning
          // accepted:false keeps the composer out of the "Done" completion
          // state and surfaces the failure for retry.
          if (assistantMsg.status === "failed") {
            setSendError(assistantMsg.content);
            return { accepted: false, persisted: true, errorKind: "provider" };
          }

          if (donePayload.usedFallbackModel) {
            setFallbackNotice(`${selectedModel.label} was unavailable. This response used ${donePayload.usedFallbackModel}.`);
          }

          if (pendingApprovalState) {
            return { accepted: true, persisted: true, reply: assistantMsg.content, pendingApproval: pendingApprovalState };
          }

          return {
            accepted: true,
            persisted: true,
            reply: assistantMsg.content,
            awaitingInput: endsWithClarifyingQuestion(assistantMsg.content),
          };
        }

        // Stream ended without an explicit done/error event. The transport
        // may have died while the server keeps executing — reconcile the
        // canonical persisted state instead of guessing an outcome.
        mobileDiag("streaming", "ended_without_done_event");
        return await reconcileAfterTransportLoss({
          partialText: assistantText,
          partialReasoning: reasoningText,
        });
      } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        if (isAbort && explicitCancelRef.current) {
          // Explicit Stop — the cancel endpoint was already notified; show
          // the persisted cancelled state rather than a network error.
          endRunReason = "cancelled";
          return await reconcileAfterTransportLoss({ preferCancelled: true });
        }
        // Remove the empty streaming bubble on failure — it should not
        // remain permanently as an empty or error-filled bubble.
        const s = getStore();
        if (isAbort && !requestDispatched) {
          // Abort before the request was even dispatched — nothing could
          // have been persisted server-side.
          s.setMessages(
            activeConversationId,
            s.getMessages().filter((m) => m.id !== optimisticAssistantId),
          );
          setSendError("The request timed out. Please try again.");
          mobileDiag("streaming", "aborted_timeout");
          return { accepted: false, persisted: true, errorKind: "network" };
        }
        // Transport failed after the request was dispatched — the server may
        // have accepted the run and still be executing it (transport loss
        // does not cancel execution). Reconcile canonical state instead of
        // declaring a false failure.
        mobileDiag("streaming", "transport_lost", { errorName: error instanceof Error ? error.name : typeof error });
        return await reconcileAfterTransportLoss({
          partialText: assistantText,
          partialReasoning: reasoningText,
        });
      } finally {
        if (requestTimeoutId) clearTimeout(requestTimeoutId);
        if (requestController && requestAbortRef.current === requestController) requestAbortRef.current = null;
        if (!runStillActive) {
          // Terminal outcome (or the run never reached the server) — the
          // active-run identity is released so Stop no longer targets it.
          if (activeRunRef.current?.clientRequestId === clientRequestId) {
            activeRunRef.current = null;
          }
          getStore().setStreaming(false);
          setBusy(false);
          useExecutionStore.getState().endRun(endRunReason);
        }
        // runStillActive: canonical state confirmed the server is still
        // executing. busy/streaming/run-identity stay set so the composer
        // keeps offering Stop and the UI keeps claiming "working".
      }
    },
    [busy, getStore, createConversation, loadMessages, onRouteToolAction, onRouteInspectorAction, onRunHealthChecks, onOpenProjectNameDialog, onOpenImageStudio, onOpenVideoStudio, selectedModel, activeAgentId, activeAgentMode, activeAgentInstanceId, executionMode, setFallbackNotice, authHeaders, isLoaded, requiresReauth, runtimeContext, setSendError, reconcileAndApply],
  );

  // Regenerate — calls canonical regenerate API
  const regenerate = useCallback(async (assistantMessageId?: string) => {
    const s = getStore();
    const conversationId = s.selectedConversationId;
    if (!conversationId || busy) return;

    const allMessages = s.getMessages();
    // Retry targets the exact failed turn the user pressed Retry on. The
    // hover "Regenerate" (no id) keeps re-answering the last completed
    // assistant message.
    const target = assistantMessageId
      ? allMessages.find((m) => m.id === assistantMessageId && m.role === "assistant")
      : allMessages.findLast((m) => m.role === "assistant" && m.status === "completed");
    if (!target?.id) return;

    // A failed turn means the work never completed — re-send the parent user
    // message through the normal send pipeline so the turn is genuinely
    // re-run (see findRetryResendText). Falls back to the regenerate API
    // when there is no parent message to re-send.
    const resendText = findRetryResendText(target, allMessages);
    if (resendText) {
      await send(resendText);
      return;
    }

    setBusy(true);
    getStore().setStreaming(true);
    // Bounded and cancellable: the 120s timeout matches the send() stall
    // watchdog, and Stop aborts the request via the shared requestAbortRef.
    const regenController = new AbortController();
    const timeoutId = setTimeout(() => regenController.abort(), 120000);
    requestAbortRef.current = regenController;
    try {
      const response = await fetch(`/api/studio/conversations/${conversationId}/regenerate`, {
        method: "POST",
        credentials: "include",
        headers: await authHeaders(true),
        body: JSON.stringify({
          assistantMessageId: target.id,
          clientRequestId: generateClientRequestId(),
          expectedRevision: s.revision,
          runtimeContext,
        }),
        signal: regenController.signal,
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
      if (error instanceof DOMException && error.name === "AbortError") {
        setSendError("Regeneration stopped.");
      } else {
        setSendError(error instanceof Error ? error.message : "Regeneration failed. Please try again.");
      }
    } finally {
      clearTimeout(timeoutId);
      if (requestAbortRef.current === regenController) requestAbortRef.current = null;
      getStore().setStreaming(false);
      useExecutionStore.getState().endRun();
      setBusy(false);
    }
  }, [busy, getStore, loadMessages, authHeaders, runtimeContext, setSendError, send]);

  // Explicit Stop. Ordering:
  //   1. POST the authenticated server-side cancellation FIRST — transport
  //      abort alone no longer stops execution.
  //   2. THEN detach the local reader. If a send() is in flight its abort
  //      catch reconciles the canonical state.
  //   3. If the reader already died (post-disconnect Stop), no send() is in
  //      flight — reconcile here so the transcript reaches the canonical
  //      cancelled/failed/completed state.
  // "Cancelled" is only ever displayed after canonical state confirms it;
  // while the server still reports the run active the UI shows "Stopping…".
  const cancel = useCallback(() => {
    const run = activeRunRef.current;
    explicitCancelRef.current = true;
    if (!run) {
      // No tracked server-side run — just release the local reader if one
      // is somehow still open.
      requestAbortRef.current?.abort();
      return;
    }
    void (async () => {
      try {
        await fetch(`/api/studio/conversations/${run.conversationId}/cancel`, {
          method: "POST",
          credentials: "include",
          headers: await authHeaders(true),
          body: JSON.stringify({ clientRequestId: run.clientRequestId }),
        });
      } catch {
        // Best-effort — reconciliation below surfaces the canonical state.
      }
      const hadLiveRequest = requestAbortRef.current != null;
      requestAbortRef.current?.abort();
      if (!hadLiveRequest) {
        const { state } = await reconcileAndApply(run, { preferCancelled: true });
        if (state !== "running") {
          if (activeRunRef.current?.clientRequestId === run.clientRequestId) {
            activeRunRef.current = null;
          }
          getStore().setStreaming(false);
          setBusy(false);
          useExecutionStore.getState().endRun(state === "cancelled" ? "cancelled" : undefined);
        }
        // "running": the server hasn't confirmed the stop yet — keep the
        // run tracked and the composer in Stop mode ("Stopping…").
      }
    })();
  }, [authHeaders, getStore, reconcileAndApply]);

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
    reportSendError: setSendError,
    clearSendError: () => setSendError(null),
    requiresReauth,
    clearRequiresReauth: () => setRequiresReauth(false),
    loadMessages,
  };
}

function sanitizeErrorMessage(raw: string): string {
  if (/empty responses?|EMPTY_PROVIDER_RESPONSE/i.test(raw)) {
    return "The AI provider returned an empty response. Please try again.";
  }
  if (/All LLM .*(failed|providers)/i.test(raw)) {
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
  if (/GEMINI_API_KEY not set/i.test(raw)) {
    return "Gemini is not configured. Try Auto Best or choose another model.";
  }
  if (/quota|rate limit|429/i.test(raw)) {
    return "The AI provider is rate-limited. Please wait a moment and try again.";
  }
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(raw)) {
    return "The AI provider rejected the API key. Check that the key is valid in Vercel env vars.";
  }
  return raw;
}

export type StudioConversation = ReturnType<typeof useCanonicalConversation>;
export type { AgentId };
