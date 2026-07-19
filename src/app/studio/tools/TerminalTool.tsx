"use client";

/**
 * TerminalTool — Studio terminal surface
 *
 * Renders an interactive xterm.js terminal in the Studio at
 * `/studio?tool=terminal`. There are two backends:
 *
 *   1. **Real PTY** (default when available): the standalone
 *      `terminal-server` process on `NEXT_PUBLIC_TERMINAL_URL`
 *      (default `http://localhost:4001`). Streams a real bash/PS over
 *      Socket.IO with auth from `/api/terminal/token`. Start it locally
 *      with `pnpm terminal:dev`.
 *
 *   2. **Local LiTT Shell** (fallback): if the token endpoint returns
 *      503/401, or the socket can't connect, we drop into a tiny
 *      in-browser shell emulator that supports a handful of useful
 *      commands. This guarantees the terminal view always *does
 *      something* on production (where the terminal-server can't run
 *      because Vercel is serverless and node-pty needs a long-lived
 *      process), instead of showing a "Cannot reach terminal-server"
 *      error every time.
 *
 * The Connect button in the toolbar switches between the two modes.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { io, type Socket } from "socket.io-client";
import {
  AlertTriangle,
  Plug,
  RotateCcw,
  Server,
  TerminalSquare,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import "@xterm/xterm/css/xterm.css";

type Status = "idle" | "connecting" | "connected" | "disconnected" | "error";
type Mode = "remote" | "local";

const TERMINAL_URL =
  process.env.NEXT_PUBLIC_TERMINAL_URL || "http://localhost:4001";

/* ── Local in-browser shell (fallback) ───────────────────────── */

const LOCAL_WELCOME = [
  "",
  "\x1b[36m╭─────────────────────────────────────────────────────────╮\x1b[0m",
  "\x1b[36m│\x1b[0m  \x1b[1mLiTT Local Shell\x1b[0m  \x1b[2m— in-browser PTY-free emulator\x1b[0m    \x1b[36m│\x1b[0m",
  "\x1b[36m│\x1b[0m  \x1b[2mType \x1b[0m\x1b[33mhelp\x1b[0m\x1b[2m for the list of supported commands.\x1b[0m       \x1b[36m│\x1b[0m",
  "\x1b[36m╰─────────────────────────────────────────────────────────╯\x1b[0m",
  "",
];

const LOCAL_HELP = [
  "  \x1b[1mSupported commands:\x1b[0m",
  "    \x1b[33mhelp\x1b[0m                Show this list",
  "    \x1b[33mclear\x1b[0m               Clear the screen",
  "    \x1b[33mwhoami\x1b[0m              Print the current user",
  "    \x1b[33mpwd\x1b[0m                 Print the workspace directory",
  "    \x1b[33mls [path]\x1b[0m           List files (mocked workspace)",
  "    \x1b[33mcat <file>\x1b[0m          Print a mocked file",
  "    \x1b[33mecho <text>\x1b[0m         Echo text",
  "    \x1b[33mdate\x1b[0m                Print the current date",
  "    \x1b[33muname -a\x1b[0m            System info",
  "    \x1b[33mnode -v\x1b[0m              Node.js version",
  "    \x1b[33mpnpm -v\x1b[0m              pnpm version",
  "    \x1b[33mpnpm build\x1b[0m           Simulated production build",
  "    \x1b[33mpnpm lint\x1b[0m            Simulated ESLint check",
  "    \x1b[33mpnpm test\x1b[0m            Simulated test run",
  "    \x1b[33mpnpm dev\x1b[0m             Simulated dev server",
  "    \x1b[33mnpx tsc --noEmit\x1b[0m     Simulated type-check",
  "    \x1b[33mneofetch\x1b[0m             Tiny system info card",
  "",
  "  \x1b[2mFor a real PTY (bash/PS), run \x1b[0m\x1b[33mpnpm terminal:dev\x1b[0m\x1b[2m and click Connect.\x1b[0m",
  "",
];

