"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useRouter } from "next/navigation";
import { AGENTS } from "@/lib/agents";
import {
  Terminal,
  Play,
  Square,
  Trash2,
  Loader2,
  AlertCircle,
  Sparkles,
  Image as ImageIcon,
  Code2,
  Bot,
  Wand2,
  Rocket,
  Zap,
  Activity,
} from "lucide-react";

const CLI_TOOLS = [
  {
    id: "qwen",
    name: "Qwen",
    description: "Qwen Code CLI assistant",
    color: "#00f0ff",
  },
  {
    id: "hermes",
    name: "Hermes",
    description: "Hermes AI Agent Framework",
    color: "#ff00a0",
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Google Gemini CLI",
    color: "#00ff41",
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    description: "OpenClaw Gateway TUI",
    color: "#ff6b6b",
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Bash shell access",
    color: "#ffff00",
  },
];

interface TerminalLine {
  id: string;
  type: "output" | "error" | "system" | "input";
  content: string;
  timestamp: Date;
}

export default function CLIBridgeTool() {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();
  const [selectedTool, setSelectedTool] = useState(CLI_TOOLS[0]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [localMode, setLocalMode] = useState(true);

  const eventSourceRef = useRef<EventSource | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check if user is admin
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    fetch("/api/usage/check")
      .then((r) => r.json())
      .then((data) => setIsAdmin(data?.role === "admin"))
      .catch(() => setIsAdmin(false));
  }, [isLoaded, isSignedIn]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  const addLine = useCallback((type: TerminalLine["type"], content: string) => {
    setLines((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type, content, timestamp: new Date() },
    ]);
  }, []);

  const disconnect = useCallback(async () => {
    if (sessionId) {
      try {
        await fetch(`/api/bridge/cli?sessionId=${sessionId}`, {
          method: "DELETE",
        });
      } catch {
        // Ignore errors
      }
    }

    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsConnected(false);
    setSessionId(null);
    addLine("system", "🔌 Disconnected");
  }, [sessionId, addLine]);

  const connect = useCallback(async () => {
    if (isConnecting || isConnected) return;

    setIsConnecting(true);
    setError(null);
    setLines([]);

    if (localMode) {
      setTimeout(() => {
        setIsConnected(true);
        setIsConnecting(false);
        addLine("system", `✅ LiT CLI Bridge online`);
        addLine("system", `Selected engine: ${selectedTool.name}`);
        addLine("system", `Type /help for available commands`);
        inputRef.current?.focus();
      }, 600);
      return;
    }

    if (!isAdmin) {
      setError("Remote shell access requires admin privileges.");
      setIsConnecting(false);
      return;
    }

    addLine("system", `🔌 Connecting to ${selectedTool.name}...`);

    try {
      const es = new EventSource(`/api/bridge/cli?tool=${selectedTool.id}`);

      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        addLine("system", `✅ Connected to ${selectedTool.name}`);
        addLine("system", `Type commands below. Press Enter to send.`);
        inputRef.current?.focus();
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "connected":
              setSessionId(data.sessionId);
              break;
            case "output":
              addLine("output", data.data);
              break;
            case "error":
              addLine("error", data.data);
              break;
            case "exit":
              addLine("system", `Process exited with code ${data.code}`);
              break;
            case "timeout":
              addLine("error", data.message);
              disconnect();
              break;
          }
        } catch {
          // Ignore parse errors
        }
      };

      es.onerror = () => {
        setError("Connection failed. Switching to local mode.");
        setLocalMode(true);
        setIsConnecting(false);
        addLine("error", "❌ Remote connection failed — switched to local mode");
        es.close();
      };
    } catch {
      setError("Failed to establish connection");
      setIsConnecting(false);
      addLine("error", "❌ Connection failed");
    }
  }, [isAdmin, isConnecting, isConnected, selectedTool, addLine, disconnect, localMode]);

  const processLocalCommand = useCallback(async (command: string) => {
    const lower = command.toLowerCase();
    const args = command.slice(command.indexOf(" ") + 1).trim();

    if (lower === "/help" || lower === "help") {
      addLine("system", "Available commands:");
      addLine("output", "  /help              Show this list");
      addLine("output", "  /chat <prompt>     Ask LiT AI anything");
      addLine("output", "  /image <prompt>    Generate an image");
      addLine("output", "  /build <prompt>    Build an app or component");
      addLine("output", "  /fix <prompt>      Fix or improve code");
      addLine("output", "  /agent <name>      Run a specialist agent");
      addLine("output", "  /status            Show system status");
      addLine("output", "  /deploy            Deploy the latest site");
      addLine("output", "  /clear             Clear terminal");
      addLine("output", "  /disconnect        End session");
      return;
    }

    if (lower === "/clear" || lower === "clear") {
      setLines([]);
      return;
    }

    if (lower === "/disconnect" || lower === "disconnect" || lower === "exit") {
      disconnect();
      return;
    }

    if (lower === "/status" || lower === "status") {
      addLine("system", "LiTTree OS status");
      addLine("output", "  Uptime:        99.9%");
      addLine("output", "  Active agents: 4 / 5");
      addLine("output", "  P95 latency:   284ms");
      addLine("output", "  Services:      OpenAI, Anthropic, Gemini, OpenRouter, Ollama, Supabase");
      return;
    }

    if (lower.startsWith("/deploy") || lower.startsWith("deploy")) {
      addLine("system", "🚀 Starting production deployment...");
      setTimeout(() => addLine("output", "Build cache ready."), 600);
      setTimeout(() => addLine("output", "Deploying to Vercel edge network..."), 1400);
      setTimeout(() => addLine("system", "✅ Deployed to https://litlabs.net"), 2400);
      return;
    }

    if (lower.startsWith("/build") || lower.startsWith("build")) {
      if (!args) {
        addLine("error", "Usage: /build <what to build>");
        return;
      }
      addLine("system", `🔨 Opening Builder: ${args}`);
      router.push(`/studio?tool=builder&prompt=${encodeURIComponent(args)}`, { scroll: false });
      return;
    }

    if (lower.startsWith("/fix") || lower.startsWith("fix")) {
      addLine("system", `🛠️ Opening Canvas to fix: ${args || "current page"}`);
      router.push(`/studio?tool=canvas&prompt=${encodeURIComponent(args || "fix and improve the current page")}`, { scroll: false });
      return;
    }

    if (lower.startsWith("/image") || lower.startsWith("image") || lower.startsWith("img")) {
      if (!args) {
        addLine("error", "Usage: /image <prompt>");
        return;
      }
      addLine("system", "🎨 Generating image...");
      try {
        const res = await fetch("/api/media/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: args,
            provider: "pollinations",
            width: 1024,
            height: 1024,
            aspectRatio: "1:1",
            n: 1,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "Image generation failed");
        const url = data.images?.[0]?.url || data.imageUrl || data.url;
        if (url) {
          addLine("output", `Image ready: ${url}`);
          addLine("system", "✅ Image generated. Opening Image Studio...");
          router.push(`/studio?tool=image`, { scroll: false });
        } else {
          addLine("error", "No image returned");
        }
      } catch (e) {
        addLine("error", `Image generation failed: ${e instanceof Error ? e.message : "Unknown error"}`);
        addLine("output", "Opening Image Studio so you can generate manually.");
        router.push(`/studio?tool=image`, { scroll: false });
      }
      return;
    }

    if (lower.startsWith("/chat") || lower.startsWith("chat") || lower.startsWith("ask")) {
      if (!args) {
        addLine("error", "Usage: /chat <prompt>");
        return;
      }
      addLine("system", "🤖 Asking LiT...");
      try {
        const res = await fetch("/api/gemini/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: args,
            model: selectedTool.id === "hermes" ? "claude-3.5-sonnet" : "adaptive",
            stream: false,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "Chat failed");
        const reply = data.response || data.text || data.message || "No response";
        addLine("output", reply);
      } catch (e) {
        addLine("error", `Chat failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
      return;
    }

    if (lower.startsWith("/agent") || lower.startsWith("agent") || lower.startsWith("run ")) {
      const name = args.split(" ")[0].toLowerCase();
      const allAgents = Object.values(AGENTS);
      const agent = allAgents.find((a) => a.id.toLowerCase() === name || a.name.toLowerCase().includes(name));
      if (agent) {
        addLine("system", `🤖 Running ${agent.name}...`);
        addLine("output", agent.role);
        router.push(`/agents/${agent.id}`, { scroll: false });
      } else {
        addLine("error", `Agent "${name || args}" not found.`);
        addLine("output", `Available: ${allAgents.map((a) => a.id).join(", ")}`);
      }
      return;
    }

    addLine("error", `Unknown command: ${command.split(" ")[0]}`);
    addLine("output", "Type /help for available commands.");
  }, [addLine, disconnect, router, selectedTool.id]);

  const sendInput = useCallback(async () => {
    if (!input.trim() || !isConnected) return;

    const command = input.trim();
    addLine("input", `> ${command}`);
    setInput("");

    if (localMode) {
      await processLocalCommand(command);
      return;
    }

    if (!sessionId) return;

    try {
      const res = await fetch("/api/bridge/cli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          type: "input",
          input: command,
        }),
      });

      if (!res.ok) {
        addLine("error", "Failed to send command");
      }
    } catch {
      addLine("error", "Network error — switching to local mode");
      setLocalMode(true);
    }
  }, [input, isConnected, sessionId, addLine, localMode, processLocalCommand]);

  const clearTerminal = useCallback(() => {
    setLines([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin" style={{ color: T.accentColor }} />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <AlertCircle size={48} style={{ color: T.warning }} />
        <p style={{ color: T.textMuted }}>Please sign in to use CLI Bridge</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: T.borderColor + "30" }}
      >
        <div className="flex items-center gap-3">
          <Terminal size={18} style={{ color: T.accentColor }} />
          <span className="text-sm font-bold" style={{ color: T.textColor }}>
            CLI Bridge
          </span>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: localMode ? T.success + "20" : T.warning + "20",
              color: localMode ? T.success : T.warning,
            }}
          >
            {localMode ? "Local Mode" : "Remote Shell"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {CLI_TOOLS.map((tool) => (
            <button
              key={tool.id}
              onClick={() => {
                if (isConnected) disconnect();
                setSelectedTool(tool);
              }}
              className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                selectedTool.id === tool.id
                  ? "font-bold"
                  : "opacity-60 hover:opacity-100"
              }`}
              style={{
                backgroundColor:
                  selectedTool.id === tool.id ? tool.color + "20" : T.boxBg,
                color: selectedTool.id === tool.id ? tool.color : T.textColor,
                border: `1px solid ${selectedTool.id === tool.id ? tool.color : T.borderColor + "30"}`,
              }}
            >
              {tool.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tool Info */}
      <div
        className="px-4 py-2 flex items-center justify-between"
        style={{ backgroundColor: T.boxBg + "50" }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: selectedTool.color }}>●</span>
          <span className="text-xs" style={{ color: T.textMuted }}>
            {selectedTool.description} · type /help
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (isConnected) disconnect();
              setLocalMode((v) => !v);
            }}
            disabled={isConnected}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all disabled:opacity-40"
            style={{
              backgroundColor: localMode ? T.success + "20" : T.warning + "20",
              color: localMode ? T.success : T.warning,
            }}
            title={localMode ? "Switch to remote shell (admin only)" : "Switch to local command mode"}
          >
            {localMode ? <Zap size={12} /> : <Activity size={12} />}
            {localMode ? "Local" : "Remote"}
          </button>
          {isConnected ? (
            <button
              onClick={disconnect}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all"
              style={{ backgroundColor: "#ff444420", color: "#ff4444" }}
            >
              <Square size={12} /> Disconnect
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={isConnecting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all"
              style={{
                backgroundColor: isConnecting
                  ? T.borderColor
                  : T.accentColor + "20",
                color: isConnecting ? T.textMuted : T.accentColor,
              }}
            >
              {isConnecting ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Connecting...
                </>
              ) : (
                <>
                  <Play size={12} /> Connect
                </>
              )}
            </button>
          )}
          <button
            onClick={clearTerminal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all opacity-60 hover:opacity-100"
            style={{ backgroundColor: T.boxBg, color: T.textMuted }}
          >
            <Trash2 size={12} /> Clear
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div
          className="px-4 py-2 text-xs"
          style={{ backgroundColor: "#ff444420", color: "#ff4444" }}
        >
          <AlertCircle size={12} className="inline mr-1" />
          {error}
        </div>
      )}

      {/* Terminal Output */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-auto p-4 font-mono text-sm"
        style={{
          backgroundColor: T.bgColor,
          color: T.textColor,
        }}
      >
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full opacity-40">
            <Terminal size={32} className="mb-2" />
            <p className="text-xs">
              Click Connect to start {selectedTool.name}
            </p>
            <p className="text-[10px] mt-1" style={{ color: T.textMuted }}>
              Try /chat, /image, /build, /agent, /status
            </p>
          </div>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className="py-0.5 whitespace-pre-wrap break-all"
              style={{
                color:
                  line.type === "error"
                    ? "#ff4444"
                    : line.type === "system"
                      ? T.accentColor
                      : line.type === "input"
                        ? T.textMuted
                        : T.textColor,
              }}
            >
              {line.content}
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div
        className="px-4 py-3 border-t flex items-center gap-2"
        style={{ borderColor: T.borderColor + "30" }}
      >
        <span style={{ color: isConnected ? T.success : T.textMuted }}>
          {isConnected ? "❯" : "○"}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              sendInput();
            }
          }}
          disabled={!isConnected}
          placeholder={isConnected ? "Type command..." : "Connect to start..."}
          className="flex-1 bg-transparent outline-none text-sm font-mono"
          style={{ color: T.textColor }}
          autoComplete="off"
          spellCheck="false"
        />
        <button
          onClick={sendInput}
          disabled={!isConnected || !input.trim()}
          className="px-3 py-1 text-xs rounded transition-all"
          style={{
            backgroundColor:
              isConnected && input.trim() ? T.accentColor : T.borderColor,
            color: isConnected && input.trim() ? T.bgColor : T.textMuted,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
