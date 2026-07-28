"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useProfile } from "@/context/ProfileContext";
import { useBuilderSessions } from "./useBuilderSessions";
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

/**
 * Structured result from the conversation `send` function.
 *
 * - `accepted: false` — the request was rejected (busy, empty, or
 *   invalid). The composer should restore the user's text/attachments.
 * - `accepted: true` — the request was accepted. The controller has
 *   taken ownership of the message. `reply` is present when an
 *   assistant response was produced (either from the LLM or from a
 *   deterministic intent). Local commands like `/clear` return
 *   `accepted: true` with no `reply`.
 */
export interface SendResult {
  accepted: boolean;
  reply?: string;
}

/**
 * useStudioConversation — the single conversation controller for the
 * Command Studio. Extracted from ChatTool so the new CommandComposer
 * can call the real /api/gemini/chat path directly, without mounting
 * an invisible ChatTool + ChatShell + MultimodalComposer underneath.
 *
 * One controller, one transcript, one composer. No duplicate chat UI.
 */
export function useStudioConversation({
  onRouteTool,
}: {
  onRouteTool?: (tool: StudioTool, command?: string) => void;
} = {}) {
  const [busy, setBusy] = useState(false);
  const sessionManager = useBuilderSessions();
  const { capabilities } = useConnectionSummary();
  const { voiceTransportConnected, voiceInputState } = useVoiceSession();

  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const threads = useStudioAgentStore((s) => s.threads);
  const storeSetMessages = useStudioAgentStore((s) => s.setMessages);
  const clearThread = useStudioAgentStore((s) => s.clearThread);

  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const fallbackNotice = useStudioModelStore((s) => s.fallbackNotice);
  const setFallbackNotice = useStudioModelStore((s) => s.setFallbackNotice);

  const messages = useMemo(
    () => threads[activeAgentId] ?? [],
    [threads, activeAgentId],
  );
  const setMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) =>
      storeSetMessages(activeAgentId, updater),
    [storeSetMessages, activeAgentId],
  );

  const { profile } = useProfile();
  const searchParams = useSearchParams();
  const initialPrompt = searchParams.get("mission") || "";

  const send = useCallback(
    async (value: string, attachments?: string[]): Promise<SendResult> => {
      const text = value.trim();
      if ((!text && !attachments?.length) || busy) return { accepted: false };

      // 1. Slash commands — accepted local commands, no reply
      const localCommand = parseBuilderLocalCommand(text);
      if (localCommand) {
        switch (localCommand.type) {
          case "clear":
            setMessages([]);
            return { accepted: true };
          case "new":
            sessionManager.create();
            return { accepted: true };
          case "terminal":
            onRouteTool?.("terminal");
            return { accepted: true };
          case "sessions":
            return { accepted: true };
          case "delete":
            if (sessionManager.activeSession && window.confirm(`Delete "${sessionManager.activeSession.title}"?`)) sessionManager.remove(sessionManager.activeSession.id);
            return { accepted: true };
          case "rename":
            if (localCommand.title && sessionManager.activeSession) sessionManager.rename(sessionManager.activeSession.id, localCommand.title);
            else setMessages((current) => [...current, { role: "assistant", content: "Usage: `/rename New session name`", createdAt: Date.now() }]);
            return { accepted: true };
          case "help":
            setMessages((current) => [...current, { role: "assistant", content: "**Builder commands**\n\n`/new` new session · `/clear` reset this session · `/terminal` open terminal · `/sessions` manage chats · `/rename name` rename · `/delete` delete current session · `/help` show commands", createdAt: Date.now() }]);
            return { accepted: true };
          default:
            setMessages((current) => [...current, { role: "assistant", content: `Unknown local command: \`/${localCommand.command}\`. Type \`/help\`.`, createdAt: Date.now() }]);
            return { accepted: true };
        }
      }

      // 2. Deterministic product intents before any LLM call
      const intent = detectIntent(text);
      if (intent && intent.intent !== "generate_code" && intent.intent !== "chat" && intent.intent !== "unknown") {
        const intentMessage = buildIntentResponseMessage(intent);
        setMessages((current) => [
          ...current,
          { role: "user", content: text, createdAt: Date.now() },
          { role: "assistant", content: intentMessage, createdAt: Date.now() },
        ]);
        if (intent.tool) onRouteTool?.(intent.tool);
        if (intent.intent === "connect_github" && typeof window !== "undefined") {
          window.location.href = "/api/github/install";
        }
        return { accepted: true, reply: intentMessage };
      }

      // 3. Real LLM call
      const historyForApi = [
        ...messages,
        { role: "user" as const, content: text || "(image)" },
      ];
      setMessages((current) => [
        ...current,
        { role: "user" as const, content: text || "(image)", createdAt: Date.now() },
      ]);
      if (sessionManager.activeSession?.title === "New chat") sessionManager.rename(sessionManager.activeSession.id, text.slice(0, 56) || "Image request");
      setBusy(true);
      try {
        const isAutoBest = selectedModel.id === "auto" || selectedModel.category === "auto";
        const response = await fetch("/api/gemini/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentSlug: activeAgentId,
            systemPrompt: AGENT_META[activeAgentId].systemPrompt,
            provider: isAutoBest ? undefined : selectedModel.apiProvider || selectedModel.provider,
            category: isAutoBest ? "auto" : selectedModel.category,
            model: selectedModel.model,
            message: text || "Describe what you see.",
            history: historyForApi,
            stream: false,
            userName: profile.displayName || "Member",
            images: attachments,
            activeCanvasId: typeof localStorage !== "undefined" ? localStorage.getItem("litt:canvas:active-id") : null,
            capabilities: {
              repository: capabilities.repository,
              repositoryIndexed: capabilities.repositoryIndexed,
              terminalExecution: capabilities.terminalExecution,
              writeAccess: capabilities.writeAccess,
              connectedProviders: capabilities.connectedProviders,
              availableTools: capabilities.availableTools,
              connectionSummary: capabilities.connectionSummary,
              voiceTransportConnected,
              voiceMicrophoneOn: voiceInputState === "listening",
              voiceHealth: capabilities.voiceHealth,
            },
          }),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.detail || err.error || `${AGENT_META[activeAgentId].displayName} is reconnecting`);
        }
        const data = await response.json();
        const reply =
          data.response || data.text || data.message || data.content ||
          "I'm ready. Tell me what we're building.";
        if (data.usedFallbackModel) {
          setFallbackNotice(`${selectedModel.label} was unavailable. This response used ${data.usedFallbackModel}.`);
        }
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: reply,
            createdAt: Date.now(),
            actions: Array.isArray(data.actions) ? data.actions : undefined,
          },
        ]);
        return { accepted: true, reply };
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : `${AGENT_META[activeAgentId].displayName} is reconnecting`;
        const reply = sanitizeErrorMessage(rawMessage);
        setMessages((current) => [
          ...current,
          { role: "assistant", content: reply, createdAt: Date.now() },
        ]);
        return { accepted: true, reply };
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, setMessages, sessionManager, onRouteTool, selectedModel, activeAgentId, profile, capabilities, voiceTransportConnected, voiceInputState, setFallbackNotice],
  );

  const regenerate = useCallback(() => {
    const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIndex === -1) return;
    const trimmed = messages.slice(0, lastUserIndex + 1);
    setMessages(trimmed);
    void send(trimmed[lastUserIndex].content);
  }, [messages, setMessages, send]);

  const clear = useCallback(() => clearThread(activeAgentId), [clearThread, activeAgentId]);

  return {
    messages,
    busy,
    send,
    regenerate,
    clear,
    activeAgentId,
    fallbackNotice,
    initialPrompt,
    sessions: sessionManager.sessions,
    activeSessionId: sessionManager.activeId,
    selectSession: sessionManager.setActiveId,
    newSession: () => sessionManager.create(),
    renameSession: sessionManager.rename,
    deleteSession: sessionManager.remove,
    deleteAllSessions: sessionManager.removeAll,
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

export type StudioConversation = ReturnType<typeof useStudioConversation>;
export type { AgentId };