const LOCAL_FS: Record<string, string> = {
  "/workspace/README.md":
    "# LiTTree LabStudios\n\nStudio OS for AI agents. Project Loops, real-time terminal, and more.\n",
  "/workspace/package.json":
    '{\n  "name": "litlabs-website",\n  "version": "0.1.0",\n  "private": true,\n  "scripts": {\n    "dev": "next dev --turbo",\n    "build": "next build"\n  }\n}\n',
  "/workspace/.env.local":
    "# This file is intentionally blank — secrets live on the server.\n",
  "/workspace/next.config.ts":
    "// next.config.ts — Turbopack, no cleanDistDir, serverExternalPackages: ['jose']\n",
};

const LOCAL_LS: Record<string, string[]> = {
  "/workspace": [
    "README.md",
    "package.json",
    "next.config.ts",
    ".env.local",
    "src/",
    "public/",
    "supabase/",
    "terminal-server/",
  ],
  "/workspace/src": ["app/", "components/", "lib/", "hooks/", "context/"],
  "/workspace/src/app": ["studio/", "api/", "dashboard/", "docs/"],
  "/workspace/supabase": ["migrations/", "schema.sql"],
  "/workspace/terminal-server": ["server.ts", "auth.ts", "Dockerfile"],
};

const LOCAL_PWD = "/workspace";
const LOCAL_USER = "creator@littree";

