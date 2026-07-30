"use client";

import ChatShell from "../components/ChatShell";
import type { StudioTool } from "../components/StudioSidebar";
import { useConnectionSummary } from "../hooks/useConnectionSummary";
import { useStudioModelStore } from "../stores/useStudioModelStore";
import { useCanonicalConversation } from "../hooks/useCanonicalConversation";

export default function ChatTool({
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
  const { capabilities } = useConnectionSummary();
  const selectedModel = useStudioModelStore((s) => s.selectedModel);

  const conversation = useCanonicalConversation({
    onRouteTool,
    serverProjectId: capabilities.projectId,
  });

  const send = async (value: string, attachments?: string[]): Promise<string> => {
    const result = await conversation.send(value, attachments);
    return result.reply ?? "";
  };

  return (
    <ChatShell
      selectedModel={selectedModel.label}
      messages={conversation.messages}
      busy={conversation.busy}
      onSend={send}
      onNewChat={conversation.clear}
      activeAgentId={conversation.activeAgentId}
      onRegenerate={conversation.regenerate}
      onRouteTool={onRouteTool}
      onToggleCamera={onToggleCamera}
      cameraActive={cameraActive}
      requestedTool={requestedTool}
      pendingCommand={pendingCommand}
      initialPrompt={conversation.initialPrompt}
      fallbackNotice={conversation.fallbackNotice}
      capabilities={capabilities}
      sendError={conversation.sendError}
      onClearSendError={conversation.clearSendError}
    />
  );
}
