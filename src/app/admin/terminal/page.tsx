"use client";
export const dynamic = "force-dynamic";

import { useState, useEffect, useRef, useCallback, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useTheme } from "@/context/ThemeContext";
import {
  Terminal,
  AlertTriangle,
  X,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
  Trash2,
} from "lucide-react";

// ─── Auth guard ────────────────────────────────────────────────────────────────
const ADMIN_USER_ID = "user_litbit";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface OutputLine {
  id: string;
  type: "input" | "stdout" | "stderr" | "error" | "info";
  text: string;
  ts: number;
}

interface CommandLogEntry {
  id: string;
  timestamp: string;
  agent: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
  metadata: {
    command?: string;
    args?: string[];
    exitCode?: number | null;
    durationMs?: number;
    ok?: boolean;
  } | null;
}

// ─── ANSI colour parser (no deps) ──────────────────────────────────────────────

const ANSI_RESET = "\x1b[0m";
const ANSI_RE = /\x1b\[([0-9;]*)m/g;

const ANSI_COLOURS: Record<string, string> = {
  "30": "#4a4a4a",
  "31": "#ff5f56",
  "32": "#27c93f",
  "33": "#ffbd2e",
  "34": "#579cf7",
  "35": "#d78cff",
  "36": "#56d4e0",
  "37": "#f0f0f0",
  "90": "#6a6a6a",
  "91": "#ff6b6b",
  "92": "#5af78e",
  "93": "#f4f99d",
  "94": "#caa9fa",
  "95": "#ff92d0",
  "96": "#9aedfe",
  "97": "#ffffff",
};

function ansiToSpans(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let currentColor: string | null = null;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  ANSI_RE.lastIndex = 0;

  const pushText = (str: string, color: string | null) => {
    if (!str) return;
    if (color) {
      parts.push(
        <span key={parts.length} style={{ color }}>
          {str}
        </span>,
      );
    } else {
      parts.push(<span key={parts.length}>{str}</span>);
    }
  };

  while ((match = ANSI_RE.exec(text)) !== null) {
    pushText(text.slice(lastIndex, match.index), currentColor);
    lastIndex = match.index + match[0].length;
    const code = match[1];
    if (code === "0" || code === "" || match[0] === ANSI_RESET) {
      currentColor = null;
    } else {
      currentColor = ANSI_COLOURS[code] ?? null;
    }
  }
  pushText(text.slice(lastIndex), currentColor);
  return parts;
}

// ─── Command history persistence ───────────────────────────────────────────────

const HISTORY_KEY = "litlabs_terminal_history";
const MAX_HISTORY = 100;

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(history: string[]) {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(history.slice(-MAX_HISTORY)),
    );
  } catch {}
}

// ─── Main component ────────────────────────────────────────────────────────────

let lineIdCounter = 0;
function makeId() {
  return `line-${++lineIdCounter}`;
}

