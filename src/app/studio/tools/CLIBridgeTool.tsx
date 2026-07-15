"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  Terminal,
  Play,
  Square,
  Trash2,
  Loader2,
  AlertCircle,
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
  const [selectedTool, setSelectedTool] = useState(CLI_TOOLS[0]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (!isSignedIn || isConnecting || isConnected) return;

    setIsConnecting(true);
    setError(null);
    setLines([]);
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
        setError("Connection failed. Make sure you're authorized.");
        setIsConnected(false);
        setIsConnecting(false);
        addLine("error", "❌ Connection error");
        es.close();
      };
    } catch {
      setError("Failed to establish connection");
      setIsConnecting(false);
      addLine("error", "❌ Connection failed");
    }
  }, [
    isSignedIn,
    isConnecting,
    isConnected,
    selectedTool,
    addLine,
    disconnect,
  ]);

  const sendInput = useCallback(async () => {
    if (!input.trim() || !isConnected || !sessionId) return;

    const command = input.trim();
    addLine("input", `> ${command}`);
    setInput("");

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
      addLine("error", "Network error");
    }
  }, [input, isConnected, sessionId, addLine]);

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
              backgroundColor: T.accentColor + "20",
              color: T.accentColor,
            }}
          >
            Authenticated
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
                selectedTool.id === tool.id ? "font-bold" : ""
              }`}
              style={{
                backgroundColor:
                  selectedTool.id === tool.id ? tool.color + "20" : T.boxBg,
                color: selectedTool.id === tool.id ? tool.color : T.textMuted,
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
            {selectedTool.description}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <button
              onClick={disconnect}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all"
              style={{ backgroundColor: T.warning + "20", color: T.warning }}
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all"
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
          style={{ backgroundColor: T.warning + "20", color: T.warning }}
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
          <div
            className="flex flex-col items-center justify-center h-full"
            style={{ color: T.textMuted }}
          >
            <Terminal size={32} className="mb-2" />
            <p className="text-xs">
              Click Connect to start {selectedTool.name}
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
          id="cli-bridge-input"
          name="cli-bridge-input"
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
