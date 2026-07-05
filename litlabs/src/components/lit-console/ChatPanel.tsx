"use client";

import { useEffect, useRef } from "react";
import { User, Bot, Loader2, FileCode, Terminal } from "lucide-react";
import StarterActions from "./StarterActions";
import { LC, LC_SHADOW } from "./lit-console-theme";

export interface Message {
  id: string;
  role: "user" | "lit" | "tool" | "system";
  content: string;
  meta?: { tool?: string; status?: "running" | "done" | "error" };
}

interface ChatPanelProps {
  messages: Message[];
  onSend: (text: string) => void;
  loading?: boolean;
}

function formatContent(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```")) {
      const code = part.replace(/```[a-z]*\n?/, "").replace(/```$/, "");
      return (
        <pre
          key={i}
          className="my-2 overflow-x-auto rounded-lg border p-3 text-xs"
          style={{
            backgroundColor: LC.bgSecondary,
            borderColor: LC.border,
            color: LC.textDim,
            fontFamily: LC.fontMono,
          }}
        >
          <code>{code}</code>
        </pre>
      );
    }
    return (
      <div key={i} className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: LC.text }}>
        {part}
      </div>
    );
  });
}

export default function ChatPanel({ messages, onSend, loading }: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const isEmpty = messages.length === 0;

  return (
    <div
      className="mx-auto flex h-full w-full max-w-[820px] flex-col overflow-hidden rounded-2xl border"
      style={{ backgroundColor: LC.bgPanel, borderColor: LC.border, boxShadow: LC_SHADOW.panel }}
    >
      <div className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: LC.border }}>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: LC.bgSecondary }}>
          <Terminal size={18} style={{ color: LC.accentCyan }} />
        </div>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: LC.text }}>
            LiT Console
          </h2>
          <p className="text-xs" style={{ color: LC.textMuted }}>
            Chat, terminal, agents, and project context in one workspace.
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {isEmpty ? (
          <div className="flex h-full flex-col justify-center">
            <StarterActions onSelect={onSend} />
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              {m.role === "user" && (
                <div className="flex max-w-[80%] items-end gap-2">
                  <div
                    className="rounded-2xl rounded-br-md px-4 py-2.5 text-sm"
                    style={{ backgroundColor: LC.bgPanelHover, borderRight: `3px solid ${LC.accentCyan}`, color: LC.text }}
                  >
                    {m.content}
                  </div>
                  <div className="rounded-full p-1.5" style={{ backgroundColor: LC.bgSecondary, color: LC.accentCyan }}>
                    <User size={14} />
                  </div>
                </div>
              )}

              {m.role === "lit" && (
                <div className="flex w-full gap-3">
                  <div className="mt-1 shrink-0 rounded-full p-1.5" style={{ backgroundColor: LC.bgSecondary, color: LC.accentCyan }}>
                    <Bot size={14} />
                  </div>
                  <div className="min-w-0 flex-1 text-sm">{formatContent(m.content)}</div>
                </div>
              )}

              {m.role === "tool" && (
                <div className="flex w-full gap-3">
                  <div
                    className="mt-1 shrink-0 rounded-full p-1.5"
                    style={{ backgroundColor: `${LC.accentOrange}15`, color: LC.accentOrange }}
                  >
                    <FileCode size={14} />
                  </div>
                  <div
                    className="flex-1 rounded-lg border p-3"
                    style={{
                      backgroundColor: LC.bgSecondary,
                      borderColor: LC.border,
                      borderLeft: `3px solid ${LC.accentOrange}`,
                    }}
                  >
                    <div className="flex items-center gap-2 text-xs font-medium" style={{ color: LC.text }}>
                      {m.meta?.status === "running" && (
                        <Loader2 size={14} className="animate-spin" style={{ color: LC.accentOrange }} />
                      )}
                      {m.meta?.status === "done" && (
                        <span className="rounded px-1 py-0.5 text-[10px]" style={{ backgroundColor: `${LC.success}20`, color: LC.success }}>
                          done
                        </span>
                      )}
                      {m.meta?.status === "error" && (
                        <span className="rounded px-1 py-0.5 text-[10px]" style={{ backgroundColor: `${LC.danger}20`, color: LC.danger }}>
                          error
                        </span>
                      )}
                      {m.meta?.tool || "Tool"}
                    </div>
                    <div className="mt-1 text-xs" style={{ color: LC.textMuted }}>
                      {m.content}
                    </div>
                  </div>
                </div>
              )}

              {m.role === "system" && (
                <div className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs" style={{ backgroundColor: LC.bgSecondary, color: LC.textDim }}>
                  <Terminal size={14} />
                  {m.content}
                </div>
              )}
            </div>
          ))
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs" style={{ color: LC.textMuted }}>
            <Loader2 size={14} className="animate-spin" style={{ color: LC.accentCyan }} />
            LiT is thinking...
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
