"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useProfile } from "@/context/ProfileContext";
import ChatShell from "../components/ChatShell";
import type { StudioTool } from "../components/StudioSidebar";
import { getChatModel } from "@/lib/studio-models";
import { useBuilderSessions } from "../hooks/useBuilderSessions";
import { parseBuilderLocalCommand } from "../lib/builder-command-router";

export default function ChatTool({
  selectedModel = "adaptive",
  onRouteTool,
  requestedTool = "chat",
  pendingCommand = "",
}: {
  selectedModel?: string;
  onRouteTool?: (tool: StudioTool, command?: string) => void;
  requestedTool?: StudioTool;
  pendingCommand?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [shellAction, setShellAction] = useState<{ id: number; type: "terminal" | "sessions" } | null>(null);
  const sessionManager = useBuilderSessions();
  const messages = sessionManager.activeSession?.messages ?? [];
  const setMessages = sessionManager.setMessages;
  const { profile } = useProfile();
  const searchParams = useSearchParams();
  const requestedAgent = "litt";
  const initialPrompt = searchParams.get("mission") || "";

  const send = async (
    value: string,
    attachments?: string[],
  ): Promise<string> => {
    const text = value.trim();
    if ((!text && !attachments?.length) || busy) return "";
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
          setShellAction({ id: Date.now(), type: "terminal" });
          return "";
        case "sessions":
          setShellAction({ id: Date.now(), type: "sessions" });
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
    const modelConfig = getChatModel(selectedModel);
    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: requestedAgent,
          provider: modelConfig.apiProvider ?? modelConfig.provider,
          model: modelConfig.apiModel,
          message: text || "Describe what you see.",
          history: historyForApi,
          stream: false,
          userName: profile.displayName || "Member",
          images: attachments,
          capabilities: {
            repository: sessionManager.activeSession?.context.repositoryState ?? "none",
            repositoryIndexed: false,
            terminalExecution: "unavailable",
            writeAccess: false,
          },
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || err.error || "LiTT is reconnecting");
      }
      const data = await response.json();
      const reply =
        data.response ||
        data.text ||
        data.message ||
        data.content ||
        "I’m ready. Tell me what we’re building.";
      setMessages((current) => [
        ...current,
        { role: "assistant", content: reply, createdAt: Date.now() },
      ]);
      return reply;
    } catch (error) {
      const reply =
        error instanceof Error ? error.message : "LiTT is reconnecting";
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
      selectedModel={selectedModel}
      messages={messages}
      busy={busy}
      onSend={send}
      onNewChat={() => setMessages([])}
      onRegenerate={handleRegenerate}
      onRouteTool={onRouteTool}
      requestedTool={requestedTool}
      pendingCommand={pendingCommand}
      initialPrompt={initialPrompt}
      sessions={sessionManager.sessions}
      activeSessionId={sessionManager.activeId}
      onSelectSession={sessionManager.setActiveId}
      onNewSession={() => sessionManager.create()}
      onRenameSession={sessionManager.rename}
      onPinSession={sessionManager.togglePin}
      onDuplicateSession={(session) => sessionManager.create(session)}
      onDeleteSession={sessionManager.remove}
      onDeleteAllSessions={sessionManager.removeAll}
      shellAction={shellAction}
    />
  );
}
