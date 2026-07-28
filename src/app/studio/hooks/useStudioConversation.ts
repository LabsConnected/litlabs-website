"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useProfile } from "@/context/ProfileContext";
import { useStudioConversations } from "./useStudioConversations";
import { parseBuilderLocalCommand } from "../lib/builder-command-router";
import { detectIntent, type IntentResult } from "../lib/studio-intent";
import { useConnectionSummary } from "./useConnectionSummary";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import { AGENT_META, type AgentId } from "../stores/useStudioAgentStore";
import { useStudioModelStore } from "../stores/useStudioModelStore";
import type { StudioTool } from "../components/StudioSidebar";
import type { StudioMessage } from "../types/conversation";

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
 * Command Studio.
 *
 * Phase 2.1 — now uses the unified useStudioConversations hook as
 * the single source of truth for conversations, messages, agent
 * selection, and project context. No more split between
 * useBuilderSessions (sessions) and useStudioAgentStore (threads).
 *
 * One controller, one transcript, one composer, one conversation model.
 */
export function useStudioConversation({
  onRouteTool,
}: {
  onRouteTool?: (tool: StudioTool, command?: string) => void;
} = {}) {
  const [busy, setBusy] = useState(false);
  const conversations = useStudioConversations();
  const { capabilities } = useConnectionSummary();
  const { voiceTransportConnected, voiceInputState } = useVoiceSession();

  const selectedModel = useStudioModelStore((s) => s.selectedModel);
  const fallbackNotice = useStudioModelStore((s) => s.fallbackNotice);
  const setFallbackNotice = useStudioModelStore((s) => s.setFallbackNotice);

  const { profile } = useProfile();
  const searchParams = useSearchParams();
  const initialPrompt = searchParams.get("mission") || "";

  const messages = conversations.messages;
  const activeAgentId = conversations.selectedAgentId;
  const setMessages = conversations.setMessages;

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
            conversations.create();
            return { accepted: true };
          case "terminal":
            onRouteTool?.("terminal");
            return { accepted: true };
          case "sessions":
            return { accepted: true };
          case "delete":
            if (conversations.activeConversation && window.confirm(`Delete "${conversations.activeConversation.title}"?`)) {
              conversations.remove(conversations.activeConversation.id);
            }
            return { accepted: true };
          case "rename":
            if (localCommand.title && conversations.activeConversation) {
              conversations.rename(conversations.activeConversation.id, localCommand.title);
            } else {
              setMessages((current) => [
                ...current,
                { id: crypto.randomUUID(), role: "assistant", content: "Usage: `/rename New session name`", status: "complete" as const, createdAt: Date.now() },
              ]);
            }
            return { accepted: true };
          case "help":
            setMessages((current) => [
              ...current,
              { id: crypto.randomUUID(), role: "assistant", content: "**Builder commands**\n\n`/new` new session · `/clear` reset this session · `/terminal` open terminal · `/sessions` manage chats · `/rename name` rename · `/delete` delete current session · `/help` show commands", status: "complete" as const, createdAt: Date.now() },
            ]);
            return { accepted: true };
          default:
            setMessages((current) => [
              ...current,
              { id: crypto.randomUUID(), role: "assistant", content: `Unknown local command: \`/${localCommand.command}\`. Type \`/help\`.`, status: "complete" as const, createdAt: Date.now() },
            ]);
            return { accepted: true };
        }
      }

      // 2. Deterministic product intents before any LLM call
      const intent = detectIntent(text);
      if (intent && intent.intent !== "generate_code" && intent.intent !== "chat" && intent.intent !== "unknown") {
        const intentMessage = buildIntentResponseMessage(intent);
        const now = Date.now();
        setMessages((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "user", content: text, status: "complete" as const, createdAt: now },
          { id: crypto.randomUUID(), role: "assistant", content: intentMessage, agentId: activeAgentId, status: "complete" as const, createdAt: now },
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
      const now = Date.now();
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content: text || "(image)", status: "complete" as const, createdAt: now },
      ]);
      if (conversations.activeConversation?.title === "New chat") {
        conversations.rename(conversations.activeConversation.id, text.slice(0, 56) || "Image request");
      }
      setBusy(true);
      try {
        const isAutoBest = selectedModel.id === "auto" || selectedModel.category === "auto";
        const response = await fetch("/api/gemini/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentSlug: activeAgentId,
            // Phase 2.3: systemPrompt is NO LONGER sent from the client.
            // The server resolves the agent's system prompt from a
            // server-owned registry. The client only sends the agent ID.
            provider: isAutoBest ? undefined : selectedModel.apiProvider || selectedModel.provider,
            category: isAutoBest ? "auto" : selectedModel.category,
            model: selectedModel.model,
            message: text || "Describe what you see.",
            history: historyForApi,
            stream: false,
            userName: profile.displayName || "Member",
            images: attachments,
            activeCanvasId: typeof localStorage !== "undefined" ? localStorage.getItem("litt:canvas:active-id") : null,
            // Phase 2.4: complete project context
            projectId: conversations.activeConversation?.project.projectId,
            repositoryName: conversations.activeConversation?.project.repositoryName,
            branch: conversations.activeConversation?.project.branch,
            capabilities: {
              repository: capabilities.repository,
              repositoryName: capabilities.repositoryName,
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
          throw new Error(err.detail || err.error || `${AGENT_META[activeAgentId as "litt" | "spark"]?.displayName ?? "Agent"} is reconnecting`);
        }
        const data = await response.json();
        const reply =
          data.response || data.text || data.message || data.content ||
          "I'm ready. Tell me what we're building.";
        if (data.usedFallbackModel) {
          setFallbackNotice(`${selectedModel.label} was unavailable. This response used ${data.usedFallbackModel}.`);
        }
        // The server returns the resolved agent ID — use it if present
        const resolvedAgentId = data.agentId || activeAgentId;
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: reply,
            agentId: resolvedAgentId,
            status: "complete" as const,
            createdAt: Date.now(),
            actions: Array.isArray(data.actions) ? data.actions : undefined,
          },
        ]);
        return { accepted: true, reply };
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : `${AGENT_META[activeAgentId as "litt" | "spark"]?.displayName ?? "Agent"} is reconnecting`;
        const reply = sanitizeErrorMessage(rawMessage);
        setMessages((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "assistant", content: reply, agentId: activeAgentId, status: "failed" as const, createdAt: Date.now() },
        ]);
        return { accepted: true, reply };
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, setMessages, conversations, onRouteTool, selectedModel, activeAgentId, profile, capabilities, voiceTransportConnected, voiceInputState, setFallbackNotice],
  );

  const regenerate = useCallback(() => {
    const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIndex === -1) return;
    const trimmed = messages.slice(0, lastUserIndex + 1);
    setMessages(trimmed);
    void send(trimmed[lastUserIndex].content);
  }, [messages, setMessages, send]);

  const clear = useCallback(() => setMessages([]), [setMessages]);

  return {
    messages,
    busy,
    send,
    regenerate,
    clear,
    activeAgentId,
    fallbackNotice,
    initialPrompt,
    // Unified conversation API
    conversations: conversations.conversations,
    activeConversation: conversations.activeConversation,
    activeSessionId: conversations.activeId,
    selectSession: conversations.setActiveId,
    newSession: () => conversations.create(),
    renameSession: conversations.rename,
    deleteSession: conversations.remove,
    deleteAllSessions: conversations.removeAll,
    setSelectedAgent: conversations.setSelectedAgent,
    updateProject: conversations.updateProject,
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

export type StudioConversationController = ReturnType<typeof useStudioConversation>;
export type { AgentId, StudioMessage };
