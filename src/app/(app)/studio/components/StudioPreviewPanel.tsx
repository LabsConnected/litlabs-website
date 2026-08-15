"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Eye, Loader2, Monitor, RefreshCw, RotateCcw, Smartphone, Tablet } from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";

type PreviewState = "loading" | "not_prepared" | "starting" | "ready" | "stale" | "offline" | "failed" | "restarting";
type DeviceMode = "desktop" | "tablet" | "mobile";

const DEVICE_DIMENSIONS: Record<DeviceMode, { w: number; h: number; label: string }> = {
  desktop: { w: 0, h: 0, label: "1280 × 720" },
  tablet: { w: 768, h: 1024, label: "768 × 1024" },
  mobile: { w: 390, h: 844, label: "390 × 844" },
};

interface PreviewPayload {
  runtimeStatus?: unknown;
  previewUrl?: unknown;
  runtimeError?: unknown;
  framework?: unknown;
  developmentCommand?: unknown;
  packageManager?: unknown;
  logs?: unknown;
  port?: unknown;
}

function statusFromPayload(payload: PreviewPayload, workspaceStatus: string | null): { state: PreviewState; url: string | null; error: string | null } {
  const runtimeStatus = typeof payload.runtimeStatus === "string" ? payload.runtimeStatus : "stopped";
  const url = typeof payload.previewUrl === "string" && payload.previewUrl ? payload.previewUrl : null;
  const error = typeof payload.runtimeError === "string" && payload.runtimeError ? payload.runtimeError : null;
  if (runtimeStatus === "ready" && url) return { state: "ready", url, error: null };
  if (runtimeStatus === "starting") return { state: "starting", url, error };
  if (runtimeStatus === "restarting") return { state: "restarting", url, error };
  if (runtimeStatus === "failed") return { state: "failed", url, error: error ?? "Preview dev server crashed or failed to start" };
  if (["preparing", "provisioning"].includes(workspaceStatus ?? "")) return { state: "starting", url, error };
  if (workspaceStatus === "failed" || workspaceStatus === "error") return { state: "failed", url, error: error ?? "Workspace preparation failed" };
  if (workspaceStatus !== "ready") return { state: "not_prepared", url, error };
  return { state: "offline", url, error };
}

