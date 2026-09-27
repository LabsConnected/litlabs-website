"use client";

/**
 * Studio shell deck transcript — the real conversation, relocated.
 *
 * This is the same StudioTranscript + ActionRunStatusPanel + ChatBrowserLiveView
 * composition the old CommandStudio rendered in its work surface: the code
 * moved, the behavior didn't. When empty (and not loading), a quiet prompt
 * replaces the old full-page welcome screen — the workspace owns the screen now.
 */

import { ActionRunStatusPanel } from "../components/ActionRunStatusPanel";
import { ChatBrowserLiveView } from "../components/ChatBrowserLiveView";
import StudioTranscript from "../components/StudioTranscript";
import { useStudioShell } from "./StudioShellContext";

export function DeckTranscript() {
  const { conversation } = useStudioShell();
  const { messages, busy, activeAgentId, selectedConversationId, regenerate } = conversation;

  if (messages.length === 0 && !busy) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
        <p className="max-w-xs text-center text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Tell LiTT what to build or change. Click anything in the preview first
          and it will be part of your request.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {conversation.fallbackNotice && (
        <div
          className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-[10px] font-bold"
          style={{
            borderColor: "var(--studio-border)",
            backgroundColor: "rgba(227,179,65,0.08)",
            color: "#e3b341",
          }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
          {conversation.fallbackNotice}
        </div>
      )}
      {selectedConversationId && (
        <ActionRunStatusPanel conversationId={selectedConversationId} busy={busy} />
      )}
      {selectedConversationId && <ChatBrowserLiveView conversationId={selectedConversationId} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <StudioTranscript
          messages={messages}
          busy={busy}
          activeAgentId={activeAgentId}
          onRegenerateAction={(assistantMessageId) => void regenerate(assistantMessageId)}
        />
      </div>
    </div>
  );
}
