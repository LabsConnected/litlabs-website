"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import type { AgentSlug, Conversation, ConversationMessage } from "@/lib/studio/types";
import { Send, MessageSquare, XCircle, Loader2 } from "lucide-react";

const SEED_CONVERSATIONS: Conversation[] = [
  {
    id: "seed-conv-1",
    ownerId: "seed-user",
    projectId: "seed-project-1",
    title: "Fix authentication bug",
    activeAgentSlug: "litt",
    activeAgentMode: "standard",
    agentInstanceId: null,
    revision: 5,
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    updatedAt: new Date(Date.now() - 600_000).toISOString(),
    archivedAt: null,
  },
  {
    id: "seed-conv-2",
    ownerId: "seed-user",
    projectId: "seed-project-1",
    title: "Design landing page",
    activeAgentSlug: "spark",
    activeAgentMode: "spark",
    agentInstanceId: null,
    revision: 3,
    createdAt: new Date(Date.now() - 7200_000).toISOString(),
    updatedAt: new Date(Date.now() - 1800_000).toISOString(),
    archivedAt: null,
  },
];

const SEED_MESSAGES: Record<string, ConversationMessage[]> = {
  "seed-conv-1": [
    {
      id: "msg-1",
      conversationId: "seed-conv-1",
      ownerId: "seed-user",
      projectId: "seed-project-1",
      role: "user",
      agentSlug: null,
      agentMode: null,
      agentInstanceId: null,
      content: "Can you check the auth flow? Users are getting logged out randomly.",
      status: "completed",
      parentMessageId: null,
      regenerationOfMessageId: null,
      clientRequestId: "req-1",
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
      updatedAt: new Date(Date.now() - 3600_000).toISOString(),
    },
    {
      id: "msg-2",
      conversationId: "seed-conv-1",
      ownerId: "seed-user",
      projectId: "seed-project-1",
      role: "assistant",
      agentSlug: "litt",
      agentMode: "standard",
      agentInstanceId: null,
      content: "I'll check the JWT expiration and refresh token logic. The issue is likely that the refresh token cookie isn't being set with SameSite=None, which causes it to be dropped on cross-origin requests.",
      status: "completed",
      parentMessageId: "msg-1",
      regenerationOfMessageId: null,
      clientRequestId: null,
      createdAt: new Date(Date.now() - 3500_000).toISOString(),
      updatedAt: new Date(Date.now() - 3500_000).toISOString(),
    },
    {
      id: "msg-3",
      conversationId: "seed-conv-1",
      ownerId: "seed-user",
      projectId: "seed-project-1",
      role: "user",
      agentSlug: null,
      agentMode: null,
      agentInstanceId: null,
      content: "Great, can you fix it?",
      status: "completed",
      parentMessageId: null,
      regenerationOfMessageId: null,
      clientRequestId: "req-2",
      createdAt: new Date(Date.now() - 600_000).toISOString(),
      updatedAt: new Date(Date.now() - 600_000).toISOString(),
    },
    {
      id: "msg-4",
      conversationId: "seed-conv-1",
      ownerId: "seed-user",
      projectId: "seed-project-1",
      role: "assistant",
      agentSlug: "litt",
      agentMode: "standard",
      agentInstanceId: null,
      content: "",
      status: "streaming",
      parentMessageId: "msg-3",
      regenerationOfMessageId: null,
      clientRequestId: null,
      createdAt: new Date(Date.now() - 500_000).toISOString(),
      updatedAt: new Date(Date.now() - 500_000).toISOString(),
    },
  ],
  "seed-conv-2": [
    {
      id: "msg-5",
      conversationId: "seed-conv-2",
      ownerId: "seed-user",
      projectId: "seed-project-1",
      role: "user",
      agentSlug: null,
      agentMode: null,
      agentInstanceId: null,
      content: "I need a hero section for the landing page. Something bold.",
      status: "completed",
      parentMessageId: null,
      regenerationOfMessageId: null,
      clientRequestId: "req-3",
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
      updatedAt: new Date(Date.now() - 7200_000).toISOString(),
    },
    {
      id: "msg-6",
      conversationId: "seed-conv-2",
      ownerId: "seed-user",
      projectId: "seed-project-1",
      role: "assistant",
      agentSlug: "spark",
      agentMode: "spark",
      agentInstanceId: null,
      content: "Love the energy! Let's go with a full-bleed gradient hero with a bold headline and a subtle particle animation. The CTA should be a high-contrast pill button that pops against the gradient.",
      status: "completed",
      parentMessageId: "msg-5",
      regenerationOfMessageId: null,
      clientRequestId: null,
      createdAt: new Date(Date.now() - 7100_000).toISOString(),
      updatedAt: new Date(Date.now() - 7100_000).toISOString(),
    },
  ],
};

