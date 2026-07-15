"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Bot,
  Copy,
  Download,
  Eye,
  Code,
  FileCode,
  Loader2,
  Check,
  Send,
  Terminal,
  User,
  Wand2,
  Maximize2,
  Minimize2,
  Play,
  Brain,
} from "lucide-react";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  code?: string;
  language?: string;
  ts: string;
};

type GeneratedFile = {
  name: string;
  content: string;
  language: string;
};

const MODELS = [
  { id: "gemini-flash", name: "Gemini 2.5 Flash", short: "Gemini" },
  { id: "gpt-4o", name: "GPT-4o", short: "GPT-4o" },
  { id: "claude-sonnet", name: "Claude Sonnet", short: "Claude" },
  { id: "qwen-coder", name: "Qwen3 Coder", short: "Qwen" },
  { id: "llama-nemotron", name: "Llama Nemotron 70B", short: "Llama" },
];

const STARTER_TEMPLATES = [
  {
    label: "Landing Page",
    prompt:
      "Build a modern landing page with hero, features grid, and CTA button",
  },
  {
    label: "React Counter",
    prompt: "Create a React counter with increment, decrement, and reset",
  },
  {
    label: "Todo App",
    prompt: "Build a todo app with add, delete, and mark complete",
  },
  {
    label: "Dashboard",
    prompt: "Build a dashboard with stat cards, chart placeholder, and sidebar",
  },
];

