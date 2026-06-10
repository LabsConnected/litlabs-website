"use client";
import { useState, useRef, useEffect } from "react";

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

export default function AIBuilder() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [activeTab, setActiveTab] = useState<"chat" | "files" | "preview">("chat");
  const [streamingMessage, setStreamingMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, streamingMessage]);

  const systemPrompt = `You are the LitLabs Hive Mind -- an AI architect and code generator. You help build and improve the LitLabs platform.

RULES:
- Generate complete, working Next.js/TypeScript/TSX code
- Use Tailwind CSS with "Volcanic Cyber" theme (dark bg #0a0a0f, orange-500 accents, neon glow effects)
- Define proper TypeScript interfaces for all props -- NO "any" types
- Use "use client" directive only for interactive components
- Mobile-first responsive design
- Use @/ alias for imports
- Add smooth Tailwind animations
- Keep components atomic and reusable

When the user asks you to build something:
1. Describe what you're building
2. Generate the complete code
3. Explain key design decisions

Be technically precise. Think like a senior full-stack developer.`;

  const sendMessage = async () => {
    if (!input.trim() || isBuilding) return;

    const userMessage: Message = { role: "user", content: input, timestamp: new Date().toLocaleTimeString() };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsBuilding(true);
    setStreamingMessage("");

    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
          systemPrompt,
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
              } catch { /* skip */ }
            }
          }
        }
      }

      if (fullText) {
        setMessages(prev => [...prev, { role: "assistant", content: fullText, timestamp: new Date().toLocaleTimeString() }]);
        setStreamingMessage("");

        // Try to extract code blocks and create generated files
        const codeBlocks = fullText.match(/```tsx?\n([\s\S]*?)```/g);
        if (codeBlocks) {
          const newFiles: GeneratedFile[] = codeBlocks.map((block, i) => {
            const code = block.replace(/```tsx?\n/, "").replace(/```$/, "");
            const pathMatch = fullText.match(new RegExp(`src/[^\\s]+\\.tsx`, "g"));
            return {
              path: pathMatch?.[i] || `src/components/generated-${Date.now()}.tsx`,
              code,
              status: "generated" as const,
            };
          });
          setGeneratedFiles(prev => [...prev, ...newFiles]);
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `⚠️ Error: ${e instanceof Error ? e.message : "Connection failed"}. Check that GOOGLE_API_KEY is set.`,
        timestamp: new Date().toLocaleTimeString(),
      }]);
      setStreamingMessage("");
    }

    setIsBuilding(false);
  };

  const quickPrompts = [
    "Build a Volcanic Cyber themed hero section with animated particles",
    "Create a dashboard sidebar with agent status indicators",
    "Build a pricing card component with glowing neon effects",
    "Create an AI chat interface with streaming message bubbles",
    "Build a real-time activity feed component",
    "Create a settings page with toggle switches and form inputs",
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0a0a0f]/95 backdrop-blur-md px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧠</span>
            <div>
              <h1 className="text-lg font-extrabold">AI Page Builder</h1>
              <p className="text-[10px] text-zinc-500">Powered by Gemini 2.0 Flash</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(["chat", "files", "preview"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === tab
                    ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                    : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                }`}
              >
                {tab === "chat" ? "💬 Chat" : tab === "files" ? `📁 Files (${generatedFiles.length})` : "👁️ Preview"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Quick Prompts Sidebar */}
        <div className="w-64 border-r border-white/5 bg-white/[0.01] p-3 hidden lg:block overflow-y-auto">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Quick Prompts</div>
          <div className="space-y-1.5">
            {quickPrompts.map((prompt, i) => (
              <button
                key={i}
                onClick={() => setInput(prompt)}
                className="w-full text-left p-2 rounded-lg border border-white/5 bg-white/[0.01] text-xs text-zinc-400 hover:text-white hover:border-orange-500/20 hover:bg-orange-500/5 transition-all"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Main Area */}
        <div className="flex-1 flex flex-col">
          {activeTab === "chat" && (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                  <div className="text-center py-16">
                    <div className="text-6xl mb-4">🧠</div>
                    <h2 className="text-xl font-bold mb-2">Hive Mind AI Builder</h2>
                    <p className="text-sm text-zinc-500 max-w-md mx-auto">
                      Describe what you want to build and I'll generate the code.
                      Try a quick prompt from the sidebar or type your own.
                    </p>
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-xl p-4 ${
                      msg.role === "user"
                        ? "bg-orange-500/20 border border-orange-500/30"
                        : "bg-white/[0.03] border border-white/10"
                    }`}>
                      <div className="text-[10px] text-zinc-500 mb-1">{msg.role === "user" ? "You" : "🧠 Hive Mind"} • {msg.timestamp}</div>
                      <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                ))}
                {streamingMessage && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-xl p-4 bg-white/[0.03] border border-white/10">
                      <div className="text-[10px] text-zinc-500 mb-1">🧠 Hive Mind</div>
                      <div className="text-sm whitespace-pre-wrap">{streamingMessage}<span className="animate-pulse">▊</span></div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="border-t border-white/10 p-4">
                <div className="max-w-4xl mx-auto flex gap-2">
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    placeholder="Describe what you want to build..."
                    className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20"
                    disabled={isBuilding}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={isBuilding || !input.trim()}
                    className="rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isBuilding ? "⏳" : "🚀"}
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === "files" && (
            <div className="flex-1 overflow-y-auto p-4">
              {generatedFiles.length === 0 ? (
                <div className="text-center py-16 text-zinc-500">
                  <div className="text-4xl mb-4">📁</div>
                  <p>No files generated yet. Start a conversation to generate code.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {generatedFiles.map((file, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.01]">
                        <span className="text-xs font-mono text-orange-400">{file.path}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          file.status === "generated" ? "bg-green-500/20 text-green-400" :
                          file.status === "applied" ? "bg-blue-500/20 text-blue-400" :
                          "bg-red-500/20 text-red-400"
                        }`}>{file.status}</span>
                      </div>
                      <pre className="p-4 text-xs font-mono text-zinc-300 overflow-x-auto max-h-64">{file.code}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "preview" && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="text-center py-16 text-zinc-500">
                <div className="text-4xl mb-4">👁️</div>
                <p>Preview generated components here.</p>
                <p className="text-xs mt-2">Generated files: {generatedFiles.length}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
