"use client";

/**
 * TaskChatPanel — chat surface bound to a durable server StudioTask.
 *
 * Every chat window is one of these. The window's taskId resolves to a
 * canonical conversationId (server task → conversationId, or the window's
 * own viewState for freshly-provisioned conversations); the transcript
 * reads that conversation's messages from the canonical store — never the
 * "currently selected" global — so multiple chat windows show genuinely
 * independent threads.
 *
 * The single live runtime follows focus: the caller selects this window's
 * conversation before any send, so a message can never leak into another
 * task's thread. Draft text persists in the window's viewState.
 */

import { useCallback, useMemo, useState } from "react";
import { useConversationStore, EMPTY_CONVERSATION_MESSAGES } from "../stores/useConversationStore";
import { useStudioWindowStore } from "../stores/useStudioWindowStore";
import type { StudioWindow } from "../types/studio-windows";
import type { AgentId } from "../stores/useStudioAgentStore";
import type { SendResult } from "../hooks/useCanonicalConversation";
import { toUIMessage } from "../hooks/useCanonicalConversation";
import type { ComposerContextLine } from "./CommandComposer";
import type { StudioTool } from "../lib/studio-destinations";
import StudioTranscript from "./StudioTranscript";
import CommandComposer from "./CommandComposer";
import { ActionRunStatusPanel } from "./ActionRunStatusPanel";
import { ChatBrowserLiveView } from "./ChatBrowserLiveView";

export default function TaskChatPanel({
  win,
  conversationId,
  send,
  cancel,
  busy,
  disabled,
  activeAgentId,
  executionMode,
  onExecutionModeChange,
  executionHint,
  contextLine,
  onRouteToolAction,
  onRegenerateAction,
  approvalSlot,
  errorSlot,
}: {
  win: StudioWindow;
  /** Canonical conversation bound to this window's task (null until the
      first send provisions one). */
  conversationId: string | null;
  /** Send a message to THIS window's conversation. The caller binds the
      conversation to the task first if needed, then sends through the
      canonical path. */
  send: (taskId: string, text: string, attachments?: string[]) => Promise<SendResult | undefined>;
  cancel: () => void;
  /** True while the selected conversation has a run in flight. */
  busy: boolean;
  disabled?: boolean;
  activeAgentId: AgentId;
  executionMode: "plan" | "act" | "auto";
  onExecutionModeChange?: (mode: "plan" | "act" | "auto") => void;
  executionHint?: string | null;
  contextLine?: ComposerContextLine;
  onRouteToolAction?: (tool: StudioTool, command?: string) => void;
  onRegenerateAction?: (assistantMessageId?: string) => void;
  /** Approval/error chrome — rendered only while this window's
      conversation is the selected one. */
  approvalSlot?: React.ReactNode;
  errorSlot?: React.ReactNode;
}) {
  const isSelected = useConversationStore((s) => conversationId !== null && s.selectedConversationId === conversationId);
  const canonicalMessages = useConversationStore(
    (s) => (conversationId ? s.messagesByConversationId[conversationId] ?? EMPTY_CONVERSATION_MESSAGES : EMPTY_CONVERSATION_MESSAGES),
  );
  const messages = useMemo(() => canonicalMessages.map(toUIMessage), [canonicalMessages]);

  // Per-window draft, persisted in the window's viewState so a refresh
  // restores exactly what was being typed.
  const [draft, setDraft] = useState<string>(() =>
    typeof win.viewState.draft === "string" ? win.viewState.draft : "",
  );
  const updateDraft = useCallback(
    (value: string) => {
      setDraft(value);
      useStudioWindowStore.getState().updateWindowState(win.id, { draft: value });
    },
    [win.id],
  );

  const handleSend = useCallback(
    async (text: string, attachments?: string[]) => {
      const result = await send(win.taskId, text, attachments);
      if (!result?.accepted) updateDraft(text); // never lose the window's draft
      return result;
    },
    [win.taskId, send, updateDraft],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="task-chat-panel" data-conversation-id={conversationId ?? "none"}>
      {isSelected && conversationId && <ActionRunStatusPanel conversationId={conversationId} busy={busy} />}
      {conversationId && <ChatBrowserLiveView conversationId={conversationId} />}
      {isSelected && errorSlot}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <StudioTranscript
          messages={messages}
          busy={isSelected && busy}
          activeAgentId={activeAgentId}
          onRouteToolAction={onRouteToolAction}
          onRegenerateAction={isSelected ? onRegenerateAction : undefined}
        />
      </div>
      {isSelected && approvalSlot}
      <CommandComposer
        value={draft}
        onChange={updateDraft}
        onSend={handleSend}
        onCancel={isSelected ? cancel : undefined}
        busy={isSelected && busy}
        disabled={disabled}
        contextLine={contextLine}
        executionMode={executionMode}
        onExecutionModeChange={onExecutionModeChange}
        executionHint={executionHint}
      />
    </div>
  );
}