const ERROR_SEED_MESSAGE: ConversationMessage = {
  id: "msg-error",
  conversationId: "seed-conv-1",
  ownerId: "seed-user",
  projectId: "seed-project-1",
  role: "assistant",
  agentSlug: "litt",
  agentMode: "standard",
  agentInstanceId: null,
  content: "Provider unavailable: Gemini API key not configured",
  status: "failed",
  parentMessageId: "msg-3",
  regenerationOfMessageId: null,
  clientRequestId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export default function VisualHarnessContent() {
  const { tokens } = useTheme();
  const [selectedConvId, setSelectedConvId] = useState<string>("seed-conv-1");
  const [activeAgent, setActiveAgent] = useState<AgentSlug>("litt");
  const [showError, setShowError] = useState(false);

  const messages = showError
    ? [...SEED_MESSAGES[selectedConvId].slice(0, 3), ERROR_SEED_MESSAGE]
    : SEED_MESSAGES[selectedConvId] || [];

  return (
    <div className="min-h-screen" style={{ backgroundColor: tokens.background, color: tokens.text }}>
      {/* Header */}
      <div className="border-b px-6 py-4" style={{ borderColor: tokens.border }}>
        <h1 className="text-lg font-black">Studio V12 Visual Harness</h1>
        <p className="text-xs mt-1" style={{ color: tokens.textMuted }}>
          Seeded UI states for visual verification. Not connected to real backend.
        </p>
      </div>

      <div className="flex h-[calc(100vh-72px)]">
        {/* Sidebar — conversation list */}
        <div className="w-64 border-r overflow-y-auto" style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}>
          <div className="p-3">
            <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: tokens.textMuted }}>
              Conversations
            </div>
            {SEED_CONVERSATIONS.map((conv) => (
              <button
                key={conv.id}
                onClick={() => {
                  setSelectedConvId(conv.id);
                  setActiveAgent(conv.activeAgentSlug);
                  setShowError(false);
                }}
                className="w-full text-left rounded-lg px-3 py-2 mb-1 transition-colors"
                style={{
                  backgroundColor: conv.id === selectedConvId ? `${tokens.primary}15` : "transparent",
                  border: conv.id === selectedConvId ? `1px solid ${tokens.primary}30` : "1px solid transparent",
                }}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} style={{ color: tokens.textMuted }} />
                  <span className="text-sm font-medium truncate">{conv.title}</span>
                </div>
                <div className="text-xs mt-1" style={{ color: tokens.textMuted }}>
                  {conv.activeAgentSlug} · rev {conv.revision}
                </div>
              </button>
            ))}
          </div>

          {/* Agent selector */}
          <div className="p-3 border-t" style={{ borderColor: tokens.border }}>
            <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: tokens.textMuted }}>
              Agent
            </div>
            <div className="flex gap-2">
              {(["litt", "spark"] as AgentSlug[]).map((slug) => (
                <button
                  key={slug}
                  onClick={() => setActiveAgent(slug)}
                  className="flex-1 rounded-lg px-3 py-2 text-xs font-bold capitalize transition-all"
                  style={{
                    backgroundColor: activeAgent === slug ? `${tokens.primary}20` : "transparent",
                    border: `1px solid ${activeAgent === slug ? `${tokens.primary}40` : tokens.border}`,
                    color: activeAgent === slug ? tokens.primary : tokens.textMuted,
                  }}
                >
                  {slug === "litt" ? "LiTT" : "Spark"}
                </button>
              ))}
            </div>
          </div>

          {/* State toggles */}
          <div className="p-3 border-t" style={{ borderColor: tokens.border }}>
            <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: tokens.textMuted }}>
              UI States
            </div>
            <button
              onClick={() => setShowError(!showError)}
              className="w-full rounded-lg px-3 py-2 text-xs font-medium transition-all"
              style={{
                backgroundColor: showError ? "#ef444420" : "transparent",
                border: `1px solid ${showError ? "#ef444440" : tokens.border}`,
                color: showError ? "#ef4444" : tokens.textMuted,
              }}
            >
              {showError ? "Showing error state" : "Show error state"}
            </button>
          </div>
        </div>

        {/* Chat panel */}
        <div className="flex-1 flex flex-col">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="max-w-2xl mx-auto space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className="flex gap-3"
                  style={{ flexDirection: msg.role === "user" ? "row-reverse" : "row" }}
                >
                  {/* Avatar */}
                  <div
                    className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{
                      backgroundColor: msg.role === "user" ? `${tokens.primary}20` : `${tokens.primary}10`,
                      color: tokens.primary,
                    }}
                  >
                    {msg.role === "user" ? "U" : msg.agentSlug === "spark" ? "S" : "L"}
                  </div>

                  {/* Message bubble */}
                  <div
                    className="flex-1 rounded-2xl px-4 py-3 max-w-[80%]"
                    style={{
                      backgroundColor: msg.role === "user" ? `${tokens.primary}15` : tokens.surface,
                      border: `1px solid ${msg.status === "failed" ? "#ef444440" : tokens.border}`,
                    }}
                  >
                    {msg.status === "streaming" && (
                      <div className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" style={{ color: tokens.textMuted }} />
                        <span className="text-xs" style={{ color: tokens.textMuted }}>LiTT is thinking...</span>
                      </div>
                    )}
                    {msg.status === "failed" && (
                      <div className="flex items-center gap-2 mb-2">
                        <XCircle size={14} style={{ color: "#ef4444" }} />
                        <span className="text-xs font-bold" style={{ color: "#ef4444" }}>Failed</span>
                      </div>
                    )}
                    {msg.status === "completed" && (
                      <p className="text-sm" style={{ color: tokens.text }}>{msg.content}</p>
                    )}
                    {msg.status === "failed" && (
                      <p className="text-sm" style={{ color: "#ef4444" }}>{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Composer */}
          <div className="border-t px-6 py-4" style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}>
            <div className="max-w-2xl mx-auto flex items-center gap-2">
              <div
                className="flex-1 rounded-xl px-4 py-2.5 text-sm"
                style={{
                  backgroundColor: tokens.background,
                  border: `1px solid ${tokens.border}`,
                  color: tokens.textMuted,
                }}
              >
                Message {activeAgent === "litt" ? "LiTT" : "Spark"}...
              </div>
              <button
                className="rounded-xl p-2.5 transition-all"
                style={{ backgroundColor: `${tokens.primary}15`, border: `1px solid ${tokens.primary}30` }}
              >
                <Send size={16} style={{ color: tokens.primary }} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
