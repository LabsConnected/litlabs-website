"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { CODE_MODELS as MODELS } from "@/lib/studio-models";
import { useProjectCanvas, type SaveStatus } from "../hooks/useProjectCanvas";
import {
  Bot,
  Copy,
  Download,
  Eye,
  Code,
  FileCode,
  FilePlus,
  Loader2,
  Check,
  Send,
  Terminal,
  Trash2,
  User,
  Wand2,
  Maximize2,
  Minimize2,
  Play,
  Brain,
  RotateCcw,
  CloudOff,
  AlertCircle,
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

const BUILD_INTENTS = [
  { label: "Landing Page", prompt: "Build a modern landing page with hero, features, pricing, and footer" },
  { label: "Dashboard", prompt: "Build a responsive dashboard with stat cards, sidebar, and data table" },
  { label: "SaaS App", prompt: "Build a SaaS marketing site with features, pricing tiers, and signup CTA" },
  { label: "Portfolio", prompt: "Build a portfolio website with project showcase, about, and contact form" },
  { label: "Store", prompt: "Build a product storefront with product grid, cart icon, and product cards" },
  { label: "Blog", prompt: "Build a blog layout with article list, featured post, and newsletter signup" },
  { label: "Admin Panel", prompt: "Build an admin panel with sidebar navigation, data table, and stats" },
  { label: "Custom", prompt: "" },
];

const QUALITY_LEVELS = [
  { id: "draft", label: "Fast Draft", desc: "Quick structure, basic styles" },
  { id: "polished", label: "Polished", desc: "Refined, responsive, accessible" },
  { id: "premium", label: "Premium", desc: "Custom visuals, animation, branded" },
  { id: "production", label: "Production", desc: "Tests, types, deployment-ready" },
];

const PERSIST_MSG_KEY = "litlabs:canvas:messages";

interface CanvasToolProps {
  projectId?: string | null;
  projectName?: string | null;
}

export default function CanvasTool({ projectId, projectName }: CanvasToolProps) {
  const { resolvedColors: T } = useTheme();
  const {
    files: generatedFiles,
    setFiles: setGeneratedFiles,
    activeFile,
    setActiveFile,
    previewMode,
    setPreviewMode,
    qualityLevel,
    setQualityLevel,
    saveStatus,
    isScratch,
    clearAll: clearCanvas,
    lastSavedAt,
  } = useProjectCanvas({ projectId, projectName });

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModel] = useState("gemini-flash");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [memories, setMemories] = useState<string[]>([]);
  const [selectedIntent, setSelectedIntent] = useState("");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load persisted messages on mount (messages stay in localStorage for now —
  // they are conversation history, not project files)
  useEffect(() => {
    try {
      const savedMsgs = localStorage.getItem(PERSIST_MSG_KEY);
      if (savedMsgs) {
        const msgs = JSON.parse(savedMsgs) as Message[];
        if (msgs.length > 0) setMessages(msgs);
      }
    } catch { /* ignore corrupt storage */ }
  }, []);

  // Persist messages when they change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(PERSIST_MSG_KEY, JSON.stringify(messages.slice(-20)));
    }
  }, [messages]);

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

        const qualityPrompt = QUALITY_LEVELS.find((q) => q.id === qualityLevel);
        const qualityInstruction = qualityPrompt
          ? `\nQuality level: ${qualityPrompt.label} — ${qualityPrompt.desc}.`
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
                content: `You are a code builder assistant. Generate clean, working code. Always wrap code in triple backticks with the language specified. If generating HTML, make it a complete standalone file. If multiple files, use comments like // filename.ext before each code block.${qualityInstruction}${memoryContext}\n\nUser request: ${text}`,
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
    [isLoading, messages, extractCode, model, memories, qualityLevel],
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
    const cssFile = generatedFiles.find((f) => f.name.endsWith(".css"));
    const jsFile = generatedFiles.find(
      (f) => f.name.endsWith(".js") && !f.name.endsWith(".test.js"),
    );

    if (htmlFile) {
      let html = htmlFile.content;
      if (cssFile) {
        const styleTag = `<style>\n${cssFile.content}\n</style>`;
        if (html.includes("</head>")) {
          html = html.replace("</head>", `${styleTag}\n</head>`);
        } else if (html.includes("<body")) {
          html = html.replace(/<body/, `${styleTag}\n<body`);
        } else {
          html = styleTag + "\n" + html;
        }
      }
      if (jsFile) {
        const scriptTag = `<script>\n${jsFile.content}\n</script>`;
        if (html.includes("</body>")) {
          html = html.replace("</body>", `${scriptTag}\n</body>`);
        } else {
          html = html + "\n" + scriptTag;
        }
      }
      return html;
    }

    const allCode = generatedFiles.map((f) => f.content).join("\n\n");
    return `<!DOCTYPE html><html><head><style>body{font-family:system-ui;padding:20px;background:#0a0a0a;color:#e0e0e0;margin:0}*{box-sizing:border-box}button{cursor:pointer;padding:8px 16px;border:none;border-radius:8px;font-weight:bold}input,textarea{padding:8px;border:1px solid #333;border-radius:8px;background:#111;color:#fff;width:100%;margin:4px 0}.card{background:#141414;border:1px solid #222;border-radius:12px;padding:16px;margin:8px 0}.flex{display:flex;gap:8px;align-items:center}.accent{background:#00f0ff;color:#000}</style></head><body><pre style="white-space:pre-wrap;font-size:13px">${allCode.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`;
  };

  const downloadAllAsZip = () => {
    if (generatedFiles.length === 0) return;
    const readme = `# Generated Project\n\nGenerated by LiTT via LiTTree LabStudios.\n\n## Files\n\n${generatedFiles.map((f) => `- \`${f.name}\``).join("\n")}\n\n## Setup\n\n1. Open \`index.html\` in your browser, or\n2. Serve the directory with any static server\n\n## Commands\n\n\`\`\`bash\nnpx serve .\n# or\npython -m http.server 8000\n\`\`\`\n\nGenerated on ${new Date().toISOString()}\n`;

    const files = [...generatedFiles, { name: "README.md", content: readme, language: "markdown" }];
    const blob = new Blob([files.map((f) => `// ${f.name}\n${f.content}`).join("\n\n---\n\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `litlabs-project-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeFileContent =
    generatedFiles.find((f) => f.name === activeFile)?.content || "";

  const deleteFile = useCallback(
    (fileName: string) => {
      setGeneratedFiles((prev) => {
        const next = prev.filter((f) => f.name !== fileName);
        if (activeFile === fileName) {
          setActiveFile(next.length > 0 ? next[0].name : "");
        }
        return next;
      });
    },
    [activeFile, setGeneratedFiles, setActiveFile],
  );

  const startNew = useCallback(() => {
    clearCanvas();
    setMessages([]);
    setInput("");
    setSelectedIntent("");
    localStorage.removeItem(PERSIST_MSG_KEY);
  }, [clearCanvas]);

  const createBlankFile = useCallback(() => {
    const name = `untitled-${Date.now()}.html`;
    const newFile: GeneratedFile = { name, content: "<!DOCTYPE html>\n<html>\n<head>\n  <meta charset=\"utf-8\">\n  <title>Untitled</title>\n</head>\n<body>\n  \n</body>\n</html>", language: "html" };
    setGeneratedFiles((prev) => [...prev, newFile]);
    setActiveFile(name);
    setPreviewMode("code");
  }, []);

  return (
    <div
      className={`flex flex-col min-h-0 ${isFullscreen ? "fixed inset-0 z-10000" : "h-full"}`}
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
          {isScratch && (
            <span
              className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: "#f59e0b15", color: "#f59e0b" }}
              title="No project selected — changes will not be saved to a project"
            >
              <AlertCircle size={9} /> Temporary draft
            </span>
          )}
          <SaveStatusIndicator status={saveStatus} lastSavedAt={lastSavedAt} />
          <button
            onClick={startNew}
            title="Start fresh — clear all files and chat"
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all hover:scale-105"
            style={{
              backgroundColor: T.accentColor + "10",
              color: T.accentColor,
              border: `1px solid ${T.accentColor}25`,
            }}
          >
            <RotateCcw size={10} /> New
          </button>
          <button
            onClick={createBlankFile}
            title="Add a blank HTML file"
            className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all hover:scale-105"
            style={{
              backgroundColor: T.boxBg,
              color: T.textMuted,
              border: `1px solid ${T.borderColor}25`,
            }}
          >
            <FilePlus size={10} /> File
          </button>
          {memories.length > 0 && (
            <span
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "#a78bfa15", color: "#a78bfa" }}
            >
              <Brain size={10} /> {memories.length} {memories.length === 1 ? "memory" : "memories"}
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
          className="flex flex-col min-h-0 border-r w-full md:w-1/2 lg:w-[42%] shrink-0"
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
                  className="text-xs mb-4 max-w-xs"
                  style={{ color: T.textMuted }}
                >
                  Describe it and I&apos;ll generate the code. Chat to refine.
                </p>

                {/* Build Intent Presets */}
                <div className="flex flex-wrap gap-1.5 justify-center mb-3 max-w-sm">
                  {BUILD_INTENTS.map((intent) => (
                    <button
                      key={intent.label}
                      onClick={() => {
                        setSelectedIntent(intent.label);
                        if (intent.prompt) {
                          setInput(intent.prompt);
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all hover:scale-105"
                      style={{
                        backgroundColor:
                          selectedIntent === intent.label
                            ? T.accentColor + "20"
                            : T.boxBg,
                        border: `1px solid ${selectedIntent === intent.label ? T.accentColor + "40" : T.borderColor + "25"}`,
                        color:
                          selectedIntent === intent.label
                            ? T.accentColor
                            : T.textColor,
                      }}
                    >
                      {intent.label}
                    </button>
                  ))}
                </div>

                {/* Quality Level Selector */}
                <div className="flex gap-1.5 mb-4">
                  {QUALITY_LEVELS.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => setQualityLevel(q.id)}
                      title={q.desc}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                      style={{
                        backgroundColor:
                          qualityLevel === q.id
                            ? T.accentColor + "20"
                            : "transparent",
                        border: `1px solid ${qualityLevel === q.id ? T.accentColor + "40" : T.borderColor + "20"}`,
                        color:
                          qualityLevel === q.id ? T.accentColor : T.textMuted,
                      }}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>

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
        <div className="hidden md:flex flex-col flex-1 min-h-0 min-w-0">
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
                <div
                  key={file.name}
                  className="group flex items-center gap-0.5 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap"
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
                  <button
                    onClick={() => setActiveFile(file.name)}
                    className="flex items-center gap-1 px-2.5 py-1"
                  >
                    <FileCode size={10} /> {file.name}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFile(file.name);
                    }}
                    title={`Delete ${file.name}`}
                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20"
                    style={{ color: "#ef4444" }}
                  >
                    <Trash2 size={9} />
                  </button>
                </div>
              ))}
              {generatedFiles.length === 0 && (
                <span className="text-[11px]" style={{ color: T.textMuted }}>
                  No files yet
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* Device preview switcher */}
              {previewMode === "preview" && generatedFiles.length > 0 && (
                <div className="flex items-center gap-0.5 mr-1 rounded-lg p-0.5" style={{ backgroundColor: T.bgColor + "40" }}>
                  {(["desktop", "tablet", "mobile"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setPreviewDevice(d)}
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold transition-all"
                      style={{
                        backgroundColor: previewDevice === d ? T.accentColor + "20" : "transparent",
                        color: previewDevice === d ? T.accentColor : T.textMuted,
                      }}
                    >
                      {d.charAt(0).toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
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
                    title="Download current file"
                    className="p-1.5 rounded-lg hover:bg-white/5"
                    style={{ color: T.textMuted }}
                  >
                    <Download size={13} />
                  </button>
                  <button
                    onClick={downloadAllAsZip}
                    title="Download all files"
                    className="p-1.5 rounded-lg hover:bg-white/5"
                    style={{ color: T.textMuted }}
                  >
                    <FileCode size={13} />
                  </button>
                  <button
                    onClick={() => {
                      const win = window.open("", "_blank");
                      if (win) {
                        win.document.write(getPreviewHtml());
                        win.document.close();
                      }
                    }}
                    title="Open in new tab"
                    className="p-1.5 rounded-lg hover:bg-white/5"
                    style={{ color: T.textMuted }}
                  >
                    <Play size={13} />
                  </button>
                  <button
                    onClick={startNew}
                    title="Delete all files and start fresh"
                    className="p-1.5 rounded-lg hover:bg-red-500/10"
                    style={{ color: "#ef4444" }}
                  >
                    <Trash2 size={13} />
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
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={createBlankFile}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all hover:scale-105"
                    style={{
                      backgroundColor: T.accentColor + "10",
                      color: T.accentColor,
                      border: `1px solid ${T.accentColor}25`,
                    }}
                  >
                    <FilePlus size={11} /> New blank file
                  </button>
                </div>
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
              <div className="flex justify-center h-full bg-neutral-950 p-2">
                <iframe
                  srcDoc={getPreviewHtml()}
                  className="border-0 transition-all"
                  title="Preview"
                  sandbox="allow-scripts"
                  style={{
                    width: previewDevice === "mobile" ? "375px" : previewDevice === "tablet" ? "768px" : "100%",
                    height: "100%",
                    borderRadius: previewDevice === "desktop" ? "0" : "8px",
                    boxShadow: previewDevice === "desktop" ? "none" : "0 0 20px rgba(0,0,0,0.3)",
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Save Status Indicator ────────────────────────────────────

function SaveStatusIndicator({ status, lastSavedAt }: { status: SaveStatus; lastSavedAt: string | null }) {
  const config: Record<SaveStatus, { icon: React.ReactNode; label: string; color: string }> = {
    idle: { icon: null, label: "", color: "" },
    loading: { icon: <Loader2 size={10} className="animate-spin" />, label: "Loading", color: "#888" },
    saving: { icon: <Loader2 size={10} className="animate-spin" />, label: "Saving", color: "#3b82f6" },
    saved: { icon: <Check size={10} />, label: "Saved", color: "#22c55e" },
    conflict: { icon: <AlertCircle size={10} />, label: "Conflict", color: "#f59e0b" },
    offline: { icon: <CloudOff size={10} />, label: "Offline", color: "#ef4444" },
    failed: { icon: <AlertCircle size={10} />, label: "Failed", color: "#ef4444" },
  };

  const c = config[status];
  if (!c.icon) return null;

  const title = lastSavedAt && status === "saved"
    ? `Saved at ${new Date(lastSavedAt).toLocaleTimeString()}`
    : c.label;

  return (
    <span
      className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold"
      style={{ backgroundColor: c.color + "15", color: c.color }}
      title={title}
    >
      {c.icon}
      {c.label}
    </span>
  );
}
