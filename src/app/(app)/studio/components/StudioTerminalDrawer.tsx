"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertCircle, Minus, Play, Plus, RotateCcw, ScrollText, Terminal } from "lucide-react";
import { attemptWorkspacePrepare } from "@/lib/studio/host-exec-session";
import {
  HOST_EXECUTION_UNAVAILABLE_MESSAGE,
  HOST_EXECUTION_UNAVAILABLE_SHORT,
} from "@/lib/projects/runtime-state";
import {
  useBoardPanelStatusStore,
  type BoardPanelStatus,
} from "../stores/useBoardPanelStatusStore";
import {
  TERMINAL_LOG_KIND_COLORS,
  useTerminalLogStore,
} from "../stores/useTerminalLogStore";

const TerminalPanel = dynamic(
  () => import("@/components/litt-terminal/TerminalPanel").then((m) => m.TerminalPanel),
  { ssr: false },
);

interface StudioTerminalDrawerProps {
  projectId: string | null;
  repositoryName?: string | null;
  branch?: string | null;
  visible?: boolean;
}

type WorkspaceState = "idle" | "preparing" | "ready" | "error" | "unavailable";
type TerminalSessionState = "not_started" | "connecting" | "connected" | "disconnected" | "error";

export default function StudioTerminalDrawer({ projectId, repositoryName, branch, visible }: StudioTerminalDrawerProps) {
  // Kimi wiring item 9: Terminal | Logs tabs + font-size control. The
  // Logs tab renders the SAME onLog entries TerminalPanel emits (the
  // shared terminal log store — the phone peek strip reads it too).
  const [drawerTab, setDrawerTab] = useState<"terminal" | "logs">("terminal");
  const [fontSize, setFontSize] = useState(14);
  const logEntries = useTerminalLogStore((s) => s.entries);
  const appendLog = useTerminalLogStore((s) => s.append);
  const logsScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (drawerTab !== "logs") return;
    const el = logsScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [drawerTab, logEntries.length]);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceState>("idle");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [terminalSession, setTerminalSession] = useState<TerminalSessionState>(() => {
    if (typeof window === "undefined") return "not_started";
    // Auto-attach by default — only stay parked when the user explicitly opted out.
    return localStorage.getItem("litt:terminalAutoStart") === "0" ? "not_started" : "connecting";
  });

  // Auto-prepare workspace when projectId is available
  useEffect(() => {
    if (!projectId) {
      setWorkspaceStatus("idle");
      return;
    }
    setWorkspaceStatus("preparing");
    setWorkspaceError(null);

    let cancelled = false;
    (async () => {
      // attemptWorkspacePrepare resolves WITHOUT a request when this
      // project already returned the HOST_EXECUTION_DISABLED verdict this
      // session — remounts settle into the unavailable state instead of
      // re-POSTing prepare (and re-logging a 503) on every drawer open.
      const outcome = await attemptWorkspacePrepare(projectId, () =>
        fetch(`/api/studio-projects/${projectId}/workspace/prepare`, {
          method: "POST",
          // Provisioning can take a while, but it must still terminate.
          signal: AbortSignal.timeout(120000),
        }),
      );
      if (cancelled) return;
      if (outcome.kind === "ready") {
        setWorkspaceStatus("ready");
        // Auto-start terminal unless the user explicitly opted out.
        if (typeof window !== "undefined" && localStorage.getItem("litt:terminalAutoStart") !== "0") {
          setTerminalSession("connecting");
        }
      } else if (outcome.kind === "unavailable") {
        setWorkspaceStatus("unavailable");
        setWorkspaceError(HOST_EXECUTION_UNAVAILABLE_MESSAGE);
      } else {
        setWorkspaceStatus("error");
        setWorkspaceError(outcome.message);
      }
    })();

    return () => { cancelled = true; };
  }, [projectId]);

  // Kimi wiring item 2: publish this panel's own session status for
  // the board header dot (the drawer's session state, nothing derived).
  const setPanelStatus = useBoardPanelStatusStore((s) => s.setPanelStatus);
  useEffect(() => {
    const status: BoardPanelStatus =
      terminalSession === "connected"
        ? { tone: "ready", label: "Terminal connected" }
        : terminalSession === "connecting"
          ? { tone: "working", label: "Terminal connecting…", pulse: true }
          : terminalSession === "error"
            ? { tone: "error", label: "Terminal error" }
            : terminalSession === "disconnected"
              ? { tone: "idle", label: "Terminal disconnected" }
              : { tone: "idle", label: "Terminal not started" };
    setPanelStatus("terminal", status);
  }, [terminalSession, setPanelStatus]);
  useEffect(() => () => setPanelStatus("terminal", null), [setPanelStatus]);

  const handleRetry = () => {
    if (!projectId) return;
    // A settled HOST_EXECUTION_DISABLED verdict has no retry: the guard
    // resolves "unavailable" without a request, so this stays a no-op
    // state-wise instead of re-POSTing a preparation that cannot succeed.
    if (workspaceStatus === "unavailable") return;
    setWorkspaceStatus("preparing");
    setWorkspaceError(null);
    void attemptWorkspacePrepare(projectId, () =>
      fetch(`/api/studio-projects/${projectId}/workspace/prepare`, {
        method: "POST",
        signal: AbortSignal.timeout(120000),
      }),
    ).then((outcome) => {
      if (outcome.kind === "ready") {
        setWorkspaceStatus("ready");
      } else if (outcome.kind === "unavailable") {
        setWorkspaceStatus("unavailable");
        setWorkspaceError(HOST_EXECUTION_UNAVAILABLE_MESSAGE);
      } else {
        setWorkspaceStatus("error");
        setWorkspaceError(outcome.message);
      }
    });
  };

  if (!projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <AlertCircle size={20} className="opacity-40" style={{ color: "var(--text-muted)" }} />
        <p className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
          No project selected. Choose or create a project to use the terminal.
        </p>
      </div>
    );
  }

  const wsColor = workspaceStatus === "ready" ? "#72f238" : workspaceStatus === "preparing" ? "#e3b341" : workspaceStatus === "error" ? "#ef4444" : workspaceStatus === "unavailable" ? "#e3b341" : "rgba(255,255,255,0.2)";
  const wsLabel = workspaceStatus === "preparing" ? "Workspace provisioning…" : workspaceStatus === "ready" ? "Workspace ready" : workspaceStatus === "error" ? "Workspace error" : workspaceStatus === "unavailable" ? HOST_EXECUTION_UNAVAILABLE_SHORT : "Idle";
  const termColor = terminalSession === "connected" ? "#72f238" : terminalSession === "connecting" ? "#e3b341" : terminalSession === "error" ? "#ef4444" : "rgba(255,255,255,0.2)";
  const termLabel = terminalSession === "connected" ? "Connected" : terminalSession === "connecting" ? "Connecting…" : terminalSession === "error" ? "Error" : "Not started";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Compact context bar — single line, 32px */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-2"
        style={{ height: 32, borderColor: "var(--studio-border)", backgroundColor: "rgba(255,255,255,0.02)" }}
      >
        {repositoryName && (
          <span className="min-w-0 truncate text-[10px] font-medium" style={{ color: "var(--text-secondary)", maxWidth: 200 }} title={repositoryName}>
            {repositoryName}
          </span>
        )}
        {branch && (
          <>
            <span className="shrink-0" style={{ color: "var(--studio-border-strong)" }}>·</span>
            <span className="min-w-0 truncate text-[10px] font-medium" style={{ color: "var(--text-muted)", maxWidth: 120 }} title={branch}>{branch}</span>
          </>
        )}
        <div className="flex-1" />
        {/* Workspace status — label truncates with ellipsis rather than
            clipping when the drawer is narrow; full text stays in title. */}
        <span className="flex min-w-0 items-center gap-1 text-[10px] font-medium" style={{ color: "var(--text-muted)" }} title={wsLabel}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: wsColor }} />
          <span className="truncate">{wsLabel}</span>
        </span>
        {/* Terminal session status — separate from workspace */}
        <span className="flex min-w-0 items-center gap-1 text-[10px] font-medium" style={{ color: "var(--text-muted)" }} title={termLabel}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: termColor }} />
          <span className="truncate">{termLabel}</span>
        </span>
        {workspaceStatus !== "unavailable" && (
          <button
            type="button"
            onClick={handleRetry}
            className="grid h-5 w-5 shrink-0 place-items-center rounded transition hover:bg-white/8"
            style={{ color: "var(--text-muted)" }}
            aria-label="Restart workspace"
            title="Restart workspace"
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>

      {/* Workspace error inline — a settled host-execution verdict renders
          as an amber explanation with NO retry affordance, not a failure. */}
      {workspaceError && (
        <div
          className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-[10px]"
          style={
            workspaceStatus === "unavailable"
              ? { backgroundColor: "rgba(227,179,65,0.08)", color: "#e3b341" }
              : { backgroundColor: "rgba(239,68,68,0.08)", color: "#fca5a5" }
          }
        >
          <AlertCircle size={11} className="shrink-0" />
          <span className="flex-1 truncate" title={workspaceError}>{workspaceError}</span>
          {workspaceStatus !== "unavailable" && (
            <button
              type="button"
              onClick={handleRetry}
              className="rounded px-1.5 py-0.5 text-[9px] font-bold hover:bg-red-500/10"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Tabs (Kimi wiring item 9): Terminal | Logs, with the font-size
          control on the right. The Logs tab shows the terminal's own
          connection/session log — real onLog entries, nothing invented. */}
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2"
        style={{ height: 30, borderColor: "var(--studio-border)", backgroundColor: "rgba(255,255,255,0.02)" }}
        role="tablist"
        aria-label="Terminal views"
      >
        <button
          type="button"
          role="tab"
          aria-selected={drawerTab === "terminal"}
          onClick={() => setDrawerTab("terminal")}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold transition"
          style={{
            color: drawerTab === "terminal" ? "var(--text-primary)" : "var(--text-muted)",
            backgroundColor: drawerTab === "terminal" ? "rgba(255,255,255,0.06)" : "transparent",
          }}
        >
          <Terminal size={11} /> Terminal
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={drawerTab === "logs"}
          onClick={() => setDrawerTab("logs")}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold transition"
          style={{
            color: drawerTab === "logs" ? "var(--text-primary)" : "var(--text-muted)",
            backgroundColor: drawerTab === "logs" ? "rgba(255,255,255,0.06)" : "transparent",
          }}
        >
          <ScrollText size={11} /> Logs
          {logEntries.length > 0 && (
            <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>{logEntries.length}</span>
          )}
        </button>
        <div className="flex-1" />
        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Font</span>
        <button
          type="button"
          onClick={() => setFontSize((s) => Math.max(11, s - 1))}
          disabled={fontSize <= 11}
          className="grid h-5 w-5 place-items-center rounded transition hover:bg-white/8 disabled:opacity-30"
          style={{ color: "var(--text-muted)" }}
          aria-label="Decrease terminal font size"
        >
          <Minus size={11} />
        </button>
        <span className="w-5 text-center text-[10px] tabular-nums" style={{ color: "var(--text-secondary)" }}>{fontSize}</span>
        <button
          type="button"
          onClick={() => setFontSize((s) => Math.min(15, s + 1))}
          disabled={fontSize >= 15}
          className="grid h-5 w-5 place-items-center rounded transition hover:bg-white/8 disabled:opacity-30"
          style={{ color: "var(--text-muted)" }}
          aria-label="Increase terminal font size"
        >
          <Plus size={11} />
        </button>
      </div>

      {/* Terminal content area. The terminal branch stays MOUNTED while
          the Logs tab is shown (hidden, not unmounted) — unmounting
          TerminalPanel would tear down the live PTY session just to
          look at its logs. The logs render as an overlay instead. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className={drawerTab === "logs" ? "hidden" : "h-full"}>
        {workspaceStatus === "ready" && terminalSession !== "not_started" ? (
          <TerminalPanel
            projectId={projectId}
            repositoryName={repositoryName}
            branch={branch}
            visible={visible}
            fontSize={fontSize}
            onLog={appendLog}
            onConnectionChange={(connected) => {
              setTerminalSession(connected ? "connected" : "disconnected");
              // Remember successful connects so the terminal keeps auto-attaching.
              // Transient disconnects must NOT opt the user out — only an
              // explicit "0" in localStorage disables auto-start.
              try { if (connected) localStorage.setItem("litt:terminalAutoStart", "1"); } catch {}
            }}
          />
        ) : workspaceStatus === "ready" && terminalSession === "not_started" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="text-center">
              <p className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
                Terminal session not started
              </p>
              <p className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                Workspace is ready. Click to start a PTY session.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                try { localStorage.setItem("litt:terminalAutoStart", "1"); } catch {}
                setTerminalSession("connecting");
              }}
              className="flex items-center gap-1.5 rounded-md border border-accent/20 bg-accent/10 px-3 py-1.5 text-[11px] font-bold text-accent transition hover:bg-accent/20"
            >
              <Play size={12} />
              Start Terminal
            </button>
          </div>
        ) : workspaceStatus === "preparing" ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
              <span className="h-2 w-2 animate-pulse rounded-full" style={{ backgroundColor: "#e3b341" }} />
              Connecting to workspace…
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[11px]" style={{ color: "var(--text-muted)" }}>
            Terminal unavailable
          </div>
        )}
        </div>
        {drawerTab === "logs" && (
          <div
            ref={logsScrollRef}
            className="absolute inset-0 overflow-y-auto px-3 py-2"
            style={{ backgroundColor: "var(--studio-surface)" }}
            data-testid="terminal-logs"
          >
            {logEntries.length === 0 ? (
              <p className="py-4 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
                No log lines yet — connection and session events from the terminal appear here.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5 font-mono text-[10px] leading-relaxed">
                {logEntries.map((entry) => (
                  <div key={entry.id} className="flex gap-2">
                    <span className="shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>{entry.time}</span>
                    <span className="min-w-0 break-words" style={{ color: TERMINAL_LOG_KIND_COLORS[entry.kind] }}>{entry.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
