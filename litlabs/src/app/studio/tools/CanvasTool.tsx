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
  { label: "Landing Page", prompt: "Build a modern landing page with hero, features grid, and CTA button" },
  { label: "React Counter", prompt: "Create a React counter with increment, decrement, and reset" },
  { label: "Todo App", prompt: "Build a todo app with add, delete, and mark complete" },
  { label: "Dashboard", prompt: "Build a dashboard with stat cards, chart placeholder, and sidebar" },
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  // Load memories from Supermemory on mount
  useEffect(() => {
    fetch("/api/memory/search?q=canvas+code+build&limit=5")
      .then((r) => r.json())
      .then((data) => {
        if (data.results) {
          setMemories(data.results.map((m: { memory?: string; chunk?: string }) => m.memory || m.chunk || "").filter(Boolean));
        }
      })
      .catch(() => {});
  }, []);

  const extractCode = useCallback((text: string): { cleanText: string; files: GeneratedFile[] } => {
    const files: GeneratedFile[] = [];
    const codeBlockRegex = /```(\w+)?\s*(?:\/\/\s*(.+?)\n)?([\s\S]*?)```/g;
    let match;
    let cleanText = text;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      const language = match[1] || "text";
      const filename = match[2] || `generated.${language === "html" ? "html" : language === "css" ? "css" : language === "javascript" || language === "js" ? "js" : "ts"}`;
      const content = match[3].trim();
      files.push({ name: filename, content, language });
      cleanText = cleanText.replace(match[0], `[📄 ${filename}]`);
    }

    return { cleanText, files };
  }, []);

  const fallbackResponse = useCallback((text: string): { response: string; files: GeneratedFile[] } => {
    const lower = text.toLowerCase();
    const files: GeneratedFile[] = [];
    let response = "I generated a fallback starter for you. Add your AI API key to get full custom code.\n\n";

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Generated App</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; }
    .container { max-width: 960px; margin: 0 auto; }
    h1 { color: #38bdf8; margin-bottom: 16px; }
    .card { background: #141414; border: 1px solid #222; border-radius: 12px; padding: 20px; margin: 12px 0; }
    button { background: #38bdf8; color: #000; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-weight: bold; }
    button:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Generated App</h1>
    <div class="card">
      <p>This is a fallback starter generated while the AI model is unavailable.</p>
      <p>Prompt: ${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
      <button onclick="alert('Hello from LiTTree Canvas!')">Try me</button>
    </div>
  </div>
</body>
</html>`;

    if (lower.includes("dashboard")) {
      html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; }
    .sidebar { width: 240px; height: 100vh; background: #111; border-right: 1px solid #222; padding: 20px; position: fixed; }
    .sidebar h2 { color: #38bdf8; margin-bottom: 24px; }
    .sidebar a { display: block; color: #94a3b8; text-decoration: none; padding: 10px 0; }
    .main { margin-left: 240px; padding: 24px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat { background: #141414; border: 1px solid #222; border-radius: 12px; padding: 20px; }
    .stat h3 { font-size: 12px; color: #94a3b8; text-transform: uppercase; }
    .stat p { font-size: 28px; font-weight: 800; color: #38bdf8; margin-top: 8px; }
    .chart { background: #141414; border: 1px solid #222; border-radius: 12px; padding: 20px; height: 240px; display: flex; align-items: center; justify-content: center; color: #475569; }
  </style>
</head>
<body>
  <div class="sidebar">
    <h2>LiTTree</h2>
    <a href="#">Dashboard</a>
    <a href="#">Analytics</a>
    <a href="#">Projects</a>
    <a href="#">Settings</a>
  </div>
  <div class="main">
    <h1 style="margin-bottom: 20px;">Dashboard</h1>
    <div class="stats">
      <div class="stat"><h3>Users</h3><p>1,248</p></div>
      <div class="stat"><h3>Revenue</h3><p>$12.4k</p></div>
      <div class="stat"><h3>Tasks</h3><p>86</p></div>
      <div class="stat"><h3>Uptime</h3><p>99.9%</p></div>
    </div>
    <div class="chart">Chart placeholder</div>
  </div>
</body>
</html>`;
      response = "Generated a fallback dashboard starter. Add your AI API key to get fully custom code.\n\n";
    } else if (lower.includes("landing page") || lower.includes("landing")) {
      html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Landing Page</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 20px 40px; border-bottom: 1px solid #222; }
    .logo { font-weight: 800; color: #38bdf8; }
    nav a { color: #94a3b8; margin-left: 24px; text-decoration: none; }
    .hero { text-align: center; padding: 100px 20px; }
    .hero h1 { font-size: 48px; margin-bottom: 16px; }
    .hero p { color: #94a3b8; max-width: 500px; margin: 0 auto 28px; }
    .cta { background: #38bdf8; color: #000; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; }
    .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; padding: 60px 40px; max-width: 1000px; margin: 0 auto; }
    .feature { background: #141414; border: 1px solid #222; border-radius: 12px; padding: 24px; }
  </style>
</head>
<body>
  <header><div class="logo">LiTTree</div><nav><a href="#">Features</a><a href="#">Pricing</a><a href="#">About</a></nav></header>
  <section class="hero">
    <h1>Build faster.</h1>
    <p>Create, deploy, and ship your ideas with AI-powered tools.</p>
    <a href="#" class="cta">Get started</a>
  </section>
  <section class="features">
    <div class="feature"><h3>Fast</h3><p>Ship in minutes, not weeks.</p></div>
    <div class="feature"><h3>Smart</h3><p>AI handles the heavy lifting.</p></div>
    <div class="feature"><h3>Free</h3><p>Start without a credit card.</p></div>
  </section>
</body>
</html>`;
      response = "Generated a fallback landing page starter. Add your AI API key to get fully custom code.\n\n";
    } else if (lower.includes("todo")) {
      html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Todo App</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .app { width: 360px; background: #141414; border: 1px solid #222; border-radius: 16px; padding: 24px; }
    h1 { color: #38bdf8; margin-bottom: 16px; }
    .input-row { display: flex; gap: 8px; margin-bottom: 16px; }
    input { flex: 1; background: #0a0a0a; border: 1px solid #222; color: #fff; padding: 10px; border-radius: 8px; }
    button { background: #38bdf8; color: #000; border: none; padding: 10px 16px; border-radius: 8px; cursor: pointer; font-weight: bold; }
    ul { list-style: none; }
    li { display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #222; }
    li.done span { text-decoration: line-through; color: #475569; }
  </style>
</head>
<body>
  <div class="app">
    <h1>Todo</h1>
    <div class="input-row"><input id="task" placeholder="Add a task" /><button onclick="add()">Add</button></div>
    <ul id="list"></ul>
  </div>
  <script>
    const list = document.getElementById('list');
    const input = document.getElementById('task');
    function add() { if (!input.value.trim()) return; const li = document.createElement('li'); li.innerHTML = '<span onclick="this.parentElement.classList.toggle(\'done\')">' + input.value + '</span><button onclick="this.parentElement.remove()">x</button>'; list.appendChild(li); input.value = ''; }
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') add(); });
  </script>
</body>
</html>`;
      response = "Generated a fallback todo app starter. Add your AI API key to get fully custom code.\n\n";
    } else if (lower.includes("counter")) {
      html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Counter</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #141414; border: 1px solid #222; border-radius: 16px; padding: 40px; text-align: center; }
    h1 { color: #38bdf8; margin-bottom: 16px; }
    #count { font-size: 48px; font-weight: 800; margin: 16px 0; }
    button { background: #38bdf8; color: #000; border: none; padding: 12px 20px; border-radius: 8px; margin: 0 6px; cursor: pointer; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Counter</h1>
    <div id="count">0</div>
    <button onclick="setCount(-1)">-</button>
    <button onclick="setCount(0)">Reset</button>
    <button onclick="setCount(1)">+</button>
  </div>
  <script>let c = 0; function setCount(n) { c = n === 0 ? 0 : c + n; document.getElementById('count').textContent = c; }</script>
</body>
</html>`;
      response = "Generated a fallback counter starter. Add your AI API key to get fully custom code.\n\n";
    }

    files.push({ name: "index.html", content: html, language: "html" });
    return { response, files };
  }, []);

  const sendMessage = useCallback(async (text: string) => {
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
      const memoryContext = memories.length > 0
        ? `\n\nRELEVANT MEMORIES FROM PREVIOUS SESSIONS:\n${memories.join("\n")}`
        : "";

      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: "forge",
          message: `You are a code builder assistant. Generate clean, working code, then explain what it does and how to use it.

Rules:
- Wrap code in triple backticks with the language specified (e.g. \`\`\`tsx).
- If multiple files, use comments like // filename.ext before each code block.
- If generating HTML, make it a complete standalone file.
- After the code block, explain in 2-4 sentences what the component does.
- Then provide a "How to use" section with a concrete import example and any props.

${memoryContext}

User request: ${text}`,
          stream: false,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");

      let responseText = "";
      if (data.response) {
        responseText = data.response;
      } else if (data.text) {
        responseText = data.text;
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
    } catch {
      // Fallback: generate a local starter template so the tool never errors
      const { response, files } = fallbackResponse(text);
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response + "[📄 index.html]",
        code: files[0]?.content,
        language: "html",
        ts: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setGeneratedFiles(files);
      setActiveFile(files[0]?.name || "");
      setPreviewMode("code");
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, extractCode, memories, fallbackResponse]);

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

  const activeFileContent = generatedFiles.find((f) => f.name === activeFile)?.content || "";

  return (
    <div className={`flex flex-col ${isFullscreen ? "fixed inset-0 z-50" : "h-full"}`} style={{ backgroundColor: T.bgColor }}>
      {/* Header with Model Switcher */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0" style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg }}>
        <div className="flex items-center gap-3">
          <Wand2 size={16} style={{ color: T.accentColor }} />
          <span className="text-sm font-black" style={{ color: T.headerColor }}>Canvas</span>
          {memories.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: "#a78bfa15", color: "#a78bfa" }}>
              <Brain size={10} /> {memories.length} memories
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Model Switcher */}
          <div className="flex items-center gap-1 rounded-xl p-1" style={{ backgroundColor: T.bgColor + "60", border: `1px solid ${T.borderColor}30` }}>
            {MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                style={{
                  backgroundColor: model === m.id ? T.accentColor + "20" : "transparent",
                  color: model === m.id ? T.accentColor : T.textMuted,
                }}
              >
                {m.short}
              </button>
            ))}
          </div>
          <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: T.textMuted }}>
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Chat Panel */}
        <div className="flex flex-col border-r w-full md:w-1/2 lg:w-[42%] shrink-0" style={{ borderColor: T.borderColor + "20" }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: T.accentColor + "15", border: `1px solid ${T.accentColor}30` }}>
                  <Code size={24} style={{ color: T.accentColor }} />
                </div>
                <h3 className="text-base font-black mb-2" style={{ color: T.headerColor }}>What do you want to build?</h3>
                <p className="text-xs mb-5 max-w-xs" style={{ color: T.textMuted }}>
                  Describe it and I&apos;ll generate the code. Chat to refine.
                </p>
                <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
                  {STARTER_TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      onClick={() => setInput(t.prompt)}
                      className="text-left p-2.5 rounded-xl border text-xs font-bold transition-all hover:-translate-y-0.5"
                      style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "25", color: T.textColor }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[90%] ${msg.role !== "user" ? "w-full" : ""}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {msg.role === "user" ? <User size={11} style={{ color: T.accentColor }} /> : msg.role === "system" ? <Terminal size={11} style={{ color: "#ff4444" }} /> : <Bot size={11} style={{ color: "#34d399" }} />}
                    <span className="text-[9px] font-bold" style={{ color: msg.role === "user" ? T.accentColor : msg.role === "system" ? "#ff4444" : "#34d399" }}>
                      {msg.role === "user" ? "You" : msg.role === "system" ? "System" : MODELS.find((m) => m.id === model)?.short || "AI"}
                    </span>
                    <span className="text-[9px]" style={{ color: T.textMuted }}>{msg.ts}</span>
                  </div>
                  <div
                    className="rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
                    style={{
                      backgroundColor: msg.role === "user" ? T.accentColor + "12" : T.boxBg,
                      border: `1px solid ${msg.role === "user" ? T.accentColor + "25" : T.borderColor + "25"}`,
                      color: T.textColor,
                    }}
                  >
                    {msg.content}
                  </div>
                  {msg.code && (
                    <button
                      onClick={() => {
                        const file = generatedFiles.find((f) => f.content === msg.code);
                        if (file) { setActiveFile(file.name); setPreviewMode("code"); }
                      }}
                      className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all hover:scale-105"
                      style={{ backgroundColor: T.accentColor + "15", color: T.accentColor, border: `1px solid ${T.accentColor}30` }}
                    >
                      <FileCode size={10} /> View code
                    </button>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="rounded-xl px-3.5 py-2.5" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}25` }}>
                  <div className="flex items-center gap-2 text-sm" style={{ color: "#34d399" }}>
                    <Loader2 size={13} className="animate-spin" /> Building...
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Terminal-style Input */}
          <div className="p-3 border-t shrink-0" style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg + "60" }}>
            <div className="flex gap-2">
              <div className="flex-1 flex items-start gap-2 rounded-xl border px-3 py-2.5" style={{ backgroundColor: T.bgColor + "60", borderColor: T.accentColor + "30" }}>
                <Terminal size={13} className="mt-0.5 shrink-0" style={{ color: T.accentColor }} />
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
                style={{ backgroundColor: input.trim() && !isLoading ? T.accentColor : T.borderColor + "30", color: input.trim() && !isLoading ? "#000" : T.textMuted }}
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>

        {/* Code/Preview Panel */}
        <div className="hidden md:flex flex-col flex-1 min-w-0">
          {/* Panel Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b shrink-0" style={{ borderColor: T.borderColor + "20", backgroundColor: T.boxBg }}>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {generatedFiles.map((file) => (
                <button
                  key={file.name}
                  onClick={() => setActiveFile(file.name)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap"
                  style={{ backgroundColor: activeFile === file.name ? T.accentColor + "15" : "transparent", color: activeFile === file.name ? T.accentColor : T.textMuted, border: `1px solid ${activeFile === file.name ? T.accentColor + "30" : "transparent"}` }}
                >
                  <FileCode size={10} /> {file.name}
                </button>
              ))}
              {generatedFiles.length === 0 && <span className="text-[11px]" style={{ color: T.textMuted }}>No files yet</span>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setPreviewMode("code")} className="p-1.5 rounded-lg" style={{ backgroundColor: previewMode === "code" ? T.accentColor + "15" : "transparent", color: previewMode === "code" ? T.accentColor : T.textMuted }}>
                <Code size={13} />
              </button>
              <button onClick={() => setPreviewMode("preview")} className="p-1.5 rounded-lg" style={{ backgroundColor: previewMode === "preview" ? T.accentColor + "15" : "transparent", color: previewMode === "preview" ? T.accentColor : T.textMuted }}>
                <Eye size={13} />
              </button>
              {generatedFiles.length > 0 && (
                <>
                  <button onClick={copyCode} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: T.textMuted }}>
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <button onClick={downloadFile} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: T.textMuted }}>
                    <Download size={13} />
                  </button>
                  <button onClick={() => { const win = window.open("", "_blank"); if (win) { win.document.write(getPreviewHtml()); win.document.close(); } }} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: T.textMuted }}>
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
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: T.boxBg, border: `1px solid ${T.borderColor}30` }}>
                  <Terminal size={24} style={{ color: T.textMuted }} />
                </div>
                <p className="text-xs" style={{ color: T.textMuted }}>Generated code appears here</p>
                <p className="text-[10px] mt-1" style={{ color: T.textMuted }}>Ask me to build something</p>
              </div>
            ) : previewMode === "code" ? (
              <pre className="h-full overflow-auto p-4 text-xs font-mono leading-relaxed" style={{ backgroundColor: T.bgColor + "80", color: T.textColor }}>
                {activeFileContent}
              </pre>
            ) : (
              <iframe srcDoc={getPreviewHtml()} className="w-full h-full border-0" title="Preview" sandbox="allow-scripts" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
