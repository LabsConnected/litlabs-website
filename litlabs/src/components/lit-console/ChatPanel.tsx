"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  User,
  Bot,
  Loader2,
  FileCode,
  Terminal,
  Copy,
  Check,
  Play,
} from "lucide-react";
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
  onApprove?: (command: string) => void;
  plan?: {
    runId: string | null;
    steps: Array<{
      id: string;
      title: string;
      command?: string | null;
      needs_approval?: boolean;
      risk_level?: string;
    }>;
  };
  onApproveStep?: (runId: string, command: string) => void;
  onApprovePlan?: () => void;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  return (
    <div
      className="group relative my-2 overflow-hidden rounded-lg border"
      style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wider"
        style={{ backgroundColor: LC.bgPanelHover, color: LC.textDim }}
      >
        <span>{lang || "code"}</span>
        <button
          onClick={handleCopy}
          className="rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: LC.textMuted }}
          title="Copy"
        >
          {copied ? (
            <Check size={12} style={{ color: LC.success }} />
          ) : (
            <Copy size={12} />
          )}
        </button>
      </div>
      <pre
        className="overflow-x-auto p-3 text-xs"
        style={{ color: LC.textDim, fontFamily: LC.fontMono }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function formatContent(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```")) {
      const fence = part.match(/^```(\w+)?\n?/);
      const lang = fence?.[1] || "";
      const code = part.replace(/^```(\w+)?\n?/, "").replace(/```$/, "");
      return <CodeBlock key={i} lang={lang} code={code} />;
    }
    return (
      <div
        key={i}
        className="whitespace-pre-wrap text-sm leading-relaxed"
        style={{ color: LC.text }}
      >
        {part}
      </div>
    );
  });
}