export default function CanvasTool() {
  const { resolvedColors: T } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState("gemini-flash");
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [activeFile, setActiveFile] = useState<string>("");
  const [previewMode, setPreviewMode] = useState<"code" | "preview">("code");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [memories, setMemories] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages]);

  // Load memories from Supermemory on mount
  useEffect(() => {
    fetch("/api/memory/search?q=canvas+code+build&limit=5")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.memories) {
          setMemories(
            data.memories
              .map(
                (m: { content?: string; memory?: string; chunk?: string }) =>
                  m.content || m.memory || m.chunk || "",
              )
              .filter(Boolean),
          );
        }
      })
      .catch(() => {});
  }, []);

  const extractCode = useCallback(
    (text: string): { cleanText: string; files: GeneratedFile[] } => {
      const files: GeneratedFile[] = [];
      const codeBlockRegex = /```(\w+)?\s*(?:\/\/\s*(.+?)\n)?([\s\S]*?)```/g;
      let match;
      let cleanText = text;

      while ((match = codeBlockRegex.exec(text)) !== null) {
        const language = match[1] || "text";
        const filename =
          match[2] ||
          `generated.${language === "html" ? "html" : language === "css" ? "css" : language === "javascript" || language === "js" ? "js" : "ts"}`;
        const content = match[3].trim();
        files.push({ name: filename, content, language });
        cleanText = cleanText.replace(match[0], `[📄 ${filename}]`);
      }

      return { cleanText, files };
    },
    [],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;
      setInput("");
      setIsLoading(true);

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        ts: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const memoryContext =
          memories.length > 0
            ? `\n\nRELEVANT MEMORIES FROM PREVIOUS SESSIONS:\n${memories.join("\n")}`
            : "";

        const res = await fetch("/api/ai-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              ...messages.slice(-10).map((m) => ({
                role: m.role === "user" ? "user" : "assistant",
                content: m.content,
              })),
              {
                role: "user",
                content: `You are a code builder assistant. Generate clean, working code. Always wrap code in triple backticks with the language specified. If generating HTML, make it a complete standalone file. If multiple files, use comments like // filename.ext before each code block.${memoryContext}\n\nUser request: ${text}`,
              },
            ],
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Request failed");

        // Handle streaming or JSON response
        let responseText = "";
        if (data.text) {
          responseText = data.text;
        } else if (data.response) {
          responseText = data.response;
        } else if (typeof data === "string") {
          responseText = data;
        } else {
          responseText = "I couldn't generate a response.";
        }

        const { cleanText, files } = extractCode(responseText);

        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: cleanText,
          code: files.length > 0 ? files[0].content : undefined,
          language: files.length > 0 ? files[0].language : undefined,
          ts: new Date().toLocaleTimeString(),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        if (files.length > 0) {
          setGeneratedFiles(files);
          setActiveFile(files[0].name);
          setPreviewMode("code");
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `Error: ${err instanceof Error ? err.message : "Failed to get response"}`,
            ts: new Date().toLocaleTimeString(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, messages, extractCode, model, memories],
  );

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const copyCode = () => {
    const file = generatedFiles.find((f) => f.name === activeFile);
    if (file) {
      navigator.clipboard.writeText(file.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const downloadFile = () => {
    const file = generatedFiles.find((f) => f.name === activeFile);
    if (file) {
      const blob = new Blob([file.content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const getPreviewHtml = () => {
    const htmlFile = generatedFiles.find((f) => f.name.endsWith(".html"));
    if (htmlFile) return htmlFile.content;
    const allCode = generatedFiles.map((f) => f.content).join("\n\n");
    return `<!DOCTYPE html><html><head><style>body{font-family:system-ui;padding:20px;background:#0a0a0a;color:#e0e0e0;margin:0}*{box-sizing:border-box}button{cursor:pointer;padding:8px 16px;border:none;border-radius:8px;font-weight:bold}input,textarea{padding:8px;border:1px solid #333;border-radius:8px;background:#111;color:#fff;width:100%;margin:4px 0}.card{background:#141414;border:1px solid #222;border-radius:12px;padding:16px;margin:8px 0}.flex{display:flex;gap:8px;align-items:center}.accent{background:#00f0ff;color:#000}</style></head><body><pre style="white-space:pre-wrap;font-size:13px">${allCode.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`;
  };

  const activeFileContent =
    generatedFiles.find((f) => f.name === activeFile)?.content || "";

  return (
    <div
      className={`flex flex-col ${isFullscreen ? "fixed inset-0 z-[10000]" : "h-full"}`}
      style={{ backgroundColor: T.bgColor }}
    >
      {/* Header with Model Switcher */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
        style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg }}
      >
        <div className="flex items-center gap-3">
          <Wand2 size={16} style={{ color: T.accentColor }} />
          <span className="text-sm font-black" style={{ color: T.headerColor }}>
            Canvas
          </span>
          {memories.length > 0 && (
            <span
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "#a78bfa15", color: "#a78bfa" }}
            >
              <Brain size={10} /> {memories.length} memories
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Model Switcher */}
          <div
            className="flex items-center gap-1 rounded-xl p-1"
            style={{
              backgroundColor: T.bgColor + "60",
              border: `1px solid ${T.borderColor}30`,
            }}
          >
            {MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                style={{
                  backgroundColor:
                    model === m.id ? T.accentColor + "20" : "transparent",
                  color: model === m.id ? T.accentColor : T.textMuted,
                }}
              >
                {m.short}
              </button>
            ))}
          </div>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-lg hover:bg-white/5"
            style={{ color: T.textMuted }}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Chat Panel */}
        <div
          className="flex flex-col border-r w-full md:w-1/2 lg:w-[42%] shrink-0"
          style={{ borderColor: T.borderColor + "20" }}
        >
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{
                    backgroundColor: T.accentColor + "15",
                    border: `1px solid ${T.accentColor}30`,
                  }}
                >
                  <Code size={24} style={{ color: T.accentColor }} />
                </div>
                <h3
                  className="text-base font-black mb-2"
                  style={{ color: T.headerColor }}
                >
                  What do you want to build?
                </h3>
                <p
                  className="text-xs mb-5 max-w-xs"
                  style={{ color: T.textMuted }}
                >
                  Describe it and I&apos;ll generate the code. Chat to refine.
                </p>
                <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
                  {STARTER_TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      onClick={() => setInput(t.prompt)}
                      className="text-left p-2.5 rounded-xl border text-xs font-bold transition-all hover:-translate-y-0.5"
                      style={{
                        backgroundColor: T.boxBg,
                        borderColor: T.borderColor + "25",
                        color: T.textColor,
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] ${msg.role !== "user" ? "w-full" : ""}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {msg.role === "user" ? (
                      <User size={11} style={{ color: T.accentColor }} />
                    ) : msg.role === "system" ? (
                      <Terminal size={11} style={{ color: "#ff4444" }} />
                    ) : (
                      <Bot size={11} style={{ color: "#34d399" }} />
                    )}
                    <span
                      className="text-[9px] font-bold"
                      style={{
                        color:
                          msg.role === "user"
                            ? T.accentColor
                            : msg.role === "system"
                              ? "#ff4444"
                              : "#34d399",
                      }}
                    >
                      {msg.role === "user"
                        ? "You"
                        : msg.role === "system"
                          ? "System"
                          : MODELS.find((m) => m.id === model)?.short || "AI"}
                    </span>
                    <span className="text-[9px]" style={{ color: T.textMuted }}>
                      {msg.ts}
                    </span>
                  </div>
                  <div
                    className="rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
                    style={{
                      backgroundColor:
                        msg.role === "user" ? T.accentColor + "12" : T.boxBg,
                      border: `1px solid ${msg.role === "user" ? T.accentColor + "25" : T.borderColor + "25"}`,
                      color: T.textColor,
                    }}
                  >
                    {msg.content}
                  </div>
                  {msg.code && (
                    <button
                      onClick={() => {
                        const file = generatedFiles.find(
                          (f) => f.content === msg.code,
                        );
                        if (file) {
                          setActiveFile(file.name);
                          setPreviewMode("code");
                        }
                      }}
                      className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all hover:scale-105"
                      style={{
                        backgroundColor: T.accentColor + "15",
                        color: T.accentColor,
                        border: `1px solid ${T.accentColor}30`,
                      }}
                    >
                      <FileCode size={10} /> View code
                    </button>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div
                  className="rounded-xl px-3.5 py-2.5"
                  style={{
                    backgroundColor: T.boxBg,
                    border: `1px solid ${T.borderColor}25`,
                  }}
                >
                  <div
                    className="flex items-center gap-2 text-sm"
                    style={{ color: "#34d399" }}
                  >
                    <Loader2 size={13} className="animate-spin" /> Building...
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Terminal-style Input */}
          <div
            className="p-3 border-t shrink-0"
            style={{
              borderColor: T.borderColor + "20",
              backgroundColor: T.boxBg + "60",
            }}
          >
            <div className="flex gap-2">
              <div
                className="flex-1 flex items-start gap-2 rounded-xl border px-3 py-2.5"
                style={{
                  backgroundColor: T.bgColor + "60",
                  borderColor: T.accentColor + "30",
                }}
              >
                <Terminal
                  size={13}
                  className="mt-0.5 shrink-0"
                  style={{ color: T.accentColor }}
                />
                <textarea
                  ref={inputRef}
                  id="canvas-tool-prompt"
                  name="canvasToolPrompt"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Describe what to build..."
                  rows={1}
                  disabled={isLoading}
                  className="flex-1 min-w-0 bg-transparent text-sm outline-none resize-none"
                  style={{ color: T.textColor }}
                />
              </div>
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isLoading}
                className="rounded-xl px-3.5 shrink-0 flex items-center justify-center transition-all"
                style={{
                  backgroundColor:
                    input.trim() && !isLoading
                      ? T.accentColor
                      : T.borderColor + "30",
                  color: input.trim() && !isLoading ? "#000" : T.textMuted,
                }}
              >
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Code/Preview Panel */}
        <div className="hidden md:flex flex-col flex-1 min-w-0">
          {/* Panel Header */}
          <div
            className="flex items-center justify-between px-3 py-2 border-b shrink-0"
            style={{
              borderColor: T.borderColor + "20",
              backgroundColor: T.boxBg,
            }}
          >
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {generatedFiles.map((file) => (
                <button
                  key={file.name}
                  onClick={() => setActiveFile(file.name)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap"
                  style={{
                    backgroundColor:
                      activeFile === file.name
                        ? T.accentColor + "15"
                        : "transparent",
                    color:
                      activeFile === file.name ? T.accentColor : T.textMuted,
                    border: `1px solid ${activeFile === file.name ? T.accentColor + "30" : "transparent"}`,
                  }}
                >
                  <FileCode size={10} /> {file.name}
                </button>
              ))}
              {generatedFiles.length === 0 && (
                <span className="text-[11px]" style={{ color: T.textMuted }}>
                  No files yet
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setPreviewMode("code")}
                className="p-1.5 rounded-lg"
                style={{
                  backgroundColor:
                    previewMode === "code"
                      ? T.accentColor + "15"
                      : "transparent",
                  color: previewMode === "code" ? T.accentColor : T.textMuted,
                }}
              >
                <Code size={13} />
              </button>
              <button
                onClick={() => setPreviewMode("preview")}
                className="p-1.5 rounded-lg"
                style={{
                  backgroundColor:
                    previewMode === "preview"
                      ? T.accentColor + "15"
                      : "transparent",
                  color:
                    previewMode === "preview" ? T.accentColor : T.textMuted,
                }}
              >
                <Eye size={13} />
              </button>
              {generatedFiles.length > 0 && (
                <>
                  <button
                    onClick={copyCode}
                    className="p-1.5 rounded-lg hover:bg-white/5"
                    style={{ color: T.textMuted }}
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <button
                    onClick={downloadFile}
                    className="p-1.5 rounded-lg hover:bg-white/5"
                    style={{ color: T.textMuted }}
                  >
                    <Download size={13} />
                  </button>
                  <button
                    onClick={() => {
                      const win = window.open("", "_blank");
                      if (win) {
                        win.document.write(getPreviewHtml());
                        win.document.close();
                      }
                    }}
                    className="p-1.5 rounded-lg hover:bg-white/5"
                    style={{ color: T.textMuted }}
                  >
                    <Play size={13} />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Code/Preview Content */}
          <div className="flex-1 overflow-auto">
            {generatedFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{
                    backgroundColor: T.boxBg,
                    border: `1px solid ${T.borderColor}30`,
                  }}
                >
                  <Terminal size={24} style={{ color: T.textMuted }} />
                </div>
                <p className="text-xs" style={{ color: T.textMuted }}>
                  Generated code appears here
                </p>
                <p className="text-[10px] mt-1" style={{ color: T.textMuted }}>
                  Ask me to build something
                </p>
              </div>
            ) : previewMode === "code" ? (
              <pre
                className="h-full overflow-auto p-4 text-xs font-mono leading-relaxed"
                style={{
                  backgroundColor: T.bgColor + "80",
                  color: T.textColor,
                }}
              >
                {activeFileContent}
              </pre>
            ) : (
              <iframe
                srcDoc={getPreviewHtml()}
                className="w-full h-full border-0"
                title="Preview"
                sandbox="allow-scripts"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
