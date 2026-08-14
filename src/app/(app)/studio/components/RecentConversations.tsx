"use client";

import { useMemo } from "react";
import { MessageSquare, ArrowRight } from "lucide-react";
import { useConversationStore } from "../stores/useConversationStore";

/**
 * RecentConversations — shows actual conversation sessions from the
 * canonical store, NOT the activity timeline.
 *
 * P0.13 fix: The "Recent chats" section was showing StudioActivityTimeline
 * (activity events) instead of actual conversations. This component
 * displays real conversation titles with last-message previews and
 * lets the user click to resume any conversation.
 */
export default function RecentConversations({
  onSelect,
  maxItems = 4,
}: {
  onSelect?: (conversationId: string) => void;
  maxItems?: number;
}) {
  const conversations = useConversationStore((s) => s.conversations);
  const selectedConversationId = useConversationStore((s) => s.selectedConversationId);
  const messagesByConversationId = useConversationStore((s) => s.messagesByConversationId);

  const recent = useMemo(() => {
    return conversations
      .slice(0, maxItems)
      .map((conv) => {
        const msgs = messagesByConversationId[conv.id] ?? [];
        const lastMsg = msgs[msgs.length - 1];
        return {
          ...conv,
          lastMessagePreview: lastMsg?.content?.slice(0, 80) ?? "No messages yet",
          lastMessageRole: lastMsg?.role ?? null,
          messageCount: msgs.length,
        };
      });
  }, [conversations, messagesByConversationId, maxItems]);

  if (recent.length === 0) {
    return (
      <div className="mt-4 rounded-xl border px-4 py-6 text-center" style={{ borderColor: "var(--studio-border-strong)", backgroundColor: "var(--studio-card)" }}>
        <MessageSquare size={20} className="mx-auto mb-2 opacity-30" style={{ color: "var(--text-muted)" }} />
        <p className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
          No conversations yet. Start chatting above.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-2">
      {recent.map((conv) => {
        const isActive = conv.id === selectedConversationId;
        return (
          <button
            key={conv.id}
            type="button"
            onClick={() => onSelect?.(conv.id)}
            className="group flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition hover:-translate-y-0.5"
            style={{
              borderColor: isActive ? "rgba(114,242,56,0.3)" : "var(--studio-border-strong)",
              backgroundColor: isActive ? "rgba(114,242,56,0.04)" : "var(--studio-card)",
            }}
            aria-label={`Open conversation: ${conv.title || "Untitled"}`}
          >
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
              style={{
                backgroundColor: "rgba(114,242,56,0.08)",
                color: "var(--litt-primary)",
              }}
            >
              <MessageSquare size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
                {conv.title || "Untitled conversation"}
              </span>
              <span className="block truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                {conv.lastMessagePreview}
              </span>
            </span>
            {isActive && (
              <span
                className="shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase"
                style={{
                  backgroundColor: "rgba(114,242,56,0.12)",
                  color: "var(--litt-primary)",
                }}
              >
                Active
              </span>
            )}
            <ArrowRight
              size={12}
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              style={{ color: "var(--litt-primary)" }}
            />
          </button>
        );
      })}
    </div>
  );
}
