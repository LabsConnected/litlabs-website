"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Send,
  Loader2,
  Terminal,
  User,
  ChevronDown,
  Sparkles,
  FileCode,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { extractFencedFiles, useStudio, StudioFile, StudioToolId } from "./studio-context";
import { classifyPromptIntent, dispatchStudioPrompt } from "./prompt-bridge";

type Msg = { id: string; role: "user" | "assistant" | "system"; content: string; ts: string };

const MODELS = [
  { id: "gemini-flash", short: "Gemini" },
  { id: "gpt-4o", short: "GPT-4o" },
  { id: "claude-sonnet", short: "Claude" },
  { id: "qwen-coder", short: "Qwen" },
  { id: "llama-nemotron", short: "Llama" },
] as const;

const STARTERS = [
  "Build a glassmorphic login card",
  "Make a responsive pricing table with 3 tiers",
  "Create an animated counter component",
  "Build a dark dashboard sidebar",
];

export default function ChatDrawer({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const T = useTheme().resolvedColors;
  const { loadPresetFiles, setActiveTool } = useStudio();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<(typeof MODELS)[number]["id"]>("gemini-flash");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [msgs, open]);

  const injectFiles = useCallback(
    (files: StudioFile[]) => {
      if (files.length === 0) return;
      loadPresetFiles(files);
      setActiveTool("code" as StudioToolId);
    },
    [loadPresetFiles, setActiveTool],
  );

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      setInput("");

      // Intent routing: media prompts skip the LLM and go straight to the right tool.
      const intent = classifyPromptIntent(text);
      if (intent) {
        const targetTool: StudioToolId = intent.target as StudioToolId;
        const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: text, ts: now() };
        setMsgs((prev) => [...prev, userMsg]);
        dispatchStudioPrompt(intent.target, intent.cleaned);
        setActiveTool(targetTool);
        setMsgs((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Routed to the ${intent.target} tool with your prompt. Switch tabs to refine and generate.`,
            ts: now(),
          },
        ]);
        return;
      }

      const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: text, ts: now() };
      const history = msgs.slice(-10);
      setMsgs((prev) => [...prev, userMsg]);
      setLoading(true);

      const assistantId = crypto.randomUUID();
      setMsgs((prev) => [...prev, { id: assistantId, role: "assistant", content: "", ts: now() }]);

      try {
        const res = await fetch("/api/ai-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              ...history.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
              {
                role: "user",
                content:
                  "You are a code builder. Generate clean, working code. Wrap each file in a fenced block whose first line is a comment with the filename (e.g. ```html\\n// index.html\\n<!doctype html>...). For HTML produce a complete standalone file. Keep prose minimal.",
              },
              { role: "user", content: text },
            ],
          }),
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => "Request failed");
          setMsgs((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, role: "system", content: "Error: " + errText } : m)),
          );
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMsgs((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)));
        }

        const parsed = extractFencedFiles(acc);
        if (parsed.files.length > 0) {
          setMsgs((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: parsed.cleanText || "Done. Files loaded into the editor." }
                : m,
            ),
          );
          injectFiles(parsed.files);
        }
      } catch (err) {
        setMsgs((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, role: "system", content: "Error: " + (err instanceof Error ? err.message : "failed") }
              : m,
          ),
        );
      } finally {
        setLoading(false);
      }
    },
    [loading, msgs, model, injectFiles, setActiveTool],
  );

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div
      className={`shrink-0 border-t flex flex-col transition-all duration-300 ${open ? "h-[40vh]" : "h-10"}`}
      style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "90", backdropFilter: "blur(8px)" }}
    >
      {/* Bar / header */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between px-4 h-10 shrink-0 w-full"
        style={{ color: T.textMuted }}
      >
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em]">
          <Sparkles size={13} style={{ color: T.accentColor }} />
          Ask LiTT
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] opacity-70 hidden sm:inline">Cmd/Ctrl + J</span>
          <ChevronDown size={14} className={`transition-transform ${open ? "" : "rotate-180"}`} />
        </span>
      </button>

      {open && (
        <>
          <div className="flex items-center gap-1 px-4 pb-1 shrink-0">
            {MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className="px-2 py-0.5 rounded-md text-[10px] font-bold transition-all"
                style={{
                  backgroundColor: model === m.id ? T.accentColor + "20" : "transparent",
                  color: model === m.id ? T.accentColor : T.textMuted,
                }}
              >
                {m.short}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-3">
            {msgs.length === 0 && (
              <div className="h-full grid place-items-center text-center">
                <div>
                  <div
                    className="w-10 h-10 rounded-xl mx-auto mb-3 grid place-items-center"
                    style={{ backgroundColor: T.accentColor + "15", border: `1px solid ${T.accentColor}30` }}
                  >
                    <Bot size={18} style={{ color: T.accentColor }} />
                  </div>
                  <p className="text-xs mb-3" style={{ color: T.textMuted }}>
                    Describe what to build. Files load into the editor above.
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="text-[11px] px-2.5 py-1.5 rounded-lg border font-medium hover:-translate-y-0.5 transition-transform"
                        style={{ backgroundColor: T.bgColor + "70", borderColor: T.borderColor + "30", color: T.textColor }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {msgs.map((m) => {
              const isUser = m.role === "user";
              const isSys = m.role === "system";
              return (
                <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[88%]">
                    <div className="flex items-center gap-1.5 mb-1">
                      {isUser ? (
                        <User size={11} style={{ color: T.accentColor }} />
                      ) : isSys ? (
                        <Terminal size={11} style={{ color: "#ff6b6b" }} />
                      ) : (
                        <Bot size={11} style={{ color: T.success }} />
                      )}
                      <span className="text-[9px] font-bold" style={{ color: isUser ? T.accentColor : isSys ? "#ff6b6b" : T.success }}>
                        {isUser ? "You" : isSys ? "System" : "LiTT"}
                      </span>
                      <span className="text-[9px]" style={{ color: T.textMuted }}>{m.ts}</span>
                    </div>
                    <div
                      className="rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words"
                      style={{
                        backgroundColor: isUser ? T.accentColor + "12" : T.bgColor + "70",
                        border: `1px solid ${isUser ? T.accentColor + "25" : T.borderColor + "22"}`,
                        color: T.textColor,
                      }}
                    >
                      {m.content || (loading && !isUser ? <span className="flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> thinking…</span> : "…")}
                    </div>
                    {!isUser && !isSys && m.content && /`\[.*\]`/.test(m.content) && (
                      <span className="inline-flex items-center gap-1 mt-1 text-[10px] px-2 py-0.5 rounded-md" style={{ backgroundColor: T.accentColor + "12", color: T.accentColor }}>
                        <FileCode size={10} /> files loaded into editor
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t shrink-0" style={{ borderColor: T.borderColor + "18", backgroundColor: T.boxBg + "50" }}>
            <div className="flex items-start gap-2">
              <div
                className="flex-1 flex items-start gap-2 rounded-xl border px-3 py-2"
                style={{ backgroundColor: T.bgColor + "70", borderColor: T.accentColor + "30" }}
              >
                <Terminal size={13} className="mt-1 shrink-0" style={{ color: T.accentColor }} />
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKey}
                  rows={1}
                  disabled={loading}
                  placeholder="Build something…  (enter to send, shift+enter newline)"
                  className="flex-1 min-w-0 bg-transparent text-sm outline-none resize-none"
                  style={{ color: T.textColor }}
                />
              </div>
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || loading}
                className="rounded-xl px-3.5 shrink-0 grid place-items-center transition-all"
                style={{
                  backgroundColor: input.trim() && !loading ? T.accentColor : T.borderColor + "30",
                  color: input.trim() && !loading ? "#000" : T.textMuted,
                }}
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}