"use client";

import { useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useProfile } from "@/context/ProfileContext";
import ChatShell from "../components/ChatShell";
import type { StudioTool } from "../components/StudioSidebar";
import { useBuilderSessions } from "../hooks/useBuilderSessions";
import { parseBuilderLocalCommand } from "../lib/builder-command-router";
import { detectIntent, type IntentResult } from "../lib/studio-intent";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import {
  useStudioAgentStore,
  AGENT_META,
  type ChatMessage,
} from "../stores/useStudioAgentStore";
import { useStudioModelStore } from "../stores/useStudioModelStore";

export default function ChatTool({
  selectedModel: _selectedModel = "auto",
  onRouteTool,
  onToggleCamera,
  cameraActive = false,
  requestedTool = "chat",
  pendingCommand = "",
}: {
  selectedModel?: string;
  onRouteTool?: (tool: StudioTool, command?: string) => void;
  onToggleCamera?: () => void;
  cameraActive?: boolean;
  requestedTool?: StudioTool;
  pendingCommand?: string;
}) {
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

  const send = async (
    value: string,
    attachments?: string[],
  ): Promise<string> => {
    const text = value.trim();
    if ((!text && !attachments?.length) || busy) return "";
    // 1. Check slash commands first
    const localCommand = parseBuilderLocalCommand(text);
    if (localCommand) {
      switch (localCommand.type) {
        case "clear":
          setMessages([]);
          return "";
        case "new":
          sessionManager.create();
          return "";
        case "terminal":
          onRouteTool?.("terminal");
          return "";
        case "sessions":
          return "";
        case "delete":
          if (sessionManager.activeSession && window.confirm(`Delete “${sessionManager.activeSession.title}”?`)) sessionManager.remove(sessionManager.activeSession.id);
          return "";
        case "rename":
          if (localCommand.title && sessionManager.activeSession) sessionManager.rename(sessionManager.activeSession.id, localCommand.title);
          else setMessages((current) => [...current, { role: "assistant", content: "Usage: `/rename New session name`", createdAt: Date.now() }]);
          return "";
        case "help":
          setMessages((current) => [...current, { role: "assistant", content: "**Builder commands**\n\n`/new` new session · `/clear` reset this session · `/terminal` open terminal · `/sessions` manage chats · `/rename name` rename · `/delete` delete current session · `/help` show commands", createdAt: Date.now() }]);
          return "";
        default:
          setMessages((current) => [...current, { role: "assistant", content: `Unknown local command: \`/${localCommand.command}\`. Type \`/help\`.`, createdAt: Date.now() }]);
          return "";
      }
    }
    // 2. Check deterministic product intents before calling any LLM
    const intent = detectIntent(text);
    if (intent && intent.intent !== "generate_code" && intent.intent !== "chat" && intent.intent !== "unknown") {
      const intentMessage = buildIntentResponseMessage(intent);
      setMessages((current) => [
        ...current,
        { role: "user", content: text, createdAt: Date.now() },
        { role: "assistant", content: intentMessage, createdAt: Date.now() },
      ]);
      if (intent.tool) {
        onRouteTool?.(intent.tool);
      }
      if (intent.intent === "connect_github" && typeof window !== "undefined") {
        window.location.href = "/api/github/install";
      }
      return intentMessage;
    }

    const historyForApi = [
      ...messages,
      { role: "user" as const, content: text || "(image)" },
    ];
    setMessages((current) => [
      ...current,
      {
        role: "user" as const,
        content: text || "(image)",
        createdAt: Date.now(),
      },
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
          // For Auto Best, send category so the server uses the full fallback chain
          // For specific model selections, send provider to pin that model
          provider: isAutoBest ? undefined : selectedModel.apiProvider || selectedModel.provider,
          category: isAutoBest ? "auto" : selectedModel.category,
          model: selectedModel.model,
          message: text || "Describe what you see.",
          history: historyForApi,
          stream: false,
          userName: profile.displayName || "Member",
          images: attachments,
          // Pass the active canvas id so the server can detect
          // append/update intents (not just create intents).
          activeCanvasId: typeof localStorage !== "undefined"
            ? localStorage.getItem("litt:canvas:active-id")
            : null,
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
          projectId: typeof localStorage !== "undefined"
            ? localStorage.getItem("litt:active-project-id")
            : null,
          repositoryName: capabilities.repositoryName,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `${AGENT_META[activeAgentId].displayName} is reconnecting`);
      }
      const data = await response.json();
      const reply =
        data.response ||
        data.text ||
        data.message ||
        data.content ||
        "I’m ready. Tell me what we’re building.";
      if (data.usedFallbackModel) {
        setFallbackNotice(`${selectedModel.label} was unavailable. This response used ${data.usedFallbackModel}.`);
      }
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: reply,
          createdAt: Date.now(),
          // Carry canvas actions proposed by the server so the UI
          // can render them as chips (Phase 2).
          actions: Array.isArray(data.actions) ? data.actions : undefined,
        },
      ]);
      return reply;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : `${AGENT_META[activeAgentId].displayName} is reconnecting`;
      const reply = sanitizeErrorMessage(rawMessage);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: reply, createdAt: Date.now() },
      ]);
      return reply;
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = () => {
    const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIndex === -1) return;
    const trimmed = messages.slice(0, lastUserIndex + 1);
    setMessages(trimmed);
    void send(trimmed[lastUserIndex].content);
  };

  return (
    <ChatShell
      selectedModel={selectedModel.label}
      messages={messages}
      busy={busy}
      onSend={send}
      onNewChat={() => clearThread(activeAgentId)}
      activeAgentId={activeAgentId}
      onRegenerate={handleRegenerate}
      onRouteTool={onRouteTool}
      onToggleCamera={onToggleCamera}
      cameraActive={cameraActive}
      requestedTool={requestedTool}
      pendingCommand={pendingCommand}
      initialPrompt={initialPrompt}
      fallbackNotice={fallbackNotice}
      sessions={sessionManager.sessions}
      activeSessionId={sessionManager.activeId}
      onSelectSession={sessionManager.setActiveId}
      onNewSession={() => sessionManager.create()}
      onRenameSession={sessionManager.rename}
      onPinSession={sessionManager.togglePin}
      onDuplicateSession={(session) => sessionManager.create(session)}
      onDeleteSession={sessionManager.remove}
      onDeleteAllSessions={sessionManager.removeAll}
      capabilities={capabilities}
    />
  );
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
