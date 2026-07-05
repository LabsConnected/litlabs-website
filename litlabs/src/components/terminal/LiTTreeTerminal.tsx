"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { RefreshCw } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { AGENTS } from "@/lib/agents";
import { TERMINAL_THEME, ANSI } from "./terminal-theme";
import { TerminalToolbar } from "./TerminalToolbar";
import type {
  ConnectionStatus,
  LiTTreeTerminalProps,
  TerminalTab,
  AgentAction,
} from "./terminal-types";

const AgentSidebar = lazy(() => import("./AgentSidebar"));

/* ─── Types ─────────────────────────────────────────────────────────────── */

export type LiTTreeTerminalHandle = {
  insertCommand: (cmd: string) => void;
  runCommand: (cmd: string) => void;
};

/* ─── ANSI → React spans ─────────────────────────────────────────────────── */

const ANSI_COLOR_MAP: Record<string, string> = {
  "30": "#1a1a2e",
  "31": TERMINAL_THEME.xterm.red,
  "32": TERMINAL_THEME.xterm.green,
  "33": TERMINAL_THEME.xterm.yellow,
  "34": TERMINAL_THEME.xterm.blue,
  "35": TERMINAL_THEME.xterm.magenta,
  "36": TERMINAL_THEME.xterm.cyan,
  "37": TERMINAL_THEME.xterm.white,
  "90": TERMINAL_THEME.ui.textMuted,
  "91": TERMINAL_THEME.xterm.brightRed,
  "92": TERMINAL_THEME.xterm.brightGreen,
  "93": TERMINAL_THEME.xterm.brightYellow,
  "94": TERMINAL_THEME.xterm.brightBlue,
  "95": TERMINAL_THEME.xterm.brightMagenta,
  "96": TERMINAL_THEME.xterm.brightCyan,
  "97": TERMINAL_THEME.xterm.brightWhite,
};

function ansiToSpans(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentStyle: React.CSSProperties = {};
  let key = 0;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++} style={currentStyle}>
          {text.slice(lastIndex, match.index)}
        </span>,
      );
    }

    const codes = match[1].split(";");
    const newStyle: React.CSSProperties = { ...currentStyle };
    for (const code of codes) {
      if (code === "0" || code === "") {
        Object.keys(newStyle).forEach(
          (k) => delete (newStyle as Record<string, unknown>)[k],
        );
      } else if (code === "1") {
        newStyle.fontWeight = "bold";
      } else if (code === "2") {
        newStyle.opacity = 0.6;
      } else if (ANSI_COLOR_MAP[code]) {
        newStyle.color = ANSI_COLOR_MAP[code];
      } else if (code === "45") {
        newStyle.backgroundColor = TERMINAL_THEME.ui.accent;
        newStyle.color = "#fff";
      }
    }
    currentStyle = newStyle;
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(
      <span key={key++} style={currentStyle}>
        {text.slice(lastIndex)}
      </span>,
    );
  }

  return parts.length > 0 ? parts : [<span key={0}>{text}</span>];
}

/* ─── Demo command handlers ──────────────────────────────────────────────── */

const PROMPT = `${ANSI.cyan}littree${ANSI.reset}${ANSI.dim}@studio${ANSI.reset}:${ANSI.green}~${ANSI.reset}$ `;

