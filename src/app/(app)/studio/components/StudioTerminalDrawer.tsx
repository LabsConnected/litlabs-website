"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AlertCircle, RotateCcw, Play } from "lucide-react";

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

type WorkspaceState = "idle" | "preparing" | "ready" | "error";
type TerminalSessionState = "not_started" | "connecting" | "connected" | "disconnected" | "error";

export default function StudioTerminalDrawer({ projectId, repositoryName, branch, visible }: StudioTerminalDrawerProps) {
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
      try {
        const res = await fetch(`/api/studio-projects/${projectId}/workspace/prepare`, {
          method: "POST",
          // Provisioning can take a while, but it must still terminate.
          signal: AbortSignal.timeout(120000),
        });
        if (cancelled) return;
        if (res.ok) {
          setWorkspaceStatus("ready");
          // Auto-start terminal unless the user explicitly opted out.
          if (typeof window !== "undefined" && localStorage.getItem("litt:terminalAutoStart") !== "0") {
            setTerminalSession("connecting");
          }
        } else {
          const data = await res.json().catch(() => ({}));
          setWorkspaceStatus("error");
          setWorkspaceError(data.error ?? "Workspace preparation failed");
        }
      } catch {
        if (!cancelled) {
          setWorkspaceStatus("error");
          setWorkspaceError("Network error during workspace preparation");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [projectId]);

  const handleRetry = () => {
    if (!projectId) return;
    setWorkspaceStatus("preparing");
    setWorkspaceError(null);
    void fetch(`/api/studio-projects/${projectId}/workspace/prepare`, {
      method: "POST",
      signal: AbortSignal.timeout(120000),
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.workspaceStatus === "ready") {
            setWorkspaceStatus("ready");
          } else if (data.workspaceStatus === "provisioning") {
            setWorkspaceStatus("preparing");
          } else {
            setWorkspaceStatus("error");
            setWorkspaceError(data.error ?? "Workspace preparation failed");
          }
        } else {
          const data = await res.json().catch(() => ({}));
          setWorkspaceStatus("error");
          setWorkspaceError(data.error ?? `Preparation failed (${res.status})`);
        }
      })
      .catch(() => { setWorkspaceStatus("error"); setWorkspaceError("Network error during retry"); });
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

  const wsColor = workspaceStatus === "ready" ? "#72f238" : workspaceStatus === "preparing" ? "#e3b341" : workspaceStatus === "error" ? "#ef4444" : "rgba(255,255,255,0.2)";
  const wsLabel = workspaceStatus === "preparing" ? "Workspace provisioning…" : workspaceStatus === "ready" ? "Workspace ready" : workspaceStatus === "error" ? "Workspace error" : "Idle";
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
      </div>

      {/* Workspace error inline */}
      {workspaceError && (
        <div
          className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-[10px]"
          style={{ backgroundColor: "rgba(239,68,68,0.08)", color: "#fca5a5" }}
        >
          <AlertCircle size={11} className="shrink-0" />
          <span className="flex-1 truncate">{workspaceError}</span>
          <button
            type="button"
            onClick={handleRetry}
            className="rounded px-1.5 py-0.5 text-[9px] font-bold hover:bg-red-500/10"
          >
            Retry
          </button>
        </div>
      )}

      {/* Terminal content area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {workspaceStatus === "ready" && terminalSession !== "not_started" ? (
          <TerminalPanel
            projectId={projectId}
            repositoryName={repositoryName}
            branch={branch}
            visible={visible}
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
    </div>
  );
}
