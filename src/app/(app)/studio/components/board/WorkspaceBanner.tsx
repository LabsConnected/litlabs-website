"use client";

/**
 * WorkspaceBanner (Kimi wiring item 6) — the in-panel workspace state
 * banner, ported from Kimmy's WorkspaceBanner and wired to the REAL
 * workspace status.
 *
 * Rendered ONLY inside the board panels that depend on the workspace
 * (Preview, Checks, Files, Code, Browser — via BoardPanelBindings),
 * never as a global overlay. It appears when the workspace is not
 * ready and offers the real recovery paths:
 *
 *   Reconnect → POST /api/studio-projects/{id}/workspace/prepare via
 *               attemptWorkspacePrepare (the same guarded helper the
 *               terminal drawer uses — a settled HOST_EXECUTION_DISABLED
 *               verdict resolves without a request and renders as the
 *               honest unavailable state, with no futile retry).
 *   View logs → summons the board's Terminal / Logs panel.
 *
 * Dismissal hides the banner for that status only; it does NOT fake
 * recovery — the panel content underneath stays exactly as gated as
 * the real systems keep it, and a status change re-arms the banner.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { attemptWorkspacePrepare } from "@/lib/studio/host-exec-session";
import { HOST_EXECUTION_UNAVAILABLE_MESSAGE } from "@/lib/projects/runtime-state";

type BannerKind = "provisioning" | "error" | "disconnected" | "unavailable";

const IN_PROGRESS = new Set(["provisioning", "preparing"]);
const ERRORED = new Set(["error", "failed", "unavailable"]);

function bannerKindFor(workspaceStatus: string | null): BannerKind | null {
  if (!workspaceStatus || workspaceStatus === "ready") return null;
  if (IN_PROGRESS.has(workspaceStatus)) return "provisioning";
  if (ERRORED.has(workspaceStatus)) return "error";
  return "disconnected";
}

const KIND_COPY: Record<BannerKind, { title: string; detail: string }> = {
  provisioning: {
    title: "Workspace is provisioning",
    detail: "The project workspace is being prepared. Panels that need it will light up as soon as it is ready.",
  },
  error: {
    title: "Workspace hit an error",
    detail: "The project workspace is not connected. Reconnect to prepare it again, or open the terminal logs to see what happened.",
  },
  disconnected: {
    title: "Workspace isn't connected",
    detail: "This panel needs the project workspace. Reconnect to prepare it, or open the terminal logs for details.",
  },
  unavailable: {
    title: "Workspace unavailable here",
    detail: HOST_EXECUTION_UNAVAILABLE_MESSAGE,
  },
};

export default function WorkspaceBanner({
  projectId,
  workspaceStatus,
  onViewLogs,
}: {
  projectId: string | null;
  workspaceStatus: string | null;
  onViewLogs?: () => void;
}) {
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [settledUnavailable, setSettledUnavailable] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // A different project or a new status re-arms everything.
  useEffect(() => {
    setDismissedFor(null);
    setSettledUnavailable(false);
    setReconnectError(null);
  }, [projectId, workspaceStatus]);

  const derivedKind = bannerKindFor(workspaceStatus);
  const kind: BannerKind | null = settledUnavailable ? "unavailable" : derivedKind;
  if (!projectId || !kind) return null;
  const dismissKey = `${projectId}:${workspaceStatus ?? ""}:${kind}`;
  if (dismissedFor === dismissKey) return null;

  const copy = KIND_COPY[kind];
  const isError = kind === "error";
  const canReconnect = kind === "error" || kind === "disconnected";

  const handleReconnect = () => {
    if (!projectId || reconnecting) return;
    setReconnecting(true);
    setReconnectError(null);
    void attemptWorkspacePrepare(projectId, () =>
      fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/workspace/prepare`, {
        method: "POST",
        signal: AbortSignal.timeout(120000),
      }),
    ).then((outcome) => {
      if (!mountedRef.current) return;
      setReconnecting(false);
      if (outcome.kind === "unavailable") {
        setSettledUnavailable(true);
      } else if (outcome.kind === "failed") {
        setReconnectError(outcome.message);
      }
      // On "ready" the capabilities poll flips workspaceStatus to
      // "ready" and this banner unmounts on its own — nothing to fake.
    });
  };

  return (
    <div
      className="flex shrink-0 items-start gap-2 border-b px-3 py-2"
      style={{
        borderColor: "var(--studio-border)",
        backgroundColor: isError ? "rgba(239,68,68,0.07)" : "rgba(227,179,65,0.07)",
      }}
      data-testid="workspace-banner"
      data-banner-kind={kind}
      role="status"
    >
      {reconnecting ? (
        <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" style={{ color: "#e3b341" }} />
      ) : (
        <AlertTriangle size={13} className="mt-0.5 shrink-0" style={{ color: isError ? "#fca5a5" : "#e3b341" }} />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold" style={{ color: "var(--text-main)" }}>
          {reconnecting ? "Reconnecting workspace…" : copy.title}
        </p>
        <p className="mt-0.5 text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>
          {reconnectError ?? copy.detail}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {canReconnect && (
            <button
              type="button"
              onClick={handleReconnect}
              disabled={reconnecting}
              className="rounded-md border px-2 py-1 text-[10px] font-bold transition hover:bg-white/8 disabled:opacity-40"
              style={{ borderColor: "var(--studio-border)", color: "var(--text-main)" }}
              data-testid="workspace-banner-reconnect"
            >
              {reconnecting ? "Reconnecting…" : "Reconnect"}
            </button>
          )}
          {onViewLogs && kind !== "unavailable" && (
            <button
              type="button"
              onClick={onViewLogs}
              className="rounded-md border px-2 py-1 text-[10px] font-bold transition hover:bg-white/8"
              style={{ borderColor: "var(--studio-border)", color: "var(--text-secondary)" }}
              data-testid="workspace-banner-view-logs"
            >
              View logs
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDismissedFor(dismissKey)}
        className="grid h-6 w-6 shrink-0 place-items-center rounded transition hover:bg-white/8"
        style={{ color: "var(--text-muted)" }}
        aria-label="Dismiss workspace notice"
        data-testid="workspace-banner-dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
}