function buildDemoOutput(cmd: string): string {
  const trimmed = cmd.trim().toLowerCase();
  const [base, ...args] = trimmed.split(/\s+/);

  const T = TERMINAL_THEME;
  const hr = `${ANSI.dim}${"─".repeat(52)}${ANSI.reset}`;

  switch (base) {
    case "help":
      return [
        `${ANSI.bold}${ANSI.magenta}LiTTree Terminal — Available Commands${ANSI.reset}`,
        hr,
        `  ${ANSI.cyan}help${ANSI.reset}      — show this help`,
        `  ${ANSI.cyan}agents${ANSI.reset}    — list AI agents and their status`,
        `  ${ANSI.cyan}status${ANSI.reset}    — system status overview`,
        `  ${ANSI.cyan}scan${ANSI.reset}      — scan project structure`,
        `  ${ANSI.cyan}deploy${ANSI.reset}    — deployment instructions`,
        `  ${ANSI.cyan}whoami${ANSI.reset}    — show user info`,
        `  ${ANSI.cyan}version${ANSI.reset}   — show platform version`,
        `  ${ANSI.cyan}clear${ANSI.reset}     — clear terminal`,
        hr,
        `${ANSI.dim}Tip: switch to ${ANSI.reset}${ANSI.yellow}real${ANSI.reset}${ANSI.dim} mode for a full shell.${ANSI.reset}`,
      ].join("\n");

    case "agents": {
      const agentList = Object.values(AGENTS);
      const lines = [
        `${ANSI.bold}${ANSI.magenta}LiTTree Agents${ANSI.reset}  (${agentList.length} active)`,
        hr,
      ];
      for (const agent of agentList) {
        const dot =
          agent.status === "online"
            ? `${ANSI.green}●${ANSI.reset}`
            : agent.status === "busy"
              ? `${ANSI.yellow}●${ANSI.reset}`
              : `${ANSI.red}●${ANSI.reset}`;
        lines.push(
          `  ${dot} ${ANSI.bold}${agent.name}${ANSI.reset}  ${ANSI.dim}[${agent.tag}]${ANSI.reset}  — ${agent.role}`,
        );
        lines.push(
          `      ${ANSI.dim}domains: ${agent.domains.slice(0, 4).join(", ")}${ANSI.reset}`,
        );
      }
      return lines.join("\n");
    }

    case "status":
      return [
        `${ANSI.bold}${ANSI.cyan}System Status${ANSI.reset}`,
        hr,
        `  ${ANSI.green}●${ANSI.reset} Next.js 16 App Router    ${ANSI.green}online${ANSI.reset}`,
        `  ${ANSI.green}●${ANSI.reset} Supabase PostgreSQL       ${ANSI.green}online${ANSI.reset}`,
        `  ${ANSI.green}●${ANSI.reset} Gemini 2.5 Flash LLM     ${ANSI.green}online${ANSI.reset}`,
        `  ${ANSI.green}●${ANSI.reset} Clerk Auth                ${ANSI.green}online${ANSI.reset}`,
        `  ${ANSI.yellow}●${ANSI.reset} Terminal WebSocket        ${ANSI.yellow}demo mode${ANSI.reset}`,
        `  ${ANSI.green}●${ANSI.reset} Cloudflare R2             ${ANSI.green}online${ANSI.reset}`,
        hr,
        `  Uptime: ${ANSI.green}99.9%${ANSI.reset}  |  Build: ${ANSI.cyan}production${ANSI.reset}`,
      ].join("\n");

    case "scan":
      return [
        `${ANSI.bold}${ANSI.yellow}Scanning project…${ANSI.reset}`,
        hr,
        `  ${ANSI.cyan}src/app/${ANSI.reset}           — Next.js pages & API routes`,
        `  ${ANSI.cyan}src/components/${ANSI.reset}    — React components`,
        `  ${ANSI.cyan}src/lib/${ANSI.reset}           — Core libraries & agents`,
        `  ${ANSI.cyan}src/hooks/${ANSI.reset}         — Custom React hooks`,
        `  ${ANSI.cyan}src/context/${ANSI.reset}       — React context providers`,
        `  ${ANSI.cyan}terminal-server/${ANSI.reset}   — Express + Socket.IO backend`,
        hr,
        `  Files: ${ANSI.green}247${ANSI.reset}  |  TS errors: ${ANSI.green}0${ANSI.reset}  |  Coverage: ${ANSI.yellow}—${ANSI.reset}`,
        `${ANSI.dim}Scan complete.${ANSI.reset}`,
      ].join("\n");

    case "deploy":
      return [
        `${ANSI.bold}${ANSI.magenta}Deploy Instructions${ANSI.reset}`,
        hr,
        `  1. ${ANSI.cyan}pnpm build${ANSI.reset}       — production build`,
        `  2. ${ANSI.cyan}pnpm check${ANSI.reset}       — lint + typecheck + build`,
        `  3. Push to ${ANSI.green}main${ANSI.reset} → Vercel auto-deploys`,
        "",
        `  ${ANSI.yellow}Or run:${ANSI.reset} vercel --prod`,
        hr,
        `  Domain: ${ANSI.cyan}https://litlabs.net${ANSI.reset}`,
      ].join("\n");

    case "whoami":
      return [
        `${ANSI.bold}${ANSI.cyan}Current User${ANSI.reset}`,
        hr,
        `  Shell: ${ANSI.green}LiTTree Demo Terminal${ANSI.reset}`,
        `  Mode:  ${ANSI.yellow}demo${ANSI.reset} (read-only sandbox)`,
        `  Host:  ${ANSI.cyan}studio.litlabs.net${ANSI.reset}`,
        `${ANSI.dim}Switch to real mode for full shell access.${ANSI.reset}`,
      ].join("\n");

    case "version":
      return [
        `${ANSI.bold}${ANSI.magenta}LiTTree LabStudios${ANSI.reset}`,
        hr,
        `  Platform:   ${ANSI.cyan}Next.js 16 (App Router)${ANSI.reset}`,
        `  Language:   ${ANSI.cyan}TypeScript 5${ANSI.reset}`,
        `  Styling:    ${ANSI.cyan}Tailwind CSS v4${ANSI.reset}`,
        `  AI Engine:  ${ANSI.cyan}Google Gemini 2.5 Flash${ANSI.reset}`,
        `  Terminal:   ${ANSI.cyan}xterm.js v6 / LiTTree Demo v1.0${ANSI.reset}`,
        `  Node:       ${ANSI.cyan}>= 22${ANSI.reset}`,
      ].join("\n");

    case "":
      return "";

    default:
      return `${ANSI.red}command not found: ${ANSI.reset}${ANSI.bold}${base}${ANSI.reset}\n${ANSI.dim}Type ${ANSI.reset}${ANSI.cyan}help${ANSI.reset}${ANSI.dim} for available commands.${ANSI.reset}`;
  }
}

