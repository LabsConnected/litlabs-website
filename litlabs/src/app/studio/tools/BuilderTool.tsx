"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { Send, Code2, FileCode, Sparkles, Copy, Check } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface GeneratedFile {
  path: string;
  code: string;
  status: "generated" | "applied" | "error";
}

const SYSTEM_PROMPT = `You are the LitLabs Hive Mind -- an AI architect and code generator. You help build and improve the LitLabs platform.

RULES:
- Generate complete, working Next.js/TypeScript/TSX code
- Use Tailwind CSS with the app's theme system (useTheme hook for colors)
- Define proper TypeScript interfaces for all props -- NO "any" types
- Use "use client" directive only for interactive components
- Mobile-first responsive design
- Use @/ alias for imports
- Keep components atomic and reusable

When the user asks you to build something:
1. Describe what you're building
2. Generate the complete code in a code block
3. Explain key design decisions

Be technically precise. Think like a senior full-stack developer.`;

const QUICK_PROMPTS = [
  "Build a hero section with animated particles",
  "Create a dashboard sidebar with agent status indicators",
  "Build a pricing card with glowing neon effects",
  "Create an AI chat interface with streaming messages",
  "Build a real-time activity feed component",
  "Create a settings page with toggle switches",
];

export default function BuilderTool() {
  const { resolvedColors: T } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [activeTab, setActiveTab] = useState<"chat" | "files">("chat");
  const [streamingMessage, setStreamingMessage] = useState("");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, streamingMessage]);

  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || isBuilding) return;

    const userMessage: Message = {
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsBuilding(true);
    setStreamingMessage("");
    setActiveTab("chat");

    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          systemPrompt: SYSTEM_PROMPT,
          stream: true,
        }),
      });

      if (!response.ok) throw new Error("API error");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split("\n\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.text) {
                  fullText += parsed.text;
                  setStreamingMessage(fullText);
                }
              } catch {
                /* skip */
              }
            }
          }
        }
      }

      if (fullText) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: fullText, timestamp: new Date().toLocaleTimeString() },
        ]);
        setStreamingMessage("");

        const codeBlocks = fullText.match(/```tsx?\n([\s\S]*?)```/g);
        if (codeBlocks) {
          const newFiles: GeneratedFile[] = codeBlocks.map((block, i) => {
            const code = block.replace(/```tsx?\n/, "").replace(/```$/, "");
            const pathMatch = fullText.match(new RegExp(`src/[^\\s]+\\.tsx`, "g"));
            return {
              path: pathMatch?.[i] || `src/components/generated-${Date.now()}-${i}.tsx`,
              code,
              status: "generated" as const,
            };
          });
          setGeneratedFiles((prev) => [...prev, ...newFiles]);
        }
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${e instanceof Error ? e.message : "Connection failed"}. Check that GOOGLE_API_KEY is set.`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      setStreamingMessage("");
    }

    setIsBuilding(false);
  };

  const handleCopy = (path: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  const formatContent = (text: string) => {
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith("```")) {
        const fence = part.match(/^```(\w+)?\n?/);
        const lang = fence?.[1] || "code";
        const code = part.replace(/^```(\w+)?\n?/, "").replace(/```$/, "");
        return (
          <div
            key={i}
            className="my-2 rounded-lg border overflow-hidden"
            style={{ backgroundColor: T.bgColor + "80", borderColor: T.borderColor + "30" }}
          >
            <div
              className="flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wider"
              style={{ backgroundColor: T.boxBg + "80", color: T.textMuted }}
            >
              <span>{lang}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(code);
                }}
                className="rounded p-1 opacity-50 hover:opacity-100 transition-opacity"
                style={{ color: T.textMuted }}
              >
                <Copy size={11} />
              </button>
            </div>
            <pre className="overflow-x-auto p-3 text-xs" style={{ color: T.textColor + "cc" }}>
              <code>{code}</code>
            </pre>
          </div>
        );
      }
      return (
        <div key={i} className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: T.textColor }}>
          {part}
        </div>
      );
    });
  };

  return (
    <div className="flex h-full w-full flex-col" style={{ backgroundColor: T.bgColor }}>
      {/* Tab bar */}
      <div
        className="flex items-center gap-2 px-4 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${T.borderColor}20` }}
      >
        <button
          onClick={() => setActiveTab("chat")}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
          style={{
            backgroundColor: activeTab === "chat" ? T.accentColor + "18" : "transparent",
            color: activeTab === "chat" ? T.accentColor : T.textMuted,
            border: `1px solid ${activeTab === "chat" ? T.accentColor + "30" : "transparent"}`,
          }}
        >
          <Sparkles size={13} /> Chat
        </button>
        <button
          onClick={() => setActiveTab("files")}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
          style={{
            backgroundColor: activeTab === "files" ? T.accentColor + "18" : "transparent",
            color: activeTab === "files" ? T.accentColor : T.textMuted,
            border: `1px solid ${activeTab === "files" ? T.accentColor + "30" : "transparent"}`,
          }}
        >
          <FileCode size={13} /> Files
          {generatedFiles.length > 0 && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[9px] font-black"
              style={{ backgroundColor: T.accentColor + "20", color: T.accentColor }}
            >
              {generatedFiles.length}
            </span>
          )}
        </button>
        <div className="flex-1" />
        <div
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ color: T.textMuted }}
        >
          <Code2 size={11} style={{ color: T.accentColor }} />
          Hive Mind
        </div>
      </div>

      {/* Chat tab */}
      {activeTab === "chat" && (
        <>
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <div
                  className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
                  style={{
                    background: `linear-gradient(135deg, ${T.accentColor}30, ${T.linkColor}20)`,
                    border: `1px solid ${T.borderColor}40`,
                  }}
                >
                  <Code2 size={26} style={{ color: T.accentColor }} />
                </div>
                <h2 className="text-xl font-black mb-2" style={{ color: T.headerColor }}>
                  Hive Mind Builder
                </h2>
                <p className="text-sm mb-6 text-center max-w-md" style={{ color: T.textMuted }}>
                  Describe what you want to build and I&apos;ll generate complete, working code.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      className="text-left rounded-lg border px-3 py-2 text-xs font-medium transition-all hover:scale-[1.02]"
                      style={{
                        backgroundColor: T.boxBg + "60",
                        borderColor: T.borderColor + "25",
                        color: T.textColor + "cc",
                      }}
                    >
                      <Sparkles size={10} className="inline mr-1.5" style={{ color: T.accentColor }} />
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[85%] rounded-2xl p-3.5"
                  style={{
                    backgroundColor: msg.role === "user" ? T.accentColor + "15" : T.boxBg + "80",
                    border: `1px solid ${msg.role === "user" ? T.accentColor + "25" : T.borderColor + "20"}`,
                    borderRight: msg.role === "user" ? `3px solid ${T.accentColor}` : undefined,
                  }}
                >
                  <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: T.textMuted }}>
                    {msg.role === "user" ? "You" : "Hive Mind"} · {msg.timestamp}
                  </div>
                  {msg.role === "assistant" ? formatContent(msg.content) : (
                    <div className="text-sm whitespace-pre-wrap" style={{ color: T.textColor }}>
                      {msg.content}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {streamingMessage && (
              <div className="flex justify-start">
                <div
                  className="max-w-[85%] rounded-2xl p-3.5"
                  style={{
                    backgroundColor: T.boxBg + "80",
                    border: `1px solid ${T.borderColor}20`,
                  }}
                >
                  <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: T.textMuted }}>
                    Hive Mind
                  </div>
                  <div className="text-sm">
                    {formatContent(streamingMessage)}
                    <span className="animate-pulse" style={{ color: T.accentColor }}>▊</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div
            className="shrink-0 p-3"
            style={{ borderTop: `1px solid ${T.borderColor}20`, backgroundColor: T.bgColor + "80" }}
          >
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Describe what you want to build..."
                className="flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none transition-all"
                style={{
                  backgroundColor: T.boxBg + "60",
                  borderColor: T.borderColor + "30",
                  color: T.textColor,
                }}
                disabled={isBuilding}
              />
              <button
                onClick={() => sendMessage()}
                disabled={isBuilding || !input.trim()}
                className="flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold transition-all disabled:opacity-40"
                style={{ backgroundColor: T.accentColor, color: T.bgColor }}
              >
                {isBuilding ? "..." : <Send size={16} />}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Files tab */}
      {activeTab === "files" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {generatedFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
              <FileCode size={40} style={{ color: T.textMuted + "60" }} />
              <p className="mt-4 text-sm" style={{ color: T.textMuted }}>
                No files generated yet. Start a conversation to generate code.
              </p>
            </div>
          ) : (
            generatedFiles.map((file, i) => (
              <div
                key={i}
                className="rounded-xl border overflow-hidden"
                style={{ backgroundColor: T.boxBg + "60", borderColor: T.borderColor + "25" }}
              >
                <div
                  className="flex items-center justify-between px-4 py-2"
                  style={{ borderBottom: `1px solid ${T.borderColor}20`, backgroundColor: T.bgColor + "40" }}
                >
                  <span className="text-xs font-mono font-bold" style={{ color: T.accentColor }}>
                    {file.path}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase"
                      style={{
                        backgroundColor: file.status === "generated" ? T.success + "20" : T.accentColor + "20",
                        color: file.status === "generated" ? T.success : T.accentColor,
                      }}
                    >
                      {file.status}
                    </span>
                    <button
                      onClick={() => handleCopy(file.path, file.code)}
                      className="rounded p-1 transition-opacity hover:opacity-80"
                      style={{ color: T.textMuted }}
                    >
                      {copiedPath === file.path ? <Check size={12} style={{ color: T.success }} /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>
                <pre className="p-4 text-xs font-mono overflow-x-auto max-h-72" style={{ color: T.textColor + "cc" }}>
                  <code>{file.code}</code>
                </pre>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