export default function AdminTerminal() {
  const { resolvedColors: T } = useTheme();
  const { userId, isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();

  const [output, setOutput] = useState<OutputLine[]>([
    {
      id: makeId(),
      type: "info",
      text: "LiTTree-LabStudios Admin Terminal — commands run as the server OS user.",
      ts: Date.now(),
    },
    {
      id: makeId(),
      type: "info",
      text: "Type a command and press Enter. Try: git status  |  git log -5  |  npm run lint",
      ts: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [abortCtrl, setAbortCtrl] = useState<AbortController | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const [cmdLogs, setCmdLogs] = useState<CommandLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isLoaded && (!isSignedIn || userId !== ADMIN_USER_ID)) {
      router.push("/");
    }
  }, [isLoaded, isSignedIn, userId, router]);

  // ── Load command history from localStorage ────────────────────────────────
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // ── Auto-scroll output ────────────────────────────────────────────────────
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // ── Load audit logs ───────────────────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/agents/logs?type=commands&limit=30");
      if (res.ok) {
        const data = await res.json();
        setCmdLogs(data);
      }
    } catch {}
    setLogsLoading(false);
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // ── Parse input into command + args ──────────────────────────────────────
  function parseInput(raw: string): { command: string; args: string[] } | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const tokens: string[] = [];
    let current = "";
    let inQuote: '"' | "'" | null = null;

    for (const ch of trimmed) {
      if (inQuote) {
        if (ch === inQuote) {
          inQuote = null;
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === " ") {
        if (current) {
          tokens.push(current);
          current = "";
        }
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current);
    if (!tokens.length) return null;

    return { command: tokens[0], args: tokens.slice(1) };
  }

  // ── Run command ───────────────────────────────────────────────────────────
  const runCommand = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || running) return;

      // Add to output
      const inputLine: OutputLine = {
        id: makeId(),
        type: "input",
        text: `$ ${trimmed}`,
        ts: Date.now(),
      };
      setOutput((prev) => [...prev, inputLine]);

      // Update history
      const newHistory = [...history.filter((h) => h !== trimmed), trimmed];
      setHistory(newHistory);
      saveHistory(newHistory);
      setHistoryIdx(-1);
      setInput("");

      // Parse
      const parsed = parseInput(trimmed);
      if (!parsed) {
        setOutput((prev) => [
          ...prev,
          {
            id: makeId(),
            type: "error",
            text: "Could not parse command.",
            ts: Date.now(),
          },
        ]);
        return;
      }

      setRunning(true);
      const ctrl = new AbortController();
      setAbortCtrl(ctrl);

      const start = Date.now();

      try {
        const res = await fetch("/api/agents/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: parsed.command, args: parsed.args }),
          signal: ctrl.signal,
        });

        const data = await res.json();
        const elapsed = Date.now() - start;

        if (!res.ok) {
          setOutput((prev) => [
            ...prev,
            {
              id: makeId(),
              type: "error",
              text: data.error ?? `HTTP ${res.status}`,
              ts: Date.now(),
            },
          ]);
        } else {
          if (data.stdout) {
            data.stdout.split("\n").forEach((line: string) => {
              setOutput((prev) => [
                ...prev,
                { id: makeId(), type: "stdout", text: line, ts: Date.now() },
              ]);
            });
          }
          if (data.stderr) {
            data.stderr.split("\n").forEach((line: string) => {
              if (line.trim()) {
                setOutput((prev) => [
                  ...prev,
                  { id: makeId(), type: "stderr", text: line, ts: Date.now() },
                ]);
              }
            });
          }
          if (data.error) {
            setOutput((prev) => [
              ...prev,
              { id: makeId(), type: "error", text: data.error, ts: Date.now() },
            ]);
          }

          const exitLabel =
            data.exitCode === 0 || data.exitCode === null
              ? ""
              : ` [exit ${data.exitCode}]`;
          setOutput((prev) => [
            ...prev,
            {
              id: makeId(),
              type: "info",
              text: `Done in ${elapsed}ms${exitLabel}${data.truncated ? " (output truncated)" : ""}`,
              ts: Date.now(),
            },
          ]);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setOutput((prev) => [
            ...prev,
            {
              id: makeId(),
              type: "info",
              text: "Command cancelled.",
              ts: Date.now(),
            },
          ]);
        } else {
          setOutput((prev) => [
            ...prev,
            {
              id: makeId(),
              type: "error",
              text: `Network error: ${(err as Error).message}`,
              ts: Date.now(),
            },
          ]);
        }
      } finally {
        setRunning(false);
        setAbortCtrl(null);
        // Refresh audit log
        fetchLogs();
        inputRef.current?.focus();
      }
    },
    [running, history, fetchLogs],
  );

  // ── Keyboard handling ─────────────────────────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      runCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const newIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(newIdx);
      setInput(history[history.length - 1 - newIdx] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx <= 0) {
        setHistoryIdx(-1);
        setInput("");
      } else {
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        setInput(history[history.length - 1 - newIdx] ?? "");
      }
    }
  };

  // ── Loading / access denied states ───────────────────────────────────────
  if (!isLoaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: T.bgColor }}
      >
        <RefreshCw
          className="animate-spin"
          size={28}
          style={{ color: T.accentColor }}
        />
      </div>
    );
  }

  if (!isSignedIn || userId !== ADMIN_USER_ID) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: T.bgColor }}
      >
        <div className="text-center">
          <AlertTriangle
            size={48}
            className="mx-auto mb-4"
            style={{ color: T.warning }}
          />
          <p style={{ color: T.textMuted }}>Access Denied — Admin Only</p>
        </div>
      </div>
    );
  }

  // ── Colour helpers for output lines ──────────────────────────────────────
  const lineColor = (type: OutputLine["type"]) => {
    switch (type) {
      case "input":
        return T.accentColor;
      case "stdout":
        return T.textColor;
      case "stderr":
        return T.warning;
      case "error":
        return "#ff5f56";
      case "info":
        return T.textMuted;
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        backgroundColor: T.bgColor,
        color: T.textColor,
        fontFamily: "monospace",
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b"
        style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
      >
        <div className="flex items-center gap-3">
          <Terminal size={20} style={{ color: T.accentColor }} />
          <span className="font-bold text-base" style={{ color: T.textColor }}>
            Admin Terminal
          </span>
        </div>
        <div
          className="flex items-center gap-3 text-xs"
          style={{ color: T.textMuted }}
        >
          <span
            className="px-2 py-1 rounded"
            style={{
              backgroundColor: T.warning + "22",
              color: T.warning,
              border: `1px solid ${T.warning}44`,
            }}
          >
            <AlertTriangle size={11} className="inline mr-1" />
            Commands run as the server OS user
          </span>
          <button
            className="ml-3 px-3 py-1 rounded text-xs transition-all hover:opacity-80"
            style={{
              backgroundColor: T.bgColor,
              border: `1px solid ${T.borderColor}`,
              color: T.textMuted,
            }}
            onClick={() => router.push("/admin")}
          >
            ← Back to Admin
          </button>
        </div>
      </div>

      {/* ── Main layout ─────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Output pane ─────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0">
          <div
            ref={outputRef}
            className="flex-1 overflow-auto p-4 text-sm leading-relaxed"
            style={{ minHeight: 0, maxHeight: "calc(100vh - 148px)" }}
            onClick={() => inputRef.current?.focus()}
          >
            {output.map((line) => (
              <div
                key={line.id}
                className="whitespace-pre-wrap break-all mb-0.5"
              >
                <span style={{ color: lineColor(line.type) }}>
                  {ansiToSpans(line.text)}
                </span>
              </div>
            ))}
            {running && (
              <div
                className="flex items-center gap-2 mt-1"
                style={{ color: T.textMuted }}
              >
                <RefreshCw size={12} className="animate-spin" />
                <span className="text-xs">Running…</span>
              </div>
            )}
          </div>

          {/* ── Input bar ─────────────────────────────────────────── */}
          <div
            className="flex items-center gap-2 px-4 py-3 border-t"
            style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
          >
            <ChevronRight
              size={16}
              style={{ color: T.accentColor, flexShrink: 0 }}
            />
            <input
              ref={inputRef}
              id="admin-terminal-command"
              name="adminTerminalCommand"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={running}
              placeholder={running ? "Command running…" : "Enter command…"}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              className="flex-1 bg-transparent outline-none text-sm font-mono"
              style={{ color: T.textColor, caretColor: T.accentColor }}
            />

            {running ? (
              <button
                onClick={() => {
                  abortCtrl?.abort();
                  setRunning(false);
                }}
                className="flex items-center gap-1 px-3 py-1 rounded text-xs transition-all hover:opacity-80"
                style={{
                  backgroundColor: "#ff5f5620",
                  color: "#ff5f56",
                  border: "1px solid #ff5f5640",
                }}
              >
                <X size={12} />
                Cancel
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => runCommand(input)}
                  disabled={!input.trim()}
                  className="px-3 py-1 rounded text-xs font-bold transition-all hover:opacity-80 disabled:opacity-40"
                  style={{
                    backgroundColor: T.accentColor + "22",
                    color: T.accentColor,
                    border: `1px solid ${T.accentColor}44`,
                  }}
                >
                  Run
                </button>
                <button
                  onClick={() => {
                    setOutput([
                      {
                        id: makeId(),
                        type: "info",
                        text: "Terminal cleared.",
                        ts: Date.now(),
                      },
                    ]);
                  }}
                  title="Clear output"
                  className="px-2 py-1 rounded text-xs transition-all hover:opacity-80"
                  style={{
                    backgroundColor: T.bgColor,
                    color: T.textMuted,
                    border: `1px solid ${T.borderColor}`,
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Audit log sidebar ────────────────────────────────────── */}
        <div
          className="w-80 shrink-0 flex flex-col border-l overflow-hidden"
          style={{ borderColor: T.borderColor, backgroundColor: T.boxBg }}
        >
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: T.borderColor }}
          >
            <span
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: T.textMuted }}
            >
              Audit Log
            </span>
            <button
              onClick={fetchLogs}
              disabled={logsLoading}
              className="p-1 rounded transition-all hover:opacity-70"
              title="Refresh logs"
              style={{ color: T.textMuted }}
            >
              <RefreshCw
                size={13}
                className={logsLoading ? "animate-spin" : ""}
              />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-2 space-y-1">
            {cmdLogs.length === 0 ? (
              <div
                className="text-xs text-center py-8"
                style={{ color: T.textMuted }}
              >
                {logsLoading ? "Loading…" : "No command logs yet"}
              </div>
            ) : (
              cmdLogs.map((log) => (
                <AuditEntry key={log.id} entry={log} T={T} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function AuditEntry({
  entry,
  T,
}: {
  entry: CommandLogEntry;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const ok = entry.level === "info" || entry.level === "success";
  const ts = new Date(entry.timestamp);
  const timeStr = ts.toLocaleTimeString();

  return (
    <div
      className="rounded-lg p-2 text-xs"
      style={{
        backgroundColor: T.bgColor,
        border: `1px solid ${T.borderColor}`,
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {ok ? (
          <CheckCircle size={11} style={{ color: T.success }} />
        ) : (
          <XCircle size={11} style={{ color: "#ff5f56" }} />
        )}
        <span
          className="font-mono flex-1 truncate"
          style={{ color: T.textColor }}
        >
          {entry.metadata?.command
            ? `${entry.metadata.command} ${(entry.metadata.args ?? []).join(" ")}`.trim()
            : entry.message.replace("[cmd] ", "")}
        </span>
      </div>
      <div className="flex items-center gap-2" style={{ color: T.textMuted }}>
        <Clock size={10} />
        <span>{timeStr}</span>
        {entry.metadata?.durationMs !== undefined && (
          <span>{entry.metadata.durationMs}ms</span>
        )}
        {entry.metadata?.exitCode !== undefined &&
          entry.metadata.exitCode !== null &&
          entry.metadata.exitCode !== 0 && (
            <span style={{ color: "#ff5f56" }}>
              exit {entry.metadata.exitCode}
            </span>
          )}
      </div>
    </div>
  );
}
