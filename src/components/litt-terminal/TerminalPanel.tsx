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
import { clearTerminalTokenCache, getTerminalTokenResult, WorkspaceNotReadyError } from "@/lib/terminal-client";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { Maximize2, Minimize2, Plug, RotateCcw, Trash2, AlertCircle, Copy, Check, Download, ExternalLink } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { copyToClipboard } from "@/lib/studio/message-copy";

const HEARTBEAT_INTERVAL_MS = 10_000;

interface TerminalPanelProps {
  projectId?: string;
  repositoryName?: string | null;
  branch?: string | null;
  approvalMode?: "auto" | "manual";
  onLog?: (entry: string) => void;
  onCommand?: (cmd: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  onTerminalOutput?: (output: string) => void;
  visible?: boolean;
}

export interface TerminalPanelHandle {
  insertCommand: (cmd: string) => void;
  runCommand: (cmd: string) => void;
}

export const TerminalPanel = forwardRef<
  TerminalPanelHandle,
  TerminalPanelProps
>(function TerminalPanel(
  { projectId, repositoryName, branch, approvalMode = "manual", onLog, onCommand, onConnectionChange, onTerminalOutput, visible },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const commandBufferRef = useRef<string>("");
  const outputBufferRef = useRef<string>("");
  const connectionInProgressRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{ sessionId: string; cwd: string; shell: string; workspaceId?: string | null; projectId?: string | null } | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [copiedAll, setCopiedAll] = useState(false);
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const terminalStore = useTerminalStore();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const CONNECTION_TIMEOUT_MS = 10_000;

  // Refs for callback props — updated every render but NOT included in the
  // connection useEffect's dependency array. This prevents inline arrow
  // functions from the parent (e.g. onConnectionChange={(c) => ...}) from
  // causing the socket to disconnect/reconnect on every render.
  const onLogRef = useRef(onLog);
  const onCommandRef = useRef(onCommand);
  const onConnectionChangeRef = useRef(onConnectionChange);
  const onTerminalOutputRef = useRef(onTerminalOutput);
  onLogRef.current = onLog;
  onCommandRef.current = onCommand;
  onConnectionChangeRef.current = onConnectionChange;
  onTerminalOutputRef.current = onTerminalOutput;

  useEffect(() => {
    if (!containerRef.current || !isLoaded || !isSignedIn) return;
    // Prevent duplicate connections from React Strict Mode double-invoke
    // or effect re-runs caused by unrelated state changes.
    if (connectionInProgressRef.current) return;
    connectionInProgressRef.current = true;
    terminalStore.setProject(projectId ?? null);
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

    // Clipboard-friendly key handling:
    //   Ctrl+V              → paste from clipboard
    //   Ctrl+C (selected)   → copy selection, then clear it
    //   Ctrl+C (no select)  → fall through to shell as SIGINT
    //   Ctrl+Shift+C / +V   → copy / paste (terminal-native shortcuts)
    // All other keys (Ctrl+A, Ctrl+L, etc.) pass through unchanged.
    //
    // CRITICAL: we call event.preventDefault() on every intercepted key.
    // Returning false only tells xterm to skip its own keydown processing —
    // it does NOT stop the browser from firing a native paste/copy event on
    // xterm's hidden textarea. Without preventDefault the browser pastes
    // AND our manual term.paste() pastes → duplicated input
    // (e.g. "npm run buildnpm run build").
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;

      const key = event.key.toLowerCase();

      // Ctrl+V = paste (Windows-style). Don't also trigger on Ctrl+Shift+V
      // so we don't double-paste — let the Shift variant fall through below.
      if (event.ctrlKey && !event.shiftKey && key === "v") {
        event.preventDefault();
        navigator.clipboard.readText().then((text) => term.paste(text)).catch(() => {});
        return false;
      }

      // Ctrl+Shift+V = paste (terminal-native)
      if (event.ctrlKey && event.shiftKey && key === "v") {
        event.preventDefault();
        navigator.clipboard.readText().then((text) => term.paste(text)).catch(() => {});
        return false;
      }

      // Ctrl+C: copy if text is selected, otherwise SIGINT to shell
      if (event.ctrlKey && !event.shiftKey && key === "c") {
        if (term.hasSelection()) {
          event.preventDefault();
          navigator.clipboard.writeText(term.getSelection()).catch(() => {});
          term.clearSelection();
          return false;
        }
        return true; // let Ctrl+C reach the PTY as SIGINT
      }

      // Ctrl+Shift+C = copy (terminal-native)
      if (event.ctrlKey && event.shiftKey && key === "c") {
        if (term.hasSelection()) {
          event.preventDefault();
          navigator.clipboard.writeText(term.getSelection()).catch(() => {});
          term.clearSelection();
          return false;
        }
        return true;
      }

      return true;
    });

    term.writeln("\x1b[1;32m🔥 LiTT Terminal\x1b[0m");
    term.writeln("\x1b[1;30mReal shell. Real power. AI-backed.\x1b[0m");
    term.writeln("");

    term.writeln("\x1b[33mConnecting to terminal server...\x1b[0m");
    terminalStore.setStatus("connecting");

    // Connection timeout — started ONLY when the socket is actually connecting
    // (not during workspace provisioning, which can take up to 60s).
    // startConnectTimeout() is called inside the .then() after token fetch.
    const startConnectTimeout = () => {
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = setTimeout(() => {
        if (disposed) return;
        if (terminalStore.status !== "connected") {
          terminalStore.setError("PTY connection timed out after 10 seconds");
          terminalStore.setStatus("error");
          terminalStore.setFailureStage("pty_timeout");
          term.writeln("\x1b[31m❌ PTY connection timed out. Click Retry to try again.\x1b[0m");
          onLog?.("[WS] Connection timed out after 10s");
          socketRef.current?.disconnect();
          socketRef.current = null;
        }
      }, CONNECTION_TIMEOUT_MS);
    };
    const resize = () => {
      fit.fit();
      socketRef.current?.emit("terminal:resize", {
        cols: term.cols,
        rows: term.rows,
      });
    };

    let attemptedUnauthorizedRetry = false;
    let wsUrl = "";

    const connect = async () => {
      const authToken = await getToken?.();
      return getTerminalTokenResult(false, projectId, authToken || undefined);
    };

    void connect()
      .then(({ token, baseUrl }) => {
        if (disposed) return;
        wsUrl = baseUrl || process.env.NEXT_PUBLIC_TERMINAL_WS_URL || "";
        if (!wsUrl || (process.env.NODE_ENV === "production" && wsUrl.includes("localhost"))) {
          terminalStore.setError("Terminal server URL not configured. Set TERMINAL_SERVER_URL on the server.");
          terminalStore.setStatus("error");
          term.writeln("\x1b[31m❌ Terminal server URL not configured.\x1b[0m");
          onLog?.("[WS] No baseUrl from token endpoint");
          return;
        }
        // Start PTY timeout only now — workspace is ready, socket is connecting
        startConnectTimeout();
        const connectedSocket = io(wsUrl, {
          auth: { token },
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 30000,
          randomizationFactor: 0.5,
        });

        socketRef.current = connectedSocket;

        connectedSocket.on("reconnect_attempt", (attempt: number) => {
          terminalStore.setStatus("connecting");
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
          term.writeln(`\x1b[33m⟳ Reconnecting (attempt ${attempt}, next in ${Math.round(delay / 1000)}s)...\x1b[0m`);
          onLog?.(`[WS] Reconnect attempt ${attempt}`);
        });

        connectedSocket.on("connect", () => {
          // Socket transport is connected, but PTY is NOT ready yet.
          // Do NOT set connected=true or fire onConnectionChange.
          // Wait for session:ready which confirms PTY + cwd.
          terminalStore.setStatus("connecting");
          terminalStore.setFailureStage(null);
          term.writeln("\x1b[32m✅ Socket connected — waiting for PTY session...\x1b[0m");
          onLog?.("[WS] Socket connected to terminal server");

          // Start heartbeat
          if (heartbeatRef.current) clearInterval(heartbeatRef.current);
          heartbeatRef.current = setInterval(() => {
            if (connectedSocket.connected) {
              terminalStore.setHeartbeat(new Date().toISOString());
            }
          }, HEARTBEAT_INTERVAL_MS);
        });

        connectedSocket.on("disconnect", (reason) => {
          setConnected(false);
          setSessionInfo(null);
          // Preserve error state — don't overwrite an error with "disconnected"
          // If we were already in an error/auth_failed state, keep it.
          const currentStatus = terminalStore.status;
          if (currentStatus !== "error" && currentStatus !== "auth_failed" && currentStatus !== "unavailable" && currentStatus !== "pty_failed") {
            terminalStore.setStatus("disconnected");
          }
          terminalStore.setDisconnectReason(reason);
          terminalStore.setSession(null);
          terminalStore.setWorkspace(null);
          onConnectionChange?.(false);
          term.writeln(`\x1b[31m❌ Disconnected: ${reason}\x1b[0m`);
          onLog?.(`[WS] Disconnected: ${reason}`);
          if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
          }
        });

        connectedSocket.on("session:ready", ({ sessionId: sid, cwd = "Unknown workspace", shell = "Unknown shell", workspaceId: wsId = null, projectId: sessProjectId = null }) => {
          // Clear connection timeout — PTY session is verified
          if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current);
            connectTimeoutRef.current = null;
          }
          // ONLY here do we set connected=true — the PTY is ready, cwd is verified
          setConnected(true);
          setSessionInfo({ sessionId: sid, cwd, shell, workspaceId: wsId, projectId: sessProjectId });
          terminalStore.setVerifiedSession({ sessionId: sid, cwd, shell, workspaceId: wsId, projectId: sessProjectId });
          onConnectionChange?.(true);
          term.writeln(`\x1b[36mℹ Session ready: ${sid.slice(0, 8)}...\x1b[0m`);
          if (wsId) term.writeln(`\x1b[36m   workspace: ${wsId}\x1b[0m`);
          if (sessProjectId) term.writeln(`\x1b[36m   project: ${sessProjectId}\x1b[0m`);
          term.writeln(`\x1b[36m   cwd: ${cwd}\x1b[0m`);
          term.writeln(`\x1b[36m   shell: ${shell}\x1b[0m`);
          onLog?.(`[SESSION] Ready ${sid.slice(0, 8)}... ws=${wsId ?? "none"} project=${sessProjectId ?? "none"} cwd=${cwd} shell=${shell}`);
        });

        connectedSocket.on("connect_error", (err: Error) => {
          const isUnauthorized = /unauthorized/i.test(err.message || "");
          if (isUnauthorized && !attemptedUnauthorizedRetry) {
            attemptedUnauthorizedRetry = true;
            clearTerminalTokenCache();
            onLog?.("[WS] Unauthorized — refreshing terminal token and retrying...");
            connectedSocket.disconnect();
            socketRef.current = null;
            setConnected(false);
            terminalStore.setStatus("connecting");
            terminalStore.setFailureStage("auth");
            void connect().then(({ token: freshToken, baseUrl: freshBaseUrl }) => {
              if (disposed) return;
              const retryWsUrl = freshBaseUrl || wsUrl;
              const retrySocket = io(retryWsUrl, {
                auth: { token: freshToken },
                transports: ["websocket", "polling"],
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 30000,
                randomizationFactor: 0.5,
              });
              socketRef.current = retrySocket;
              retrySocket.on("connect_error", (nextErr: Error) => {
                const isAuth = /unauthorized|forbidden|auth/i.test(nextErr.message || "");
                terminalStore.setError(nextErr.message);
                terminalStore.setStatus(isAuth ? "auth_failed" : "pty_failed");
                terminalStore.setFailureStage(isAuth ? "auth" : "pty_creation_failed");
                term.writeln(`\x1b[31m❌ ${isAuth ? "Authentication failed" : "PTY connection failed"}: ${nextErr.message}\x1b[0m`);
                onLog?.(`[WS] Connect error: ${nextErr.message}`);
              });
              retrySocket.on("session:ready", (readyData: { sessionId: string; cwd: string; shell: string; workspaceId?: string | null; projectId?: string | null }) => {
                if (connectTimeoutRef.current) { clearTimeout(connectTimeoutRef.current); connectTimeoutRef.current = null; }
                setConnected(true);
                setSessionInfo(readyData);
                terminalStore.setVerifiedSession(readyData);
                onConnectionChange?.(true);
              });
              retrySocket.on("connect", () => {
                terminalStore.setStatus("connecting");
                term.writeln("\x1b[32m✅ Socket connected — waiting for PTY session...\x1b[0m");
                onLog?.("[WS] Socket connected to terminal server");
              });
            }).catch((authErr: unknown) => {
              const message = authErr instanceof Error ? authErr.message : "Terminal authentication failed";
              terminalStore.setError(message);
              terminalStore.setStatus("auth_failed");
              terminalStore.setFailureStage("auth");
              term.writeln(`\x1b[31m❌ ${message}\x1b[0m`);
              onLog?.(`[AUTH] ${message}`);
            });
            return;
          }
          if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current);
            connectTimeoutRef.current = null;
          }
          terminalStore.setError(err.message);
          terminalStore.setStatus(isUnauthorized ? "auth_failed" : "pty_failed");
          terminalStore.setFailureStage(isUnauthorized ? "auth" : "socket_unavailable");
          term.writeln(`\x1b[31m❌ ${isUnauthorized ? "Authentication failed" : "PTY connection failed"}: ${err.message}\x1b[0m`);
          onLog?.(`[WS] Connect error: ${err.message}`);
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
          // Store the error so it survives disconnect
          terminalStore.setError(msg);
          terminalStore.setFailureStage("pty_creation_failed");
          onLog?.(`[ERROR] ${msg}`);
        });

        term.onData((data) => {
          if (data === "\r") {
            const cmd = commandBufferRef.current.trim();
            if (cmd) {
              onCommand?.(cmd);
              if (cmd.startsWith("litt ")) {
                connectedSocket.emit("litt-code:command", cmd);
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
        // WorkspaceNotReadyError → trigger workspace preparation, then retry
        if (error instanceof WorkspaceNotReadyError && projectId) {
          term.writeln("\x1b[33m⏳ Workspace not ready — preparing project workspace...\x1b[0m");
          onLog?.("[WORKSPACE] Not ready — calling prepare endpoint");
          terminalStore.setStatus("connecting");
          terminalStore.setFailureStage("workspace_not_ready");

          // Poll the prepare endpoint until the workspace is ready or fails.
          const prepareUrl = `/api/studio-projects/${encodeURIComponent(projectId)}/workspace/prepare`;
          const maxAttempts = 30; // 30 × 2s = 60s max wait
          let attempt = 0;

          const pollPrepare = (): Promise<void> =>
            fetch(prepareUrl, { method: "POST", credentials: "include" })
              .then(async (resp) => {
                if (disposed) return;
                const body = await resp.json().catch(() => ({}));
                if (resp.ok && body.workspaceStatus === "ready") {
                  term.writeln("\x1b[32m✅ Workspace ready — connecting terminal...\x1b[0m");
                  onLog?.("[WORKSPACE] Ready — retrying token fetch");
                  terminalStore.setFailureStage(null);
                  clearTerminalTokenCache();
                  // Retry token fetch now that workspace is prepared
                  return connect().then(({ token, baseUrl: retryBaseUrl }) => {
                    if (disposed) return;
                    const retryWsUrl = retryBaseUrl || wsUrl;
                    // Start PTY timeout for retry socket
                    startConnectTimeout();
                    const retrySocket = io(retryWsUrl, {
                      auth: { token },
                      transports: ["websocket", "polling"],
                      reconnection: true,
                      reconnectionAttempts: Infinity,
                      reconnectionDelay: 1000,
                      reconnectionDelayMax: 30000,
                      randomizationFactor: 0.5,
                    });
                    socketRef.current = retrySocket;

                    // Full event handler setup — same as primary socket
                    retrySocket.on("connect", () => {
                      terminalStore.setStatus("connecting");
                      term.writeln("\x1b[32m✅ Socket connected — waiting for PTY session...\x1b[0m");
                      onLog?.("[WS] Socket connected to terminal server");
                      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
                      heartbeatRef.current = setInterval(() => {
                        if (retrySocket.connected) {
                          terminalStore.setHeartbeat(new Date().toISOString());
                        }
                      }, HEARTBEAT_INTERVAL_MS);
                    });

                    retrySocket.on("session:ready", (readyData: { sessionId: string; cwd: string; shell: string; workspaceId?: string | null; projectId?: string | null }) => {
                      if (connectTimeoutRef.current) { clearTimeout(connectTimeoutRef.current); connectTimeoutRef.current = null; }
                      setConnected(true);
                      setSessionInfo(readyData);
                      terminalStore.setVerifiedSession(readyData);
                      onConnectionChange?.(true);
                      term.writeln(`\x1b[36mℹ Session ready: ${readyData.sessionId.slice(0, 8)}...\x1b[0m`);
                      term.writeln(`\x1b[36m   cwd: ${readyData.cwd}\x1b[0m`);
                      onLog?.(`[SESSION] Ready ${readyData.sessionId.slice(0, 8)}... cwd=${readyData.cwd}`);
                    });

                    retrySocket.on("connect_error", (nextErr: Error) => {
                      const isAuth = /unauthorized|forbidden|auth/i.test(nextErr.message || "");
                      terminalStore.setError(nextErr.message);
                      terminalStore.setStatus(isAuth ? "auth_failed" : "pty_failed");
                      terminalStore.setFailureStage(isAuth ? "auth" : "socket_unavailable");
                      term.writeln(`\x1b[31m❌ ${isAuth ? "Authentication failed" : "PTY connection failed"}: ${nextErr.message}\x1b[0m`);
                      onLog?.(`[WS] Connect error: ${nextErr.message}`);
                    });

                    retrySocket.on("disconnect", (reason: string) => {
                      setConnected(false);
                      setSessionInfo(null);
                      // Preserve error state on disconnect
                      const currentStatus = terminalStore.status;
                      if (currentStatus !== "error" && currentStatus !== "auth_failed" && currentStatus !== "unavailable" && currentStatus !== "pty_failed") {
                        terminalStore.setStatus("disconnected");
                      }
                      terminalStore.setDisconnectReason(reason);
                      terminalStore.setSession(null);
                      onConnectionChange?.(false);
                      term.writeln(`\x1b[31m❌ Disconnected: ${reason}\x1b[0m`);
                      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
                    });

                    retrySocket.on("terminal:output", (data: string) => {
                      term.write(data);
                      outputBufferRef.current += data;
                      if (outputBufferRef.current.length > 4000) {
                        outputBufferRef.current = outputBufferRef.current.slice(-4000);
                      }
                      onTerminalOutput?.(outputBufferRef.current);
                    });

                    retrySocket.on("terminal:error", (msg: string) => {
                      term.writeln(`\x1b[31m⚠ ${msg}\x1b[0m`);
                      terminalStore.setError(msg);
                      terminalStore.setFailureStage("pty_creation_failed");
                      onLog?.(`[ERROR] ${msg}`);
                    });

                    term.onData((data: string) => {
                      if (data === "\r") {
                        const cmd = commandBufferRef.current.trim();
                        if (cmd) {
                          onCommand?.(cmd);
                          if (cmd.startsWith("litt ")) {
                            retrySocket.emit("litt-code:command", cmd);
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
                  });
                }
                // 409 PROVISIONING_IN_PROGRESS — wait and retry
                if (resp.status === 409 && body.code === "PROVISIONING_IN_PROGRESS") {
                  attempt++;
                  if (attempt >= maxAttempts) {
                    throw new Error("Workspace provisioning timed out after 60s");
                  }
                  term.writeln(`\x1b[33m   provisioning in progress... (${attempt}/${maxAttempts})\x1b[0m`);
                  return new Promise<void>((resolve) => setTimeout(resolve, 2000)).then(pollPrepare);
                }
                // Other errors
                throw new Error(body.error || `Prepare failed (${resp.status})`);
              });

          void pollPrepare().catch((prepErr: unknown) => {
            const prepMessage = prepErr instanceof Error ? prepErr.message : "Workspace preparation failed";
            term.writeln(`\x1b[31m❌ ${prepMessage}\x1b[0m`);
            onLog?.(`[WORKSPACE] ${prepMessage}`);
            terminalStore.setError(prepMessage);
            terminalStore.setFailureStage("workspace_provisioning_failed");
            const isContextMissing = /canonical project|not found|project context/i.test(prepMessage);
            terminalStore.setStatus(isContextMissing ? "project_context_missing" : "error");
          });
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Terminal authentication failed";
        term.writeln(`\x1b[31m❌ ${message}\x1b[0m`);
        onLog?.(`[AUTH] ${message}`);
        const isAuth = /auth|unauthorized|forbidden/i.test(message);
        terminalStore.setError(message);
        terminalStore.setFailureStage(isAuth ? "auth" : "socket_unavailable");
        terminalStore.setStatus(isAuth ? "auth_failed" : "error");
      });

    return () => {
      disposed = true;
      connectionInProgressRef.current = false;
      window.removeEventListener("resize", resize);
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      socketRef.current?.disconnect();
      term.dispose();
      terminalStore.setStatus("disconnected");
      terminalStore.setSession(null);
      terminalStore.setProject(null);
      terminalStore.setWorkspace(null);
      terminalStore.setFailureStage(null);
      terminalStore.setDisconnectReason(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLoaded,
    isSignedIn,
    retryCount,
    projectId,
  ]);

  useEffect(() => {
    if ((visible || fullScreen) && termRef.current && fitAddonRef.current) {
      // Delay slightly to allow the DOM transition/display update to complete
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          socketRef.current?.emit("terminal:resize", {
            cols: termRef.current?.cols ?? 80,
            rows: termRef.current?.rows ?? 24,
          });
        } catch { /* noop */ }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [visible, fullScreen]);

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

  const copyAllOutput = async () => {
    const ok = await copyToClipboard(outputBufferRef.current);
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    }
  };

  const downloadLog = () => {
    const blob = new Blob([outputBufferRef.current], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.download = `litt-terminal-${stamp}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const openFullLog = () => {
    const content = outputBufferRef.current || "(terminal output is empty)";
    const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!w) return;
    w.document.title = "LiTT Terminal — Full Log";
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>LiTT Terminal — Full Log</title>` +
        `<style>body{margin:0;background:#0a0b10;color:#e6e6e6;font:12px/1.5 "JetBrains Mono",Consolas,monospace;}` +
        `pre{white-space:pre-wrap;word-break:break-word;padding:16px;margin:0;}` +
        `.bar{position:sticky;top:0;background:#11131c;border-bottom:1px solid #222;padding:8px 16px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;font-size:10px;color:#72f238;display:flex;justify-content:space-between;align-items:center;}` +
        `button{background:#1d2030;color:#e6e6e6;border:1px solid #333;border-radius:6px;padding:4px 10px;font-size:10px;cursor:pointer;}</style></head>` +
        `<body><div class="bar"><span>LiTT Terminal — Full Log (read-only snapshot)</span>` +
        `<button onclick="document.execCommand('selectAll')">Select all</button></div>` +
        `<pre>${content.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))}</pre></body></html>`,
    );
    w.document.close();
  };

  return (
    <div className={`flex h-full flex-col ${fullScreen ? "fixed inset-0 z-[10000] h-dvh w-screen bg-[#0d0916] p-4" : ""}`}>
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="min-w-0 flex-1 text-sm">
          {/* Connection state — only "connected" when PTY is verified */}
          {terminalStore.status === "error" ? (
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1.5 rounded bg-red-500/20 px-2 py-1 text-[10px] font-bold text-red-400">
                <AlertCircle size={10} /> PTY connection failed
                {terminalStore.failureStage && <span className="ml-1 text-[9px] text-red-300/70">({terminalStore.failureStage.replace(/_/g, " ")})</span>}
              </span>
              {terminalStore.error && (
                <span className="text-[9px] text-red-300/60" title={terminalStore.error}>{terminalStore.error.slice(0, 80)}</span>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRetryCount((c) => c + 1)}
                  className="rounded bg-red-500/20 px-2 py-1 text-[9px] font-bold text-red-300 hover:bg-red-500/30"
                  aria-label="Retry PTY connection"
                >
                  <RotateCcw size={10} className="mr-1 inline" /> Retry
                </button>
              </div>
            </div>
          ) : terminalStore.status === "auth_failed" ? (
            <span className="inline-flex items-center gap-1.5 rounded bg-red-500/20 px-2 py-1 text-[10px] font-bold text-red-400">
              <AlertCircle size={10} /> Authentication failed
            </span>
          ) : terminalStore.status === "unavailable" ? (
            <span className="inline-flex items-center gap-1.5 rounded bg-red-500/20 px-2 py-1 text-[10px] font-bold text-red-400">
              <AlertCircle size={10} /> PTY server unavailable
            </span>
          ) : terminalStore.status === "project_context_missing" ? (
            <span className="inline-flex items-center gap-1.5 rounded bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-300">
              <AlertCircle size={10} /> No project context
            </span>
          ) : terminalStore.status === "connecting" ? (
            <span className="inline-flex items-center gap-1.5 rounded bg-blue-500/20 px-2 py-1 text-[10px] font-bold text-blue-400">
              <Plug size={10} className="animate-pulse" /> Connecting to PTY…
            </span>
          ) : connected ? (
            <span className="inline-flex items-center gap-1.5 rounded bg-green-500/20 px-2 py-1 text-[10px] font-bold text-green-400">
              <Plug size={10} /> PTY connected (verified)
            </span>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1.5 rounded bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-300">
                <Plug size={10} /> PTY disconnected
                {terminalStore.lastDisconnectReason && (
                  <span className="ml-1 text-[9px] text-amber-300/70">({terminalStore.lastDisconnectReason})</span>
                )}
              </span>
              {terminalStore.error && (
                <span className="text-[9px] text-amber-300/60" title={terminalStore.error}>{terminalStore.error.slice(0, 80)}</span>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRetryCount((c) => c + 1)}
                  className="rounded bg-amber-500/20 px-2 py-1 text-[9px] font-bold text-amber-300 hover:bg-amber-500/30"
                  aria-label="Retry PTY connection"
                >
                  <RotateCcw size={10} className="mr-1 inline" /> Retry
                </button>
              </div>
            </div>
          )}
          {/* Repository, branch, CWD, approval mode + diagnostic info */}
          {(repositoryName || branch || (connected && sessionInfo)) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-neutral-500">
              {repositoryName && <span className="truncate"><span className="text-neutral-600">repo:</span> {repositoryName}</span>}
              {branch && <span className="truncate"><span className="text-neutral-600">branch:</span> {branch}</span>}
              {connected && sessionInfo && <span className="truncate"><span className="text-neutral-600">cwd:</span> {sessionInfo.cwd}</span>}
              {connected && sessionInfo && <span className="truncate"><span className="text-neutral-600">shell:</span> {sessionInfo.shell}</span>}
              {projectId && <span className="truncate"><span className="text-neutral-600">project:</span> {projectId.slice(0, 12)}…</span>}
              {connected && sessionInfo?.workspaceId && <span className="truncate"><span className="text-neutral-600">workspace:</span> {sessionInfo.workspaceId.slice(0, 16)}…</span>}
              {projectId && (
                <span className="truncate" title={
                  connected && sessionInfo?.workspaceId ? "Token is bound to this workspace" :
                  connected ? "Token issued — PTY connected" :
                  terminalStore.status === "connecting" ? "Token being fetched…" :
                  "No token — terminal not connected"
                }>
                  <span className="text-neutral-600">token:</span>{" "}
                  {connected && sessionInfo?.workspaceId ? (
                    <span className="text-green-400">bound</span>
                  ) : connected ? (
                    <span className="text-green-400">issued</span>
                  ) : terminalStore.status === "connecting" ? (
                    <span className="text-blue-400">fetching…</span>
                  ) : (
                    <span className="text-amber-400">none</span>
                  )}
                </span>
              )}
              <span className="truncate"><span className="text-neutral-600">approval:</span> {approvalMode === "auto" ? "auto-approve safe commands" : "manual approval for destructive commands"}</span>
            </div>
          )}
          {/* Latest connection error */}
          {terminalStore.error && terminalStore.status === "error" && (
            <div className="mt-1 text-[9px] text-red-400/70" title={terminalStore.error}>
              <span className="text-neutral-600">last error:</span> {terminalStore.error.slice(0, 80)}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={copyAllOutput}
            title={copiedAll ? "Copied!" : "Copy all output"}
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
            aria-label="Copy all terminal output"
          >
            {copiedAll ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
          </button>
          <button
            onClick={downloadLog}
            title="Download log"
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
            aria-label="Download terminal log"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={openFullLog}
            title="Open full log"
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
            aria-label="Open full terminal log in a new window"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
          <button
            onClick={resetTerminal}
            title="Reset"
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
            aria-label="Reset terminal"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            onClick={clearTerminal}
            title="Clear"
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
            aria-label="Clear terminal"
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

      <div className="relative flex-1 overflow-hidden mt-2">
        <div className="relative h-full w-full overflow-hidden rounded-xl border border-purple-500/20 terminal-glow">
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes terminal-pulse {
              0% { box-shadow: 0 0 10px rgba(168, 85, 247, 0.15); border-color: rgba(168, 85, 247, 0.2); }
              50% { box-shadow: 0 0 22px rgba(168, 85, 247, 0.35); border-color: rgba(168, 85, 247, 0.45); }
              100% { box-shadow: 0 0 10px rgba(168, 85, 247, 0.15); border-color: rgba(168, 85, 247, 0.2); }
            }
            @keyframes crt-flicker {
              0% { opacity: 0.992; }
              50% { opacity: 1; }
              100% { opacity: 0.988; }
            }
            .crt-scanlines {
              position: absolute;
              inset: 0;
              pointer-events: none;
              background: linear-gradient(
                rgba(18, 16, 16, 0) 50%,
                rgba(0, 0, 0, 0.12) 50%
              );
              background-size: 100% 3px;
              z-index: 10;
            }
            .terminal-glow {
              animation: terminal-pulse 3s infinite alternate, crt-flicker 0.25s infinite;
            }
          `}} />
          <div className="crt-scanlines" />
          <div
            ref={containerRef}
            className="h-full w-full p-3 bg-black"
          />
        </div>
      </div>
    </div>
  );
});