function runLocalCommand(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  const [cmd, ...args] = trimmed.split(/\s+/);

  switch (cmd) {
    case "help":
    case "?":
      return LOCAL_HELP;
    case "clear":
    case "cls":
      return ["\x1b[2J\x1b[H"];
    case "whoami":
      return [LOCAL_USER];
    case "pwd":
      return [LOCAL_PWD];
    case "echo":
      return [args.join(" ")];
    case "date":
      return [new Date().toString()];
    case "uname":
      if (args[0] === "-a") {
        return [
          "LiTTree LabStudios 1.0.0 #1 SMP local time zone browser-xterm",
          "Build: xterm.js + node-pty + socket.io",
          "Arch: x86_64 (browser)",
          "Kernel: Vercel Edge / Next.js 16",
        ];
      }
      return ["LiTTree LabStudios"];
    case "node":
      if (args[0] === "-v" || args[0] === "--version") return ["v22.22.0"];
      if (args[0] === "-e") return [args.slice(1).join(" ")];
      return ["node: command not implemented in Local Shell (use Connect for real bash)"];
    case "npx":
      if (args[0] === "tsc" && (args[1] === "--noEmit" || !args[1])) {
        return [
          "\x1b[32m✓\x1b[0m No type errors found.",
          "",
          "\x1b[36mℹ\x1b[0m Simulated type-check (in-browser shell).",
        ];
      }
      return ["npx: command not implemented in Local Shell (use Connect for real bash)"];
    case "pnpm": {
      if (args[0] === "-v" || args[0] === "--version") return ["9.15.0"];
      const sub = args[0];
      if (sub === "build") {
        return [
          "\x1b[32m✓\x1b[0m Compiled successfully in 4.2s",
          "\x1b[32m✓\x1b[0m Linting passed",
          "\x1b[32m✓\x1b[0m Generating static pages (42/42)",
          "\x1b[32m✓\x1b[0m Build completed",
          "",
          " \x1b[2mRoute (app)\x1b[0m                              Size  ",
          "  ┌ ◐ /                                    142 kB",
          "  ├ ○ /studio                              89 kB",
          "  ├ ○ /dashboard                           34 kB",
          "  └ ○ /api/...                             12 kB",
          "  First Load JS shared                     287 kB",
          "",
          "\x1b[36mℹ\x1b[0m Note: This is a simulated build output (in-browser shell).",
          "\x1b[36mℹ\x1b[0m For real builds, run \x1b[33mpnpm terminal:dev\x1b[0m locally and click Connect.",
        ];
      }
      if (sub === "lint") {
        return [
          "\x1b[32m✓\x1b[0m ESLint passed — 0 errors, 3 warnings",
          "",
          " \x1b[33m⚠\x1b[0m src/components/MobileBottomNav.tsx:26  z-[100] can be written as z-100",
          "",
          "\x1b[36mℹ\x1b[0m Simulated lint output (in-browser shell).",
        ];
      }
      if (sub === "test") {
        return [
          " \x1b[36mRUN\x1b[0m  vitest v1.6.0",
          " ✓ src/lib/__tests__/agents.test.ts (3 tests)",
          " ✓ src/lib/__tests__/llm.test.ts (5 tests)",
          " ✓ src/lib/__tests__/auth.test.ts (2 tests)",
          "",
          " Test Files  3 passed (3)",
          "      Tests  10 passed (10)",
          "",
          "\x1b[36mℹ\x1b[0m Simulated test output (in-browser shell).",
        ];
      }
      if (sub === "dev") {
        return [
          "\x1b[36m▲\x1b[0m Next.js 16.0.0 (Turbopack)",
          "- Local:        http://localhost:3000",
          "- Environments: .env.local",
          "",
          "\x1b[36mℹ\x1b[0m Simulated dev server (in-browser shell).",
          "\x1b[36mℹ\x1b[0m For a real dev server, run \x1b[33mpnpm terminal:dev\x1b[0m locally and click Connect.",
        ];
      }
      return ["pnpm: command not implemented in Local Shell (use Connect for real bash)"];
    }
    case "neofetch":
      return [
        "       ╭─────────────────────────╮",
        "       │ \x1b[36mLiTTree LabStudios\x1b[0m     │",
        "       │ \x1b[2m(studio: in-browser)\x1b[0m    │",
        "       ╰─────────────────────────╯",
        "  \x1b[2mOS\x1b[0m      Local LiTT Shell 1.0",
        "  \x1b[2mHost\x1b[0m    browser-xterm",
        "  \x1b[2mKernel\x1b[0m  Vercel Edge",
        "  \x1b[2mShell\x1b[0m   xterm.js + socket.io-client",
        "  \x1b[2mCPU\x1b[0m     TypeScript, React, Next.js 16",
        "  \x1b[2mMemory\x1b[0m  vibes",
        "",
      ];
    case "ls":
    case "dir": {
      const target = args[0] || LOCAL_PWD;
      const key = target.endsWith("/") ? target : target;
      const entries = LOCAL_LS[key];
      if (!entries) return [`ls: ${target}: No such file or directory`];
      return [
        entries
          .map((e) => (e.endsWith("/") ? `\x1b[34m${e}\x1b[0m` : e))
          .join("  "),
      ];
    }
    case "cat": {
      if (!args[0]) return ["cat: missing operand"];
      const key = args[0].startsWith("/") ? args[0] : `${LOCAL_PWD}/${args[0]}`;
      const content = LOCAL_FS[key];
      if (!content) return [`cat: ${args[0]}: No such file or directory`];
      return [content.replace(/\n$/, "")];
    }
    case "cd":
      return [
        args[0] ? `(cd ${args[0]} — Local Shell does not track cwd, always at ${LOCAL_PWD})` : "",
      ];
    case "exit":
    case "logout":
      return ["(use Connect to switch to the real PTY)"];
    default:
      return [
        `${cmd}: command not found. Type \x1b[33mhelp\x1b[0m for the list of supported commands.`,
      ];
  }
}

/* ── React component ─────────────────────────────────────────── */

export interface TerminalToolHandle {
  runCommand: (command: string) => void;
  getSessionId: () => string | null;
  clear: () => void;
}

type TerminalToolProps = {
  initialMode?: Mode;
  onOutput?: (data: string) => void;
  onSessionChange?: (sessionId: string | null) => void;
};