export default function ChatPanel({
  messages,
  onSend,
  loading,
  onApprove,
  plan,
  onApproveStep,
  onApprovePlan,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrolledRef = useRef(false);
  const [activeLitId, setActiveLitId] = useState<string | null>(
    () => [...messages].reverse().find((m) => m.role === "lit")?.id || null,
  );
  const [revealed, setRevealed] = useState<Record<string, number>>(() => {
    const latest = [...messages].reverse().find((m) => m.role === "lit");
    const init: Record<string, number> = {};
    messages.forEach((m) => {
      if (m.role === "lit") {
        init[m.id] = m.id === latest?.id ? 0 : m.content.length;
      }
    });
    return init;
  });

  useEffect(() => {
    const latestLit = [...messages].reverse().find((m) => m.role === "lit");
    if (!latestLit || latestLit.id === activeLitId) return;
    setActiveLitId(latestLit.id);
    isScrolledRef.current = false;
    setRevealed((prev) => {
      const next: Record<string, number> = { ...prev, [latestLit.id]: 0 };
      messages.forEach((m) => {
        if (m.role === "lit" && m.id !== latestLit.id) {
          next[m.id] = m.content.length;
        }
      });
      return next;
    });
  }, [messages, activeLitId]);

  useEffect(() => {
    if (!activeLitId || isScrolledRef.current) return;
    const content = messages.find((m) => m.id === activeLitId)?.content || "";
    const timer = setInterval(() => {
      setRevealed((prev) => {
        const c = prev[activeLitId] || 0;
        if (c >= content.length) {
          clearInterval(timer);
          return prev;
        }
        return { ...prev, [activeLitId]: c + 1 };
      });
    }, 10);
    return () => clearInterval(timer);
  }, [activeLitId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleScroll = useCallback(() => {
    if (!activeLitId || isScrolledRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    if (isAtBottom) return;
    isScrolledRef.current = true;
    setRevealed((prev) => {
      const content = messages.find((m) => m.id === activeLitId)?.content || "";
      return { ...prev, [activeLitId]: content.length };
    });
  }, [activeLitId, messages]);

  const isEmpty = messages.length === 0;

  const renderLitContent = (m: Message) => {
    const rawLen = revealed[m.id];
    const isStreaming =
      m.id === activeLitId &&
      (rawLen === undefined || rawLen < m.content.length);
    const len = rawLen ?? 0;
    if (isStreaming) {
      return (
        <div
          className="whitespace-pre-wrap text-sm leading-relaxed"
          style={{ color: LC.text }}
        >
          {m.content.slice(0, len)}
          <span
            className="ml-0.5 inline-block h-4 w-0.5 animate-pulse"
            style={{ backgroundColor: LC.accentCyan }}
          />
        </div>
      );
    }
    return <div className="text-sm">{formatContent(m.content)}</div>;
  };

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-2xl border"
      style={{
        backgroundColor: LC.bgPanel,
        borderColor: LC.border,
        boxShadow: LC_SHADOW.panel,
      }}
    >
      <div
        className="flex items-center gap-3 border-b px-5 py-4"
        style={{ borderColor: LC.border }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: LC.bgSecondary }}
        >
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

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-4 overflow-y-auto p-5"
      >
        {isEmpty ? (
          <div className="flex h-full flex-col justify-center">
            <StarterActions onSelect={onSend} />
            <p
              className="mt-4 text-center text-xs"
              style={{ color: LC.textDim }}
            >
              Or type a command, question, or build request.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user" ? "flex justify-end" : "flex justify-start"
              }
            >
              {m.role === "user" && (
                <div className="flex max-w-[80%] items-end gap-2">
                  <div
                    className="rounded-2xl rounded-br-md px-4 py-2.5 text-sm"
                    style={{
                      backgroundColor: LC.bgPanelHover,
                      borderRight: `3px solid ${LC.accentCyan}`,
                      color: LC.text,
                    }}
                  >
                    {m.content}
                  </div>
                  <div
                    className="rounded-full p-1.5"
                    style={{
                      backgroundColor: LC.bgSecondary,
                      color: LC.accentCyan,
                    }}
                  >
                    <User size={14} />
                  </div>
                </div>
              )}

              {m.role === "lit" && (
                <div className="flex w-full gap-3">
                  <div
                    className="mt-1 shrink-0 rounded-full p-1.5"
                    style={{
                      backgroundColor: LC.bgSecondary,
                      color: LC.accentCyan,
                    }}
                  >
                    <Bot size={14} />
                  </div>
                  <div className="min-w-0 flex-1">{renderLitContent(m)}</div>
                </div>
              )}

              {m.role === "tool" && (
                <div className="flex w-full gap-3">
                  <div
                    className="mt-1 shrink-0 rounded-full p-1.5"
                    style={{
                      backgroundColor: `${LC.accentOrange}15`,
                      color: LC.accentOrange,
                    }}
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
                    <div
                      className="flex items-center gap-2 text-xs font-medium"
                      style={{ color: LC.text }}
                    >
                      {m.meta?.status === "running" && (
                        <Loader2
                          size={14}
                          className="animate-spin"
                          style={{ color: LC.accentOrange }}
                        />
                      )}
                      {m.meta?.status === "done" && (
                        <span
                          className="rounded px-1 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${LC.success}20`,
                            color: LC.success,
                          }}
                        >
                          done
                        </span>
                      )}
                      {m.meta?.status === "error" && (
                        <span
                          className="rounded px-1 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${LC.danger}20`,
                            color: LC.danger,
                          }}
                        >
                          error
                        </span>
                      )}
                      {m.meta?.tool || "Tool"}
                    </div>
                    <div
                      className="mt-1 text-xs"
                      style={{ color: LC.textMuted }}
                    >
                      {m.content}
                    </div>
                  </div>
                </div>
              )}

              {m.role === "system" && (
                <div
                  className="flex w-full flex-col gap-2 rounded-md px-3 py-2 text-xs"
                  style={{ backgroundColor: LC.bgSecondary, color: LC.textDim }}
                >
                  <div className="flex items-center gap-2">
                    <Terminal size={14} />
                    {m.content}
                  </div>
                  {(() => {
                    const cmd = (m.content.match(/`([^`]+)`/) || [])[1];
                    if (
                      !cmd ||
                      !onApprove ||
                      !m.content.toLowerCase().includes("approve")
                    )
                      return null;
                    return (
                      <button
                        onClick={() => onApprove(cmd)}
                        className="flex w-fit items-center gap-1 rounded px-2 py-1 text-xs font-semibold"
                        style={{
                          backgroundColor: LC.accentOrange,
                          color: "#000",
                        }}
                      >
                        <Play size={12} /> Approve
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>
          ))
        )}

        {plan && (
          <div
            className="flex flex-col gap-2 rounded-xl border p-4"
            style={{ backgroundColor: LC.bgSecondary, borderColor: LC.border }}
          >
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold" style={{ color: LC.text }}>
                Run Plan
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="mr-2 text-[10px]"
                  style={{ color: LC.textMuted }}
                >
                  {plan.runId
                    ? `Run #${plan.runId.slice(0, 8)}`
                    : "Unsaved preview"}
                </div>
                {onApprovePlan && plan.steps.some((s) => s.needs_approval) ? (
                  <button
                    onClick={onApprovePlan}
                    className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold"
                    style={{ backgroundColor: LC.accentOrange, color: "#000" }}
                  >
                    <Play size={12} /> Approve Plan
                  </button>
                ) : !plan.steps.some((s) => s.needs_approval) &&
                  onApprovePlan ? (
                  <button
                    onClick={onApprovePlan}
                    className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold"
                    style={{ backgroundColor: LC.accentCyan, color: "#000" }}
                  >
                    Execute Plan
                  </button>
                ) : null}
              </div>
            </div>
            <div className="text-xs" style={{ color: LC.textDim }}>
              {plan.steps[0]?.title || "No steps."}
            </div>
            <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto pr-1">
              {plan.steps.map((step, idx) => (
                <div
                  key={step.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                  style={{
                    backgroundColor: LC.bgPanel,
                    borderColor: LC.border,
                  }}
                >
                  <div className="min-w-0">
                    <div className="font-medium" style={{ color: LC.text }}>
                      {idx + 1}. {step.title}
                    </div>
                    {step.command ? (
                      <div
                        className="mt-1 truncate font-mono"
                        style={{ color: LC.accentOrange }}
                      >
                        {step.command}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      style={{
                        backgroundColor:
                          step.risk_level === "critical" ||
                          step.risk_level === "high"
                            ? `${LC.danger}25`
                            : `${LC.success}15`,
                        color:
                          step.risk_level === "critical" ||
                          step.risk_level === "high"
                            ? LC.danger
                            : LC.success,
                      }}
                    >
                      {step.risk_level || "low"}
                    </span>
                    {step.needs_approval ? (
                      <span
                        style={{
                          backgroundColor: `${LC.accentOrange}20`,
                          color: LC.accentOrange,
                        }}
                      >
                        approve
                      </span>
                    ) : null}
                    {step.command ? (
                      <button
                        onClick={() => {
                          if (!plan.runId || !onApproveStep) return;
                          onApproveStep(plan.runId, step.command as string);
                        }}
                        className="rounded-full px-2 py-1 font-semibold"
                        style={{
                          backgroundColor: LC.accentOrange,
                          color: "#000",
                        }}
                      >
                        Run
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {loading && (
          <div
            className="flex items-center gap-2 text-xs"
            style={{ color: LC.textMuted }}
          >
            <span
              className="h-2 w-2 animate-pulse rounded-full"
              style={{ backgroundColor: LC.accentCyan }}
            />
            LiT is thinking...
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
