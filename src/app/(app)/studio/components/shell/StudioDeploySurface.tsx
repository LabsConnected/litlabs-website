"use client";

/**
 * StudioDeploySurface — the Deploy stage surface.
 *
 * Reads the durable deployment record for the active project
 * (/api/studio-projects/{id}/deployments) and offers the canonical deploy
 * path: LiTT's project.deploy flow (approval-gated). Never fabricates a
 * success state — "Deployed" only renders when the server record says so.
 */
import { useEffect, useState } from "react";
import { ExternalLink, Rocket, Server } from "lucide-react";

type DeploymentRecord = {
  id: string;
  environment?: string | null;
  status?: string | null;
  url?: string | null;
  branch?: string | null;
  commit_message?: string | null;
  created_at?: string | null;
};

type DeployInfo = {
  deployment: DeploymentRecord | null;
  hosting?: { name?: string; configured?: boolean; reason?: string } | null;
};

export default function StudioDeploySurface({
  projectId,
  onDeployRequest,
}: {
  projectId: string | null;
  /** Routes to the canonical LiTT deploy flow (ask-litt + approval gate). */
  onDeployRequest: () => void;
}) {
  const [state, setState] = useState<{ loading: boolean; info: DeployInfo | null; error: string | null }>({
    loading: true,
    info: null,
    error: null,
  });

  useEffect(() => {
    if (!projectId) {
      setState({ loading: false, info: null, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/deployments`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Deployments request failed (${res.status})`);
        return res.json() as Promise<DeployInfo>;
      })
      .then((info) => { if (!cancelled) setState({ loading: false, info, error: null }); })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, info: null, error: err instanceof Error ? err.message : "Failed to load deployments" });
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const dep = state.info?.deployment ?? null;
  const live = dep?.status === "ready" || dep?.status === "success" || dep?.status === "deployed";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 overflow-y-auto p-8" data-testid="studio-deploy-surface">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center gap-2">
          <Rocket size={16} style={{ color: "var(--litt-primary)" }} />
          <h2 className="text-[15px] font-extrabold" style={{ color: "var(--text-main)" }}>Deploy</h2>
        </div>

        {state.loading && (
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>Checking deployment status…</p>
        )}
        {state.error && (
          <p className="text-[12px]" style={{ color: "#fca5a5" }}>{state.error}</p>
        )}

        {!state.loading && !state.error && (
          <>
            {dep ? (
              <div className="glass-shell mb-4 rounded-xl border p-4" style={{ borderColor: "rgba(155,77,255,0.14)" }}>
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: live ? "var(--litt-primary)" : dep.status === "error" ? "#f87171" : "#f5b544" }}
                    aria-hidden
                  />
                  <span className="text-[12px] font-bold capitalize" style={{ color: "var(--text-main)" }}>
                    {dep.status ?? "unknown"}
                  </span>
                  {dep.environment && (
                    <span className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>· {dep.environment}</span>
                  )}
                </div>
                {dep.url && (
                  <a
                    href={dep.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold underline-offset-2 hover:underline"
                    style={{ color: "var(--litt-primary)" }}
                  >
                    {dep.url.replace(/^https?:\/\//, "")}
                    <ExternalLink size={11} />
                  </a>
                )}
                {(dep.branch || dep.commit_message || dep.created_at) && (
                  <p className="mt-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {[dep.branch, dep.commit_message, dep.created_at ? new Date(dep.created_at).toLocaleString() : null]
                      .filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            ) : (
              <p className="mb-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
                This project has not been deployed yet.
              </p>
            )}

            {state.info?.hosting?.configured === false && (
              <p className="mb-4 flex items-start gap-2 text-[11px]" style={{ color: "#f5b544" }}>
                <Server size={12} className="mt-0.5 shrink-0" />
                Hosting is not configured{state.info.hosting.reason ? `: ${state.info.hosting.reason}` : "."}
              </p>
            )}

            <button
              type="button"
              onClick={onDeployRequest}
              data-testid="deploy-surface-deploy"
              className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-extrabold transition-colors"
              style={{ borderColor: "rgba(190,145,255,0.35)", backgroundColor: "rgba(139,92,246,0.12)", color: "var(--text-main)" }}
            >
              <Rocket size={14} className="pointer-events-none" style={{ color: "var(--litt-primary)" }} />
              {dep ? "Redeploy with LiTT" : "Deploy with LiTT"}
            </button>
            <p className="mt-3 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
              Deploys run through LiTT and require your approval before they go live.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