const TerminalTool = forwardRef<TerminalToolHandle, TerminalToolProps>(
  function TerminalTool({ initialMode = "local", onOutput, onSessionChange }, ref) {
    const { resolvedColors: T } = useTheme();

    const containerRef = useRef<HTMLDivElement | null>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const pendingRemoteCommandRef = useRef<string | null>(null);

    // Local shell state
    const localLineRef = useRef<string>("");
    const localHistoryRef = useRef<string[]>([]);
    const localHistIndexRef = useRef<number>(-1);

    const [status, setStatus] = useState<Status>("idle");
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<Mode>(initialMode);
    const [sessionId, setSessionId] = useState<string | null>(null);

    const modeRef = useRef(mode);
    const sessionIdRef = useRef(sessionId);
    const onOutputRef = useRef(onOutput);
    const onSessionChangeRef = useRef(onSessionChange);

    useEffect(() => {
      modeRef.current = mode;
    }, [mode]);
    useEffect(() => {
      sessionIdRef.current = sessionId;
    }, [sessionId]);
    useEffect(() => {
      onOutputRef.current = onOutput;
    }, [onOutput]);
    useEffect(() => {
      onSessionChangeRef.current = onSessionChange;
    }, [onSessionChange]);

    const writePrompt = useCallback(() => {
    if (!termRef.current) return;
    termRef.current.write(
      `\x1b[36m${LOCAL_USER}\x1b[0m:\x1b[34m${LOCAL_PWD}\x1b[0m$ `,
    );
  }, []);

  const handleLocalInput = useCallback(
    (data: string) => {
      const term = termRef.current;
      if (!term) return;
      for (const ch of data) {
        const code = ch.charCodeAt(0);
        if (ch === "\r") {
          // Enter
          term.write("\r\n");
          const line = localLineRef.current;
          localLineRef.current = "";
          if (line.trim().length > 0) {
            localHistoryRef.current.push(line);
            localHistIndexRef.current = localHistoryRef.current.length;
            onOutputRef.current?.(line + "\n");
            const output = runLocalCommand(line);
            for (const o of output) {
              term.writeln(o);
              onOutputRef.current?.(o + "\n");
            }
          }
          writePrompt();
        } else if (code === 127) {
          // Backspace
          if (localLineRef.current.length > 0) {
            localLineRef.current = localLineRef.current.slice(0, -1);
            term.write("\b \b");
          }
        } else if (ch === "\u0003") {
          // Ctrl+C
          term.write("^C\r\n");
          localLineRef.current = "";
          writePrompt();
        } else if (ch === "\u000c") {
          // Ctrl+L
          term.write("\x1b[2J\x1b[H");
          writePrompt();
        } else if (ch === "\u001b") {
          // Escape sequences — ignore (no arrow-key history for now)
        } else if (code === 12) {
          // Ctrl+L (alternate)
          term.write("\x1b[2J\x1b[H");
          writePrompt();
        } else if (code >= 32) {
          localLineRef.current += ch;
          term.write(ch);
        }
      }
    },
    [writePrompt],
  );

  const startLocal = useCallback((term: Terminal) => {
    setMode("local");
    setStatus("connected");
    setError(null);
    setSessionId(null);
    onSessionChangeRef.current?.(null);
    for (const line of LOCAL_WELCOME) term.writeln(line);
    term.write(`\x1b[36m${LOCAL_USER}\x1b[0m:\x1b[34m${LOCAL_PWD}\x1b[0m$ `);
  }, []);

  /* ── Initialize xterm once on mount ─────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily:
        '"JetBrains Mono", "Cascadia Code", "Fira Code", "Consolas", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 10_000,
      convertEol: true,
      theme: {
        background: "#0a0a0f",
        foreground: "#e6e6f0",
        cursor: T.accentColor,
        cursorAccent: "#0a0a0f",
        selectionBackground: `${T.accentColor}55`,
        black: "#0a0a0f",
        red: "#f87171",
        green: "#22c55e",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e6e6f0",
        brightBlack: "#64748b",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* container not yet sized */
      }
    });

    termRef.current = term;
    fitRef.current = fit;

    // Default: start in local mode and write the welcome banner
    startLocal(term);

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // We intentionally re-create the terminal only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route keystrokes to the right backend
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const disp = term.onData((d) => {
      if (mode === "local") {
        handleLocalInput(d);
      } else if (socketRef.current?.connected) {
        socketRef.current.emit("terminal:input", d);
      }
    });
    const resizeDisp = term.onResize(({ cols, rows }) => {
      if (mode === "remote" && socketRef.current?.connected) {
        socketRef.current.emit("terminal:resize", { cols, rows });
      }
    });
    return () => {
      disp.dispose();
      resizeDisp.dispose();
    };
  }, [mode, handleLocalInput]);

  /* ── Connect to terminal-server (remote PTY) ─────────────── */
  const connectRemote = useCallback(async () => {
    if (status === "connecting" || status === "connected") return;

    setStatus("connecting");
    setError(null);
    setSessionId(null);

    try {
      const tokenRes = await fetch("/api/terminal/token", { cache: "no-store" });
      if (!tokenRes.ok) {
        const body = (await tokenRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error || `Token endpoint returned ${tokenRes.status}`,
        );
      }
      const { token, baseUrl } = (await tokenRes.json()) as {
        token: string;
        baseUrl?: string;
      };

      const url = baseUrl || TERMINAL_URL;

      const socket = io(url, {
        auth: { token },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 10_000,
        timeout: 15_000,
      });

      socketRef.current = socket;
      setMode("remote");

      socket.on("connect", () => {
        setStatus("connected");
        termRef.current?.writeln(`\x1b[32m✓ Connected to ${url}\x1b[0m`);
        if (termRef.current) {
          socket.emit("terminal:resize", {
            cols: termRef.current.cols,
            rows: termRef.current.rows,
          });
        }
        const pendingCommand = pendingRemoteCommandRef.current;
        if (pendingCommand) {
          socket.emit("terminal:input", pendingCommand + "\r");
          pendingRemoteCommandRef.current = null;
        }
      });

      socket.on("session:ready", (payload: { sessionId?: string }) => {
        if (payload?.sessionId) {
          setSessionId(payload.sessionId);
          onSessionChangeRef.current?.(payload.sessionId);
        }
      });

      socket.on("terminal:output", (data: string) => {
        termRef.current?.write(data);
        onOutputRef.current?.(data);
      });

      socket.on("terminal:error", (msg: string) => {
        termRef.current?.writeln(`\r\n\x1b[31m⚠ ${msg}\x1b[0m\r\n`);
        setError(msg);
        onOutputRef.current?.(msg + "\n");
      });

      socket.on("disconnect", (reason) => {
        setStatus("disconnected");
        termRef.current?.writeln(
          `\r\n\x1b[33m⚡ Disconnected: ${reason}\x1b[0m\r\n`,
        );
        onSessionChangeRef.current?.(null);
      });

      socket.on("connect_error", (err) => {
        setStatus("error");
        setError(err.message);
        termRef.current?.writeln(
          `\r\n\x1b[31m✗ Connection error: ${err.message}\x1b[0m\r\n`,
        );
        onOutputRef.current?.(err.message + "\n");
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setStatus("error");
      setError(message);
      termRef.current?.writeln(`\r\n\x1b[31m✗ ${message}\x1b[0m\r\n`);
    }
  }, [status]);

  /* ── Disconnect ─────────────────────────────────────────────── */
  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setSessionId(null);
    setStatus("idle");
    // Drop back to local shell
    const term = termRef.current;
    if (term) {
      term.writeln("");
      term.writeln("\x1b[33m⚡ Dropped back to Local LiTT Shell.\x1b[0m");
      startLocal(term);
    }
  }, [startLocal]);

  /* ── Cleanup on unmount ─────────────────────────────────────── */
  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  /* ── Expose imperative handle for Builder ───────────────────── */
  useImperativeHandle(ref, () => ({
    runCommand(command: string) {
      const term = termRef.current;
      if (!term) return;
      if (modeRef.current === "remote" && socketRef.current?.connected) {
        socketRef.current.emit("terminal:input", command + "\r");
      } else {
        // Commands initiated by Studio must use the authenticated PTY. Queue
        // until the socket connects so build/run actions are real executions,
        // not simulated Local LiTT Shell responses.
        pendingRemoteCommandRef.current = command;
        term.writeln(`\r\n\x1b[36mConnecting to workspace to run: ${command}\x1b[0m`);
        void connectRemote();
      }
      onOutputRef.current?.(command + "\n");
    },
    getSessionId() {
      return sessionIdRef.current;
    },
    clear() {
      termRef.current?.clear();
    },
  }), [connectRemote]);

  /* ── Render ─────────────────────────────────────────────────── */
  const statusColor = useMemo(() => {
    if (mode === "local") return "#22d3ee";
    return status === "connected"
      ? "#22c55e"
      : status === "connecting"
        ? "#fbbf24"
        : status === "error"
          ? "#ef4444"
          : "#64748b";
  }, [mode, status]);

  const statusLabel = useMemo(() => {
    if (mode === "local") return "Local Shell";
    return status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting…"
        : status === "disconnected"
          ? "Disconnected"
          : status === "error"
            ? "Error"
            : "Idle";
  }, [mode, status]);

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-2 sm:p-3"
      style={{ color: T.textColor }}
    >
      <header
        className="flex items-center justify-between gap-2 rounded-2xl border px-3 py-2"
        style={{
          backgroundColor: T.boxBg,
          borderColor: `${T.borderColor}30`,
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="grid h-7 w-7 place-items-center rounded-lg"
            style={{
              backgroundColor: `${T.accentColor}22`,
              color: T.accentColor,
            }}
          >
            <TerminalSquare size={14} />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] font-black uppercase tracking-[.18em]">
              Terminal
            </span>
            <span
              className="text-[9px] font-mono"
              style={{ color: T.textMuted }}
            >
              {mode === "local"
                ? "Local LiTT Shell · no PTY"
                : sessionId
                  ? sessionId.slice(0, 8)
                  : "no session"}{" "}
              ·{" "}
              {mode === "local"
                ? "in-browser"
                : TERMINAL_URL.replace(/^https?:\/\//, "")}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-bold">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: statusColor }}
            />
            {statusLabel}
          </span>

          {mode === "local" ? (
            <button
              onClick={() => connectRemote()}
              disabled={status === "connecting"}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-bold transition-colors"
              style={{
                backgroundColor: `${T.accentColor}22`,
                color: T.accentColor,
                opacity: status === "connecting" ? 0.5 : 1,
              }}
            >
              <Plug size={12} />
              Connect to PTY
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-bold transition-colors"
              style={{
                backgroundColor: `${T.accentColor}22`,
                color: T.accentColor,
              }}
            >
              <Server size={12} />
              Disconnect
            </button>
          )}

          <button
            onClick={() => {
              const term = termRef.current;
              if (!term) return;
              term.write("\x1b[2J\x1b[H");
              if (mode === "local") writePrompt();
            }}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-bold transition-colors"
            style={{
              backgroundColor: `${T.borderColor}22`,
              color: T.textMuted,
            }}
          >
            <RotateCcw size={12} />
            Clear
          </button>
        </div>
      </header>

      {error && mode === "remote" && (
        <div
          className="flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px]"
          style={{
            backgroundColor: "#f8717122",
            borderColor: "#f8717155",
            color: "#fca5a5",
          }}
        >
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={disconnect}
            className="shrink-0 font-bold underline"
          >
            Back to Local Shell
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden rounded-2xl border"
        style={{
          backgroundColor: "#0a0a0f",
          borderColor: `${T.borderColor}30`,
        }}
      />

      {mode === "local" && (
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-[10px]"
          style={{
            backgroundColor: `${T.accentColor}11`,
            color: T.textMuted,
          }}
        >
          <TerminalSquare size={12} />
          <span>
            In-browser Local Shell — type{" "}
            <code className="font-bold" style={{ color: T.accentColor }}>
              help
            </code>{" "}
            for commands. Click{" "}
            <code className="font-bold" style={{ color: T.accentColor }}>
              Connect to PTY
            </code>{" "}
            for a real bash/PS (requires{" "}
            <code className="font-bold">pnpm terminal:dev</code> running
            locally).
          </span>
        </div>
      )}
    </div>
  );
});

export default TerminalTool;
