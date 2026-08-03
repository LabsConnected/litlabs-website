"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AlertCircle, RotateCcw } from "lucide-react";
import LiTTPresence from "./LiTTPresence";

const TerminalPanel = dynamic(
  () => import("@/components/litt-terminal/TerminalPanel").then((m) => m.TerminalPanel),
  { ssr: false },
);

interface StudioTerminalDrawerProps {
  projectId: string | null;
  repositoryName?: string | null;
  branch?: string | null;
}

/**
 * StudioTerminalDrawer — clean PTY terminal for the Studio drawer.
 *
 * Replaces the old AgentsTerminalTool (Control Tower) which mixed
 * AI chat, provider picker, agent picker, topology, and logs.
 * This component renders ONLY a real PTY terminal with a compact
 * header showing project status.
 */
export default function StudioTerminalDrawer({ projectId, repositoryName, branch }: StudioTerminalDrawerProps) {
  const [workspaceStatus, setWorkspaceStatus] = useState<"idle" | "preparing" | "ready" | "error">("idle");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

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
        });
        if (cancelled) return;
        if (res.ok) {
          setWorkspaceStatus("ready");
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

  if (!projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <AlertCircle size={24} className="opacity-40" style={{ color: "var(--text-muted)" }} />
        <p className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
          No project selected. Choose or create a project to use the terminal.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Compact header */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
        style={{
          borderColor: "var(--studio-border)",
          backgroundColor: "var(--studio-surface)",
        }}
      >
        {/* LiTT compact terminal avatar */}
        <LiTTPresence
          state={workspaceStatus === "ready" ? "idle" : workspaceStatus === "preparing" ? "working" : workspaceStatus === "error" ? "error" : "idle"}
          variant="terminal"
          size="sm"
        />

        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Terminal
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor:
                  workspaceStatus === "ready" ? "#72f238" :
                  workspaceStatus === "preparing" ? "#e3b341" :
                  workspaceStatus === "error" ? "#ef4444" :
                  "rgba(255,255,255,0.2)",
              }}
            />
            <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
              {workspaceStatus === "preparing" ? "Preparing workspace…" :
               workspaceStatus === "ready" ? "Workspace ready" :
               workspaceStatus === "error" ? "Preparation failed" :
               "Connecting…"}
            </span>
          </div>
        </div>

        {/* Restart button */}
        <button
          type="button"
          onClick={() => {
            setWorkspaceStatus("preparing");
            setWorkspaceError(null);
            // Re-trigger preparation by changing the effect dependency
            void fetch(`/api/studio-projects/${projectId}/workspace/prepare`, { method: "POST" })
              .then(() => setWorkspaceStatus("ready"))
              .catch(() => { setWorkspaceStatus("error"); setWorkspaceError("Retry failed"); });
          }}
          className="grid h-7 w-7 place-items-center rounded-lg hover:bg-white/8"
          style={{ color: "var(--text-muted)" }}
          aria-label="Restart workspace"
          title="Restart workspace"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {/* Workspace error */}
      {workspaceError && (
        <div
          className="flex shrink-0 items-center gap-2 px-3 py-2 text-[11px]"
          style={{
            backgroundColor: "rgba(239,68,68,0.08)",
            color: "#fca5a5",
          }}
        >
          <AlertCircle size={12} className="shrink-0" />
          <span className="flex-1">{workspaceError}</span>
          <button
            type="button"
            onClick={() => { setWorkspaceError(null); setWorkspaceStatus("preparing"); }}
            className="rounded px-2 py-0.5 text-[10px] font-bold hover:bg-red-500/10"
          >
            Retry
          </button>
        </div>
      )}

      {/* Terminal PTY — only render when workspace is ready or preparing */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {(workspaceStatus === "ready" || workspaceStatus === "preparing") && (
          <TerminalPanel projectId={projectId} repositoryName={repositoryName} branch={branch} />
        )}
      </div>
    </div>
  );
}
