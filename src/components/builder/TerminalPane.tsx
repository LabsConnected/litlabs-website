"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, PlugZap } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import styles from "./builder.module.css";

type ConnectionState = "demo" | "connecting" | "connected" | "error";

export default function TerminalPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ConnectionState>("demo");

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let terminal: import("@xterm/xterm").Terminal | null = null;

    async function boot() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (disposed || !containerRef.current) return;

      terminal = new Terminal({
        cursorBlink: true,
        fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        lineHeight: 1.35,
        scrollback: 4000,
        allowProposedApi: false,
        theme: {
          background: "#030914",
          foreground: "#dfe8ff",
          cursor: "#b05cff",
          black: "#02050b",
          brightBlack: "#53617d",
          green: "#46ffa2",
          brightGreen: "#72ffb7",
          cyan: "#28e4ff",
          brightCyan: "#6cecff",
          magenta: "#b05cff",
          brightMagenta: "#d57cff",
          red: "#ff557a",
          yellow: "#ffd166",
          white: "#dfe8ff",
        },
      });

      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(containerRef.current);
      fit.fit();

      resizeObserver = new ResizeObserver(() => {
        fit.fit();
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols: terminal?.cols, rows: terminal?.rows }));
        }
      });
      resizeObserver.observe(containerRef.current);

      const wsBase = process.env.NEXT_PUBLIC_LITT_TERMINAL_WS_URL;
      const token = process.env.NEXT_PUBLIC_LITT_TERMINAL_TOKEN;
      const workspace = process.env.NEXT_PUBLIC_LITT_WORKSPACE ?? "littree-labstudios";

      if (!wsBase || !token) {
        setState("demo");
        terminal.writeln("\x1b[38;2;70;255;162mLiTT local terminal demo\x1b[0m");
        terminal.writeln("\x1b[38;2;140;154;184mSet NEXT_PUBLIC_LITT_TERMINAL_WS_URL and TOKEN to attach a real PTY.\x1b[0m");
        terminal.writeln("");
        terminal.writeln("\x1b[38;2;40;228;255mlitt@local\x1b[0m:\x1b[38;2;176;92;255m~/littree-labstudios\x1b[0m$ pnpm build");
        terminal.writeln("✓ Compiled successfully");
        terminal.writeln("✓ Linting and checking validity of types");
        terminal.writeln("✓ Build completed in 8.42s");
        terminal.write("\r\n\x1b[38;2;40;228;255mlitt@local\x1b[0m:\x1b[38;2;176;92;255m~/littree-labstudios\x1b[0m$ ");
        terminal.onData((data) => terminal?.write(data === "\r" ? "\r\n$ " : data));
        return;
      }

      setState("connecting");
      const url = new URL(wsBase);
      url.searchParams.set("token", token);
      url.searchParams.set("cwd", workspace);
      socket = new WebSocket(url);

      socket.addEventListener("open", () => {
        setState("connected");
        terminal?.writeln("\x1b[38;2;70;255;162mConnected to LiTT workspace PTY.\x1b[0m");
        socket?.send(JSON.stringify({ type: "resize", cols: terminal?.cols, rows: terminal?.rows }));
      });

      socket.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type: string; data?: string };
          if (payload.type === "data" && payload.data) terminal?.write(payload.data);
          if (payload.type === "error" && payload.data) terminal?.writeln(`\r\n\x1b[31m${payload.data}\x1b[0m`);
        } catch {
          terminal?.write(String(event.data));
        }
      });

      socket.addEventListener("close", () => {
        if (!disposed) {
          setState("error");
          terminal?.writeln("\r\n\x1b[31mTerminal bridge disconnected.\x1b[0m");
        }
      });

      socket.addEventListener("error", () => setState("error"));
      terminal.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input", data }));
        }
      });
    }

    void boot();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      socket?.close();
      terminal?.dispose();
    };
  }, []);

  return (
    <div className={styles.terminalPane}>
      <div className={styles.terminalToolbar}>
        <span className={`${styles.terminalState} ${styles[`terminalState${state[0].toUpperCase()}${state.slice(1)}` as keyof typeof styles]}`}>
          <Circle size={8} fill="currentColor" /> {state === "connected" ? "PTY connected" : state === "connecting" ? "Connecting" : state === "error" ? "Disconnected" : "Demo shell"}
        </span>
        <span className={styles.terminalToolbarHint}><PlugZap size={13} /> Authenticated workspace bridge</span>
      </div>
      <div ref={containerRef} className={styles.terminalHost} />
    </div>
  );
}