/* ─── Demo Terminal ──────────────────────────────────────────────────────── */

interface DemoTerminalProps {
  outputLines: Array<{ id: number; content: string; isInput?: boolean }>;
  inputValue: string;
  onInputChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  outputRef: React.RefObject<HTMLDivElement | null>;
}

function DemoTerminal({
  outputLines,
  inputValue,
  onInputChange,
  onKeyDown,
  inputRef,
  outputRef,
}: DemoTerminalProps) {
  return (
    <div
      className="flex flex-col h-full w-full overflow-hidden cursor-text"
      style={{
        backgroundColor: TERMINAL_THEME.ui.bg,
        fontFamily: TERMINAL_THEME.font.family,
        fontSize: TERMINAL_THEME.font.size,
        lineHeight: TERMINAL_THEME.font.lineHeight,
        color: TERMINAL_THEME.xterm.foreground,
      }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* Output area */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-0"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: `${TERMINAL_THEME.ui.border} transparent`,
        }}
      >
        {outputLines.map((line) => (
          <div
            key={line.id}
            className="whitespace-pre-wrap wrap-break-word leading-snug min-h-[1.4em]"
          >
            {line.isInput ? (
              <span>
                {ansiToSpans(PROMPT)}
                <span style={{ color: TERMINAL_THEME.xterm.foreground }}>
                  {line.content}
                </span>
              </span>
            ) : (
              ansiToSpans(line.content)
            )}
          </div>
        ))}
      </div>

      {/* Input line */}
      <div
        className="flex items-center px-3 py-1.5 shrink-0"
        style={{ borderTop: `1px solid ${TERMINAL_THEME.ui.border}22` }}
      >
        <span className="shrink-0 mr-1">{ansiToSpans(PROMPT)}</span>
        <div className="relative flex-1 flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 bg-transparent outline-none border-none caret-transparent"
            style={{
              color: TERMINAL_THEME.xterm.foreground,
              fontFamily: TERMINAL_THEME.font.family,
              fontSize: TERMINAL_THEME.font.size,
              caretColor: "transparent",
            }}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          {/* Custom blinking cursor */}
          <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} } .littree-cursor{animation:blink 1.1s step-end infinite}`}</style>
          <span
            className="littree-cursor absolute top-0 bottom-0 w-[2px] pointer-events-none"
            style={{
              backgroundColor: TERMINAL_THEME.xterm.cursor,
              left: `${inputValue.length}ch`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Real xterm Terminal ────────────────────────────────────────────────── */

interface RealTerminalProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  connectionStatus: ConnectionStatus;
  onReconnect: () => void;
}

function RealTerminal({
  containerRef,
  connectionStatus,
  onReconnect,
}: RealTerminalProps) {
  return (
    <div
      className="relative flex-1 w-full h-full overflow-hidden"
      style={{ backgroundColor: TERMINAL_THEME.ui.bg }}
    >
      <div ref={containerRef} className="w-full h-full" />
      {connectionStatus === "error" || connectionStatus === "offline" ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3"
          style={{ backgroundColor: TERMINAL_THEME.ui.bg + "cc" }}
        >
          <p className="text-sm" style={{ color: TERMINAL_THEME.ui.error }}>
            {connectionStatus === "error" ? "Connection error" : "Disconnected"}
          </p>
          <button
            className="flex items-center gap-2 px-4 py-2 rounded text-sm transition-colors"
            style={{
              backgroundColor: TERMINAL_THEME.ui.accent + "22",
              border: `1px solid ${TERMINAL_THEME.ui.accent}`,
              color: TERMINAL_THEME.ui.accent,
            }}
            onClick={onReconnect}
          >
            <RefreshCw size={14} />
            Reconnect
          </button>
        </div>
      ) : connectionStatus === "connecting" ? (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ backgroundColor: TERMINAL_THEME.ui.bg + "aa" }}
        >
          <p className="text-sm" style={{ color: TERMINAL_THEME.ui.textMuted }}>
            Connecting to terminal…
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Tab helpers ─────────────────────────────────────────────────────────── */

let tabCounter = 1;
function makeTab(type = "demo"): TerminalTab {
  tabCounter += 1;
  return {
    id: `tab-${tabCounter}`,
    label: `Terminal ${tabCounter}`,
    type,
    active: false,
  };
}

/* ─── Main Component ─────────────────────────────────────────────────────── */

export const LiTTreeTerminal = forwardRef<
  LiTTreeTerminalHandle,
  LiTTreeTerminalProps
>(function LiTTreeTerminal(
  {
    mode,
    showAgentSidebar = false,
    projectName,
    initialCommands,
    className = "",
    onCommand,
    onConnectionChange,
  },
  ref,
) {
  /* ── Tabs ─────────────────────────────────────────────────────────────── */
  const [tabs, setTabs] = useState<TerminalTab[]>([
    {
      id: "tab-1",
      label: projectName ?? "Terminal 1",
      type: mode,
      active: true,
    },
  ]);
  const [activeTab, setActiveTab] = useState("tab-1");

  const handleTabChange = useCallback((id: string) => setActiveTab(id), []);
  const handleAddTab = useCallback(() => {
    const tab = makeTab(mode);
    setTabs((prev) => [...prev, tab]);
    setActiveTab(tab.id);
  }, [mode]);
  const handleCloseTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length === 1) return prev;
        const next = prev.filter((t) => t.id !== id);
        if (id === activeTab) setActiveTab(next[next.length - 1].id);
        return next;
      });
    },
    [activeTab],
  );

  /* ── Fullscreen ───────────────────────────────────────────────────────── */
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  /* ── Agent Sidebar ────────────────────────────────────────────────────── */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleAgentAction = useCallback(
    (action: AgentAction) => {
      if (action.command) handleRunCommand(action.command);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleAgentMessage = useCallback((msg: string) => {
    handleRunCommand(msg);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Demo mode state ──────────────────────────────────────────────────── */
  const [outputLines, setOutputLines] = useState<
    Array<{ id: number; content: string; isInput?: boolean }>
  >(() => [
    {
      id: 0,
      content: [
        `${ANSI.bold}${ANSI.magenta}LiTTree Terminal${ANSI.reset}  ${ANSI.dim}v1.0${ANSI.reset}`,
        `${ANSI.dim}Type ${ANSI.reset}${ANSI.cyan}help${ANSI.reset}${ANSI.dim} for available commands.${ANSI.reset}`,
        "",
      ].join("\n"),
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const demoInputRef = useRef<HTMLInputElement>(null);
  const outputScrollRef = useRef<HTMLDivElement>(null);
  const lineId = useRef(1);

  const addLine = useCallback((content: string, isInput = false) => {
    setOutputLines((prev) => [
      ...prev,
      { id: lineId.current++, content, isInput },
    ]);
  }, []);

  useEffect(() => {
    const el = outputScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [outputLines]);

  const handleRunCommand = useCallback(
    (cmd: string) => {
      const trimmed = cmd.trim();
      if (trimmed === "clear") {
        setOutputLines([]);
        return;
      }
      addLine(trimmed, true);
      onCommand?.(trimmed);
      const out = buildDemoOutput(trimmed);
      if (out) addLine(out);
    },
    [addLine, onCommand],
  );

  const handleDemoKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        const cmd = inputValue;
        setHistory((h) => (cmd.trim() ? [cmd, ...h.slice(0, 99)] : h));
        setHistoryIndex(-1);
        setInputValue("");
        handleRunCommand(cmd);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHistoryIndex((i) => {
          const next = Math.min(i + 1, history.length - 1);
          setInputValue(history[next] ?? "");
          return next;
        });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHistoryIndex((i) => {
          const next = Math.max(i - 1, -1);
          setInputValue(next === -1 ? "" : (history[next] ?? ""));
          return next;
        });
      }
    },
    [inputValue, history, handleRunCommand],
  );

  /* ── Real mode state ──────────────────────────────────────────────────── */
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    mode === "real" ? "connecting" : "connected",
  );
  const xtermContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const socketRef = useRef<import("socket.io-client").Socket | null>(null);
  const { user } = useUser();

  const updateStatus = useCallback(
    (s: ConnectionStatus) => {
      setConnectionStatus(s);
      onConnectionChange?.(s);
    },
    [onConnectionChange],
  );

  useEffect(() => {
    if (mode !== "real") return;

    let destroyed = false;

    async function init() {
      const [{ Terminal }, { FitAddon }, { io }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("socket.io-client"),
      ]);

      if (destroyed || !xtermContainerRef.current) return;

      const term = new Terminal({
        theme: TERMINAL_THEME.xterm,
        fontFamily: TERMINAL_THEME.font.family,
        fontSize: TERMINAL_THEME.font.size,
        lineHeight: TERMINAL_THEME.font.lineHeight,
        cursorBlink: true,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(xtermContainerRef.current);
      fitAddon.fit();
      xtermRef.current = term;

      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
        } catch {}
      });
      resizeObserver.observe(xtermContainerRef.current);

      const wsUrl =
        process.env.NEXT_PUBLIC_TERMINAL_WS_URL || "http://localhost:4001";

      updateStatus("connecting");
      const socket = io(wsUrl, {
        auth: { token: user?.id ?? "anonymous" },
        transports: ["websocket"],
      });
      socketRef.current = socket;

      socket.on("connect", () => updateStatus("connected"));
      socket.on("disconnect", () => updateStatus("offline"));
      socket.on("connect_error", () => updateStatus("error"));

      socket.on("session:ready", () => {
        term.focus();
        if (initialCommands?.length) {
          initialCommands.forEach((cmd) =>
            socket.emit("terminal:input", cmd + "\n"),
          );
        }
      });

      socket.on("terminal:output", (data: string) => term.write(data));
      socket.on("terminal:error", (err: string) =>
        term.write(`\r\n\x1b[31m${err}\x1b[0m\r\n`),
      );

      term.onData((data) => socket.emit("terminal:input", data));
      term.onResize(({ cols, rows }) =>
        socket.emit("terminal:resize", { cols, rows }),
      );
    }

    init().catch(console.error);

    return () => {
      destroyed = true;
      xtermRef.current?.dispose();
      xtermRef.current = null;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Initial commands (demo) ─────────────────────────────────────────── */
  useEffect(() => {
    if (mode !== "demo" || !initialCommands?.length) return;
    const timer = setTimeout(() => {
      initialCommands.forEach((cmd) => handleRunCommand(cmd));
    }, 300);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Imperative handle ───────────────────────────────────────────────── */
  useImperativeHandle(ref, () => ({
    insertCommand: (cmd: string) => {
      if (mode === "demo") {
        setInputValue(cmd);
        demoInputRef.current?.focus();
      } else {
        socketRef.current?.emit("terminal:input", cmd);
        xtermRef.current?.write(cmd);
      }
    },
    runCommand: (cmd: string) => {
      if (mode === "demo") {
        handleRunCommand(cmd);
      } else {
        socketRef.current?.emit("terminal:input", cmd + "\n");
        xtermRef.current?.write(cmd + "\r\n");
      }
    },
  }));

  /* ── Copy / Clear ────────────────────────────────────────────────────── */
  const handleClear = useCallback(() => {
    if (mode === "demo") {
      setOutputLines([]);
    } else {
      xtermRef.current?.clear();
    }
  }, [mode]);

  const handleCopy = useCallback(() => {
    if (mode === "demo") {
      const text = outputLines
        .map((l) => l.content.replace(/\x1b\[[0-9;]*m/g, ""))
        .join("\n");
      navigator.clipboard.writeText(text).catch(() => {});
    } else {
      const sel = xtermRef.current?.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    }
  }, [mode, outputLines]);

  const handleOpenCommandPalette = useCallback(() => {
    /* Extend with a CommandPalette component if needed */
  }, []);

  const handleReconnect = useCallback(() => {
    socketRef.current?.connect();
    updateStatus("connecting");
  }, [updateStatus]);

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div
      ref={containerRef}
      className={`flex flex-col overflow-hidden ${className}`}
      style={{
        backgroundColor: TERMINAL_THEME.ui.bg,
        border: `1px solid ${TERMINAL_THEME.ui.border}`,
        borderRadius: 8,
        minHeight: 320,
      }}
    >
      {/* Toolbar */}
      <TerminalToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onAddTab={handleAddTab}
        onCloseTab={handleCloseTab}
        connectionStatus={connectionStatus}
        mode={mode}
        onClear={handleClear}
        onCopy={handleCopy}
        onToggleFullscreen={handleToggleFullscreen}
        isFullscreen={isFullscreen}
        onOpenCommandPalette={handleOpenCommandPalette}
      />

      {/* Content row */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Terminal area */}
        <div className="flex-1 overflow-hidden min-w-0 min-h-0">
          {mode === "demo" ? (
            <DemoTerminal
              outputLines={outputLines}
              inputValue={inputValue}
              onInputChange={setInputValue}
              onKeyDown={handleDemoKeyDown}
              inputRef={demoInputRef}
              outputRef={outputScrollRef}
            />
          ) : (
            <RealTerminal
              containerRef={xtermContainerRef}
              connectionStatus={connectionStatus}
              onReconnect={handleReconnect}
            />
          )}
        </div>

        {/* Agent Sidebar */}
        {showAgentSidebar && (
          <Suspense fallback={null}>
            <AgentSidebar
              onRunAction={handleAgentAction}
              onSendMessage={handleAgentMessage}
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed((v) => !v)}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
});
