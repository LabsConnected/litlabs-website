"use client";

import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { io, Socket } from "socket.io-client";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { getTerminalToken } from "@/lib/terminal-client";
import { Maximize2, Minimize2, Plug, RotateCcw, Trash2 } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  onLog?: (entry: string) => void;
  onCommand?: (cmd: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  onTerminalOutput?: (output: string) => void;
}

export interface TerminalPanelHandle {
  insertCommand: (cmd: string) => void;
  runCommand: (cmd: string) => void;
}

export const TerminalPanel = forwardRef<
  TerminalPanelHandle,
  TerminalPanelProps
>(function TerminalPanel(
  { onLog, onCommand, onConnectionChange, onTerminalOutput },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const commandBufferRef = useRef<string>("");
  const outputBufferRef = useRef<string>("");
  const [connected, setConnected] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{ sessionId: string; cwd: string; shell: string } | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const { isLoaded, isSignedIn } = useClerkAuth();

  useEffect(() => {
    if (!containerRef.current || !isLoaded || !isSignedIn) return;
    let disposed = false;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "JetBrains Mono, Consolas, monospace",
      theme: {
        background: "#000000",
        foreground: "#f8f8f2",
        cursor: "#ff6a00",
        black: "#000000",
        red: "#ff5555",
        green: "#50fa7b",
        yellow: "#f1fa8c",
        blue: "#8be9fd",
        magenta: "#ff79c6",
        cyan: "#8be9fd",
        white: "#bbbbbb",
        brightBlack: "#444444",
        brightRed: "#ff6a6a",
        brightGreen: "#69f0ae",
        brightYellow: "#ffffa5",
        brightBlue: "#6dd5fa",
        brightMagenta: "#ff9de6",
        brightCyan: "#a6f7ff",
        brightWhite: "#ffffff",
      },
      scrollback: 10000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitAddonRef.current = fit;

    term.writeln("\x1b[1;32m🔥 LiTT Terminal\x1b[0m");
    term.writeln("\x1b[1;30mReal shell. Real power. AI-backed.\x1b[0m");
    term.writeln("");
    term.writeln("\x1b[33mConnecting to terminal server...\x1b[0m");

    const wsUrl =
      process.env.NEXT_PUBLIC_TERMINAL_WS_URL || "http://localhost:4001";
    const resize = () => {
      fit.fit();
      socketRef.current?.emit("terminal:resize", {
        cols: term.cols,
        rows: term.rows,
      });
    };

    void getTerminalToken()
      .then((token) => {
        if (disposed) return;
        const connectedSocket = io(wsUrl, {
          auth: { token },
          transports: ["websocket", "polling"],
          reconnectionAttempts: 5,
        });

        socketRef.current = connectedSocket;

        connectedSocket.on("connect", () => {
          setConnected(true);
          onConnectionChange?.(true);
          term.writeln("\x1b[32m✅ Connected to terminal server\x1b[0m");
          onLog?.("[WS] Connected to terminal server");
        });

        connectedSocket.on("disconnect", (reason) => {
          setConnected(false);
          onConnectionChange?.(false);
          term.writeln(`\x1b[31m❌ Disconnected: ${reason}\x1b[0m`);
          onLog?.(`[WS] Disconnected: ${reason}`);
        });

        connectedSocket.on("session:ready", ({ sessionId: sid, cwd = "Unknown workspace", shell = "Unknown shell" }) => {
          setSessionInfo({ sessionId: sid, cwd, shell });
          term.writeln(`\x1b[36mℹ Session ready: ${sid.slice(0, 8)}...\x1b[0m`);
          onLog?.(`[SESSION] Ready ${sid.slice(0, 8)}...`);
        });

        connectedSocket.on("terminal:output", (data: string) => {
          term.write(data);
          outputBufferRef.current += data;
          if (outputBufferRef.current.length > 4000) {
            outputBufferRef.current = outputBufferRef.current.slice(-4000);
          }
          onTerminalOutput?.(outputBufferRef.current);
        });

        connectedSocket.on("terminal:error", (msg: string) => {
          term.writeln(`\x1b[31m⚠ ${msg}\x1b[0m`);
          outputBufferRef.current += `\n⚠ ${msg}`;
          onLog?.(`[ERROR] ${msg}`);
        });

        term.onData((data) => {
          if (data === "\r") {
            const cmd = commandBufferRef.current.trim();
            if (cmd) {
              onCommand?.(cmd);
              if (cmd.startsWith("litt ")) {
                connectedSocket.emit("litt:command", cmd);
                commandBufferRef.current = "";
                return;
              }
            }
            commandBufferRef.current = "";
          } else if (data === "\u007f") {
            commandBufferRef.current = commandBufferRef.current.slice(0, -1);
          } else if (data === "\u0003") {
            commandBufferRef.current = "";
          } else {
            commandBufferRef.current += data;
          }
          socketRef.current?.emit("terminal:input", data);
        });

        window.addEventListener("resize", resize);
        resize();
      })
      .catch((error) => {
        const message =
          error instanceof Error
            ? error.message
            : "Terminal authentication failed";
        term.writeln(`\x1b[31m❌ ${message}\x1b[0m`);
        onLog?.(`[AUTH] ${message}`);
      });

    return () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      socketRef.current?.disconnect();
      term.dispose();
    };
  }, [
    isLoaded,
    isSignedIn,
    onLog,
    onCommand,
    onConnectionChange,
    onTerminalOutput,
  ]);

  useImperativeHandle(ref, () => ({
    insertCommand: (cmd: string) => {
      const term = termRef.current;
      const socket = socketRef.current;
      if (!term || !socket?.connected) return;
      term.write(cmd);
      commandBufferRef.current = cmd;
    },
    runCommand: (cmd: string) => {
      const term = termRef.current;
      const socket = socketRef.current;
      if (!term || !socket?.connected) return;
      term.write(cmd + "\r");
      socket.emit("terminal:input", cmd + "\r");
      commandBufferRef.current = "";
    },
  }));

  const resetTerminal = () => {
    termRef.current?.clear();
    termRef.current?.writeln("\x1b[1;32m🔥 LiTT Terminal\x1b[0m");
  };

  const clearTerminal = () => {
    termRef.current?.clear();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="min-w-0 text-sm">
          <span
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-bold ${connected ? "bg-green-500/20 text-green-400" : "bg-amber-500/15 text-amber-300"}`}
          >
            <Plug size={10} /> {connected ? "Real PTY connected" : "Real PTY disconnected"}
          </span>
          {connected && sessionInfo && <div className="mt-1 truncate text-[9px] text-neutral-500">Workspace: {sessionInfo.cwd} · Shell: {sessionInfo.shell}</div>}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={resetTerminal}
            title="Reset"
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            onClick={clearTerminal}
            title="Clear"
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setFullScreen((s) => !s)}
            title="Toggle fullscreen"
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            {fullScreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`flex-1 overflow-hidden p-3 ${fullScreen ? "fixed inset-0 z-[10000] h-screen w-screen bg-black" : ""}`}
      />
    </div>
  );
});
