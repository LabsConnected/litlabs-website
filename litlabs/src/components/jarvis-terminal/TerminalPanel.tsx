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
import { useUser } from "@clerk/nextjs";
import {
  Maximize2,
  Minimize2,
  RotateCcw,
  Trash2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
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
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const { user, isLoaded } = useUser();
  const userId = user?.id ?? "anonymous";
  const [sessionId] = useState(() => `session-${Date.now()}`);
  const reconnectRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!containerRef.current || !isLoaded) return;

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

    term.writeln("\x1b[1;32m🔥 LiTTree OS Terminal\x1b[0m");
    term.writeln("\x1b[1;30mReal shell. Real power. AI-backed.\x1b[0m");
    term.writeln("");
    term.writeln("\x1b[33mConnecting to terminal server...\x1b[0m");

    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL ||
      process.env.NEXT_PUBLIC_TERMINAL_WS_URL ||
      "http://localhost:4001";
    const token = user ? String(user.id) : undefined;
    const connect = () => {
      setConnectionError(null);
      const socket = io(wsUrl, {
        auth: { userId, sessionId, token },
        transports: ["websocket", "polling"],
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        setConnected(true);
        setConnectionError(null);
        onConnectionChange?.(true);
        term.writeln("\x1b[32m✅ Connected to terminal server\x1b[0m");
        onLog?.("[WS] Connected to terminal server");
      });

      socket.on("connect_error", (err) => {
        setConnected(false);
        setConnectionError(err.message);
        onConnectionChange?.(false);
        term.writeln(`\x1b[31m❌ Connection error: ${err.message}\x1b[0m`);
        onLog?.(`[WS] Error: ${err.message}`);
      });

      socket.on("disconnect", (reason) => {
        setConnected(false);
        onConnectionChange?.(false);
        term.writeln(`\x1b[31m❌ Disconnected: ${reason}\x1b[0m`);
        onLog?.(`[WS] Disconnected: ${reason}`);
      });

      return socket;
    };

    const socket = connect();
    reconnectRef.current = () => {
      socket.disconnect();
      connect();
    };

    socket.on("session:ready", ({ sessionId: sid }) => {
      term.writeln(`\x1b[36mℹ Session ready: ${sid.slice(0, 8)}...\x1b[0m`);
      onLog?.(`[SESSION] Ready ${sid.slice(0, 8)}...`);
    });

    socket.on("terminal:output", (data: string) => {
      term.write(data);
      outputBufferRef.current += data;
      if (outputBufferRef.current.length > 4000) {
        outputBufferRef.current = outputBufferRef.current.slice(-4000);
      }
      onTerminalOutput?.(outputBufferRef.current);
    });

    socket.on("terminal:error", (msg: string) => {
      term.writeln(`\x1b[31m⚠ ${msg}\x1b[0m`);
      outputBufferRef.current += `\n⚠ ${msg}`;
      onLog?.(`[ERROR] ${msg}`);
    });

    term.onData((data) => {
      if (data === "\r") {
        const cmd = commandBufferRef.current.trim();
        if (cmd) {
          onCommand?.(cmd);
          if (cmd.startsWith("lit ")) {
            socket.emit("lit:command", cmd);
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
      socket.emit("terminal:input", data);
    });

    const resize = () => {
      fit.fit();
      socket.emit("terminal:resize", {
        cols: term.cols,
        rows: term.rows,
      });
    };

    window.addEventListener("resize", resize);
    resize();

    return () => {
      window.removeEventListener("resize", resize);
      socket.disconnect();
      term.dispose();
    };
  }, [
    isLoaded,
    user,
    userId,
    sessionId,
    onLog,
    onCommand,
    onConnectionChange,
    onTerminalOutput,
  ]);

  useImperativeHandle(ref, () => ({
    insertCommand: (cmd: string) => {
      const term = termRef.current;
      const socket = socketRef.current;
      if (!term || !socket) return;
      term.write(cmd);
      commandBufferRef.current = cmd;
    },
    runCommand: (cmd: string) => {
      const term = termRef.current;
      const socket = socketRef.current;
      if (!term || !socket) return;
      term.write(cmd + "\r");
      socket.emit("terminal:input", cmd + "\r");
      commandBufferRef.current = "";
    },
  }));

  const resetTerminal = () => {
    termRef.current?.clear();
    termRef.current?.writeln("\x1b[1;32m🔥 LiTTree OS LiT Terminal\x1b[0m");
  };

  const clearTerminal = () => {
    termRef.current?.clear();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded bg-orange-600/20 px-3 py-1 text-orange-400 font-bold">
            bash
          </span>
          <span className="rounded bg-neutral-900 px-3 py-1 text-neutral-400">
            node
          </span>
          <span className="rounded bg-neutral-900 px-3 py-1 text-neutral-400">
            docker
          </span>
          <span
            className={`rounded px-3 py-1 text-xs font-bold ${connected ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}
          >
            {connected ? "Online" : "Offline"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {connectionError && (
            <>
              <span className="hidden items-center gap-1 text-xs text-red-400 sm:flex">
                <AlertTriangle className="h-3.5 w-3.5" /> {connectionError}
              </span>
              <button
                onClick={() => reconnectRef.current()}
                title="Reconnect"
                className="rounded p-1.5 text-orange-400 hover:bg-neutral-800 hover:text-orange-300"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </>
          )}
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

      {connectionError && (
        <div className="flex items-center justify-between gap-2 border-b border-red-900/30 bg-red-950/20 px-4 py-2 text-xs text-red-400 sm:hidden">
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> {connectionError}
          </span>
          <button
            onClick={() => reconnectRef.current()}
            className="font-bold text-orange-400 hover:text-orange-300"
          >
            Reconnect
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className={`flex-1 overflow-hidden p-3 ${fullScreen ? "fixed inset-0 z-[100] h-screen w-screen bg-black" : ""}`}
      />
    </div>
  );
});
