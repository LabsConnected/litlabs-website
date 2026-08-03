"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Eye, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";

type PreviewState = "loading" | "not_prepared" | "preparing" | "ready" | "stale" | "offline" | "failed";

interface PreviewPayload {
  runtimeStatus?: unknown;
  previewUrl?: unknown;
  runtimeError?: unknown;
}

function statusFromPayload(payload: PreviewPayload, workspaceStatus: string | null): { state: PreviewState; url: string | null; error: string | null } {
  const runtimeStatus = typeof payload.runtimeStatus === "string" ? payload.runtimeStatus : "stopped";
  const url = typeof payload.previewUrl === "string" && payload.previewUrl ? payload.previewUrl : null;
  const error = typeof payload.runtimeError === "string" && payload.runtimeError ? payload.runtimeError : null;
  if (runtimeStatus === "ready" && url) return { state: "ready", url, error: null };
  if (["starting", "preparing", "provisioning"].includes(runtimeStatus) || ["preparing", "provisioning"].includes(workspaceStatus ?? "")) return { state: "preparing", url, error };
  if (runtimeStatus === "failed" || workspaceStatus === "failed" || workspaceStatus === "error") return { state: "failed", url, error: error ?? "Preview infrastructure reported a failure" };
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
      setState(next.state);
      setPreviewUrl(next.url);
      setError(next.error);
      if (next.state === "ready") setFrameKey((value) => value + 1);
    } catch (loadError) {
      setState("offline");
      setError(loadError instanceof Error ? loadError.message : "Preview status is unavailable");
    }
  }, [authHeaders, projectId, workspaceStatus]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (refreshKey > 0) void loadStatus(true);
  }, [loadStatus, refreshKey]);

  const preparePreview = async () => {
    if (!projectId) return;
    setState("preparing");
    setError(null);
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
  const label = state === "loading" ? "Checking preview status…" : state === "preparing" ? "Preparing preview…" : state === "ready" ? "Preview ready" : state === "stale" ? "Preview may be stale" : state === "not_prepared" ? "Workspace not prepared" : state === "failed" ? "Preview failed" : "Preview unavailable";
  const detail = state === "not_prepared" ? "Prepare the project workspace before opening a preview." : state === "offline" ? "The project preview endpoint is not currently available." : state === "stale" ? "A file changed. Refreshing the project preview status." : error ?? "The preview surface reports only real project runtime state.";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="studio-preview-panel">
      <div className="flex shrink-0 items-start gap-2 rounded-xl border px-2.5 py-2" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
        <Eye size={14} className="mt-0.5 shrink-0" style={{ color: "var(--litt-primary)" }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{projectName ?? "Project preview"}</div>
          <div className="truncate text-[9px]" style={{ color: "var(--text-muted)" }}>{repositoryName ?? "No repository"} · {branch ?? "Branch unavailable"}</div>
        </div>
        <button type="button" onClick={() => void loadStatus(true)} disabled={state === "loading" || state === "preparing"} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg hover:bg-white/8 disabled:opacity-40" aria-label="Refresh preview status" title="Refresh preview status"><RefreshCw size={13} className={state === "stale" ? "animate-spin" : ""} /></button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
        {(state === "ready" || state === "stale") && displayUrl ? <iframe key={frameKey} title={`${projectName ?? "Project"} preview`} src={displayUrl} className="min-h-[260px] flex-1 border-0 bg-white" sandbox="allow-scripts allow-forms allow-modals" /> : <div className="flex min-h-[260px] flex-1 flex-col items-center justify-center gap-3 px-5 text-center"><div className="grid h-11 w-11 place-items-center rounded-xl" style={{ backgroundColor: "rgba(114,242,56,0.08)", color: "var(--litt-primary)" }}>{state === "loading" || state === "preparing" ? <Loader2 size={19} className="animate-spin" /> : <Eye size={19} />}</div><div className="text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>{label}</div><div className="max-w-[250px] text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>{detail}</div>{["not_prepared", "offline", "failed"].includes(state) && <button type="button" onClick={() => void preparePreview()} disabled={!projectId || state === "preparing"} className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[10px] font-bold disabled:opacity-40" style={{ backgroundColor: "var(--litt-primary)", color: "#000" }}><RotateCcw size={12} /> Prepare preview</button>}</div>}
        {(state === "ready" || state === "stale") && <div className="flex shrink-0 items-center gap-2 border-t px-2 py-1.5" style={{ borderColor: "var(--studio-border)" }}><span className="min-w-0 flex-1 truncate text-[9px]" style={{ color: state === "stale" ? "#e3b341" : "var(--text-muted)" }}>{label}</span>{previewUrl && <button type="button" onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")} className="flex min-h-10 items-center gap-1 rounded-md px-2 text-[9px] font-bold hover:bg-white/8" style={{ color: "var(--text-secondary)" }}><ExternalLink size={11} /> Open</button>}</div>}
      </div>
    </div>
  );
}
