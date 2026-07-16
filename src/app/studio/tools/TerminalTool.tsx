"use client";

/**
 * TerminalTool — Real interactive terminal in Studio
 *
 * Connects to the standalone terminal-server (terminal-server/server.ts)
 * over Socket.IO using a short-lived token from /api/terminal/token.
 * Streams xterm.js output bidirectionally with proper resize, copy/paste,
 * and reconnect handling.
 *
 * Architecture:
 *   Browser xterm.js
 *      ⇅ socket.io-client (wss://)
 *   Standalone terminal-server (Express + node-pty + Docker sandbox)
 *      ⇅
 *   Per-user workspace at $TERMINAL_WORKSPACE_ROOT/<clerkUserId>
 *
 * The terminal-server is a separate process (`pnpm terminal:dev`).
 * It does NOT run on Vercel — the UI shows a guard explaining how
 * to start it locally or on a Fly.io/Railway instance.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { io, type Socket } from "socket.io-client";
import { AlertTriangle, Plug, RotateCcw, TerminalSquare } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import "@xterm/xterm/css/xterm.css";

type Status = "idle" | "connecting" | "connected" | "disconnected" | "error";

const TERMINAL_URL =
  process.env.NEXT_PUBLIC_TERMINAL_URL || "http://localhost:4001";

export default function TerminalTool() {
  const { resolvedColors: T } = useTheme();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

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

    term.writeln("\x1b[36m╭──────────────────────────────────────────────╮\x1b[0m");
    term.writeln(
      "\x1b[36m│\x1b[0m  \x1b[1mLiTTree Terminal\x1b[0m  \x1b[2m— real PTY, real sandbox\x1b[0m      \x1b[36m│\x1b[0m",
    );
    term.writeln(
      "\x1b[36m│\x1b[0m  Press \x1b[33mEnter\x1b[0m or click Connect to start.        \x1b[36m│\x1b[0m",
    );
    term.writeln("\x1b[36m╰──────────────────────────────────────────────╯\x1b[0m");
    term.writeln("");

    const dataDisp = term.onData((d) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit("terminal:input", d);
      }
    });

    const resizeDisp = term.onResize(({ cols, rows }) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit("terminal:resize", { cols, rows });
      }
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });
    ro.observe(containerRef.current);

    return () => {
      dataDisp.dispose();
      resizeDisp.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // We intentionally re-create the terminal only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Connect to terminal-server ──────────────────────────────── */
  const connect = useCallback(async () => {
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
        throw new Error(body.error || `Token endpoint returned ${tokenRes.status}`);
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

      socket.on("connect", () => {
        setStatus("connected");
        termRef.current?.writeln(`\x1b[32m✓ Connected to ${url}\x1b[0m`);
        if (termRef.current) {
          socket.emit("terminal:resize", {
            cols: termRef.current.cols,
            rows: termRef.current.rows,
          });
        }
      });

      socket.on("session:ready", (payload: { sessionId?: string }) => {
        if (payload?.sessionId) setSessionId(payload.sessionId);
      });

      socket.on("terminal:output", (data: string) => {
        termRef.current?.write(data);
      });

      socket.on("terminal:error", (msg: string) => {
        termRef.current?.writeln(`\r\n\x1b[31m⚠ ${msg}\x1b[0m\r\n`);
        setError(msg);
      });

      socket.on("disconnect", (reason) => {
        setStatus("disconnected");
        termRef.current?.writeln(
          `\r\n\x1b[33m⚡ Disconnected: ${reason}\x1b[0m\r\n`,
        );
      });

      socket.on("connect_error", (err) => {
        setStatus("error");
        setError(err.message);
        termRef.current?.writeln(
          `\r\n\x1b[31m✗ Connection error: ${err.message}\x1b[0m\r\n`,
        );
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
    setStatus("disconnected");
  }, []);

  /* ── Cleanup on unmount ─────────────────────────────────────── */
  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  /* ── Render ─────────────────────────────────────────────────── */
  const statusColor =
    status === "connected"
      ? "#22c55e"
      : status === "connecting"
        ? "#fbbf24"
        : status === "error"
          ? "#ef4444"
          : "#64748b";

  const statusLabel =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting…"
        : status === "disconnected"
          ? "Disconnected"
          : status === "error"
            ? "Error"
            : "Idle";

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
              {sessionId ? sessionId.slice(0, 8) : "no session"} ·{" "}
              {TERMINAL_URL.replace(/^https?:\/\//, "")}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-bold">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: statusColor }}
            />
            <span style={{ color: statusColor }}>{statusLabel}</span>
          </span>

          {status === "connected" || status === "connecting" ? (
            <button
              onClick={disconnect}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider transition hover:opacity-90"
              style={{
                border: `1px solid ${T.borderColor}40`,
                color: T.textColor,
              }}
            >
              <RotateCcw size={11} /> Disconnect
            </button>
          ) : (
            <button
              onClick={connect}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider transition hover:opacity-90"
              style={{
                backgroundColor: T.accentColor,
                color: T.bgColor,
              }}
            >
              <Plug size={11} />
              {status === "error" ? "Retry" : "Connect"}
            </button>
          )}
        </div>
      </header>

      {error && status !== "connected" && (
        <div
          className="flex items-start gap-2 rounded-xl border p-2 text-[11px]"
          style={{
            backgroundColor: `${T.boxBg}cc`,
            borderColor: "#f8717130",
            color: "#fca5a5",
          }}
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-black">Cannot reach terminal-server</p>
            <p
              className="mt-0.5 text-[10px]"
              style={{ color: T.textMuted }}
            >
              Start it with{" "}
              <code
                className="rounded px-1 py-0.5 font-mono"
                style={{ backgroundColor: "rgba(0,0,0,.4)" }}
              >
                pnpm terminal:dev
              </code>{" "}
              in another terminal, then click <strong>Connect</strong>.
              {error ? ` (${error})` : ""}
            </p>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 overflow-hidden rounded-2xl border"
        style={{
          backgroundColor: "#0a0a0f",
          borderColor: `${T.borderColor}30`,
          minHeight: 320,
        }}
      />
    </div>
  );
}