export default function StudioPreviewPanel({
  projectId,
  projectName,
  repositoryName,
  branch,
  workspaceStatus,
  refreshKey = 0,
}: {
  projectId: string | null;
  projectName: string | null;
  repositoryName: string | null;
  branch: string | null;
  workspaceStatus: string | null;
  refreshKey?: number;
}) {
  const { getToken } = useClerkAuth();
  const [state, setState] = useState<PreviewState>(projectId ? "loading" : "not_prepared");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop");
  const [maximized, setMaximized] = useState(false);
  const [framework, setFramework] = useState<string | null>(null);
  const [devCommand, setDevCommand] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [iframeFailed, setIframeFailed] = useState(false);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getToken]);

  const loadStatus = useCallback(async (stale = false) => {
    if (!projectId) {
      setState("not_prepared");
      setPreviewUrl(null);
      setError(null);
      return;
    }
    if (stale) setState((current) => current === "ready" ? "stale" : current);
    else setState("loading");
    setIframeFailed(false);
    try {
      const response = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/preview`, {
        cache: "no-store",
        credentials: "include",
        headers: await authHeaders(),
      });
      const payload = await response.json().catch(() => null) as PreviewPayload | null;
      if (!response.ok || !payload) {
        throw new Error(typeof payload?.runtimeError === "string" ? payload.runtimeError : `Preview status failed (${response.status})`);
      }
      const next = statusFromPayload(payload, workspaceStatus);
      setState((prevState) => {
        // Only reload iframe when transitioning from non-ready to ready
        if (next.state === "ready" && prevState !== "ready" && prevState !== "stale") {
          setFrameKey((value) => value + 1);
        }
        return next.state;
      });
      setPreviewUrl(next.url);
      setError(next.error);
      setFramework(typeof payload.framework === "string" ? payload.framework : null);
      setDevCommand(typeof payload.developmentCommand === "string" ? payload.developmentCommand : null);
      setLogs(Array.isArray(payload.logs) ? payload.logs as string[] : []);
    } catch (loadError) {
      setState("offline");
      setError(loadError instanceof Error ? loadError.message : "Preview status is unavailable");
    }
  }, [authHeaders, projectId, workspaceStatus]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Refresh when refreshKey prop changes (used by CodeWorkspace split view)
  useEffect(() => {
    if (refreshKey > 0) void loadStatus(true);
  }, [loadStatus, refreshKey]);

  // Listen for file change events from CodeWorkspace or other sources.
  // This covers the standalone Preview tab which doesn't receive refreshKey.
  useEffect(() => {
    if (!projectId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.projectId === projectId) {
        void loadStatus(true);
      }
    };
    window.addEventListener("studio:files-changed", handler);
    return () => window.removeEventListener("studio:files-changed", handler);
  }, [projectId, loadStatus]);

  // Auto-poll while starting, restarting, or loading
  useEffect(() => {
    if (state !== "starting" && state !== "restarting" && state !== "loading") return;
    const interval = setInterval(() => void loadStatus(true), 3000);
    return () => clearInterval(interval);
  }, [state, loadStatus]);

  const preparePreview = async () => {
    if (!projectId) return;
    setState("starting");
    setError(null);
    setIframeFailed(false);
    try {
      const response = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/preview`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      });
      const payload = await response.json().catch(() => null) as PreviewPayload | null;
      if (!response.ok || !payload) throw new Error(typeof payload?.runtimeError === "string" ? payload.runtimeError : `Preview preparation failed (${response.status})`);
      const next = statusFromPayload(payload, workspaceStatus);
      setState(next.state);
      setPreviewUrl(next.url);
      setError(next.error);
      if (next.state === "ready") setFrameKey((value) => value + 1);
    } catch (prepareError) {
      setState("failed");
      setError(prepareError instanceof Error ? prepareError.message : "Preview preparation failed");
    }
  };

  const displayUrl = previewUrl ? `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}studioRefresh=${frameKey}` : null;
  const label = state === "loading" ? "Checking preview status…" : state === "starting" ? "Starting dev server…" : state === "restarting" ? "Restarting dev server…" : state === "ready" ? (iframeFailed ? "Preview failed to load" : "Preview ready") : state === "stale" ? "Preview may be stale" : state === "not_prepared" ? "Preview not started" : state === "failed" ? "Preview crashed" : "Preview unavailable";
  const detail = state === "not_prepared" ? "The workspace needs preparation before a preview can start." : state === "offline" ? "The project preview endpoint is not currently available." : state === "starting" ? "Waiting for the dev server to respond…" : state === "restarting" ? "Restarting the dev server…" : state === "stale" ? "A file changed. Refreshing the project preview status." : error ?? "The preview surface reports only real project runtime state.";

  return (
    <div className={`flex flex-col gap-2 ${maximized ? "fixed inset-0 z-[300] p-3" : "h-full min-h-0"}`} data-testid="studio-preview-panel">
      <div className="flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-2" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
        <Eye size={14} className="shrink-0" style={{ color: "var(--litt-primary)" }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{projectName ?? "Project preview"}</span>
            {framework && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase" style={{ backgroundColor: "rgba(139,92,246,0.12)", color: "#9b4dff" }}>
                {framework}
              </span>
            )}
          </div>
          <div className="truncate text-[9px]" style={{ color: "var(--text-muted)" }}>{repositoryName ?? "No repository"} · {branch ?? "Branch unavailable"}</div>
        </div>
        {/* Device mode selector */}
        {(state === "ready" || state === "stale") && (
          <div className="flex items-center gap-0.5 rounded-lg border p-0.5" style={{ borderColor: "var(--studio-border)" }}>
            {([
              { mode: "desktop" as const, icon: Monitor, label: "Desktop" },
              { mode: "tablet" as const, icon: Tablet, label: "Tablet" },
              { mode: "mobile" as const, icon: Smartphone, label: "Mobile" },
            ]).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDeviceMode(mode)}
                className="grid h-7 w-7 place-items-center rounded-md transition"
                style={{
                  backgroundColor: deviceMode === mode ? "rgba(114,242,56,0.12)" : "transparent",
                  color: deviceMode === mode ? "var(--litt-primary)" : "var(--text-muted)",
                }}
                aria-label={label}
                aria-pressed={deviceMode === mode}
                title={label}
              >
                <Icon size={12} className="pointer-events-none" />
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => void loadStatus(true)} disabled={state === "loading" || state === "starting" || state === "restarting"} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg hover:bg-white/8 disabled:opacity-40" aria-label="Refresh preview status" title="Refresh preview status"><RefreshCw size={13} className={state === "stale" ? "animate-spin" : ""} /></button>
        {(state === "ready" || state === "stale" || state === "failed") && (
          <button type="button" onClick={() => void preparePreview()} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg hover:bg-white/8" aria-label="Restart preview" title="Restart preview runtime">
            <RotateCcw size={13} />
          </button>
        )}
        {(state === "ready" || state === "stale") && (
          <button type="button" onClick={() => setMaximized((v) => !v)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg hover:bg-white/8" aria-label={maximized ? "Exit fullscreen" : "Maximize preview"} title={maximized ? "Exit fullscreen" : "Maximize"}>
            {maximized ? <span className="text-[14px]">⤓</span> : <span className="text-[14px]">⤢</span>}
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
        {(state === "ready" || state === "stale") && displayUrl ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
            <iframe
              key={frameKey}
              title={`${projectName ?? "Project"} preview`}
              src={displayUrl}
              className="border-0 bg-white transition-all duration-200"
              style={{
                width: deviceMode === "desktop" ? "100%" : `${DEVICE_DIMENSIONS[deviceMode].w}px`,
                height: deviceMode === "desktop" ? "100%" : `${DEVICE_DIMENSIONS[deviceMode].h}px`,
                maxWidth: "100%",
                borderRadius: deviceMode === "desktop" ? "0" : "8px",
                boxShadow: deviceMode === "desktop" ? "none" : "0 4px 24px rgba(0,0,0,0.4)",
              }}
              sandbox="allow-scripts allow-forms allow-modals allow-same-origin allow-popups"
              onLoad={() => setIframeFailed(false)}
              onError={() => setIframeFailed(true)}
            />
          </div>
        ) : <div className="flex min-h-[260px] flex-1 flex-col items-center justify-center gap-3 px-5 text-center"><div className="grid h-11 w-11 place-items-center rounded-xl" style={{ backgroundColor: "rgba(114,242,56,0.08)", color: "var(--litt-primary)" }}>{state === "loading" || state === "starting" || state === "restarting" ? <Loader2 size={19} className="animate-spin" /> : <Eye size={19} />}</div><div className="text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>{label}</div><div className="max-w-[250px] text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>{detail}</div>{["not_prepared", "offline", "failed"].includes(state) && <button type="button" onClick={() => void preparePreview()} disabled={!projectId || state === "starting" || state === "restarting"} className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[10px] font-bold disabled:opacity-40" style={{ backgroundColor: "var(--litt-primary)", color: "#000" }}><RotateCcw size={12} /> Prepare preview</button>}</div>}
        {(state === "ready" || state === "stale") && <div className="flex shrink-0 items-center gap-2 border-t px-2 py-1.5" style={{ borderColor: "var(--studio-border)" }}><span className="min-w-0 flex-1 truncate text-[9px]" style={{ color: state === "stale" ? "#e3b341" : "var(--text-muted)" }}>{deviceMode !== "desktop" ? `${DEVICE_DIMENSIONS[deviceMode].label} · ` : ""}{label}{devCommand && <span style={{ color: "var(--text-muted)" }}> · {devCommand}</span>}</span>{logs.length > 0 && <button type="button" onClick={() => setLogsOpen((v) => !v)} className="flex min-h-10 items-center gap-1 rounded-md px-2 text-[9px] font-bold hover:bg-white/8" style={{ color: "var(--text-secondary)" }}>Logs</button>}{previewUrl && <button type="button" onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")} className="flex min-h-10 items-center gap-1 rounded-md px-2 text-[9px] font-bold hover:bg-white/8" style={{ color: "var(--text-secondary)" }}><ExternalLink size={11} /> Open</button>}</div>}
        {logsOpen && logs.length > 0 && (
          <div className="max-h-32 shrink-0 overflow-auto border-t px-2 py-1.5 font-mono text-[9px] leading-3" style={{ borderColor: "var(--studio-border)", backgroundColor: "rgba(0,0,0,0.15)", color: "var(--text-muted)" }}>
            {logs.slice(-50).map((line, i) => (
              <div key={i} className="truncate">{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
