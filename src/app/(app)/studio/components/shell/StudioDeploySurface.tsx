"use client";

/**
 * StudioDeploySurface — the Deploy stage surface.
 *
 * Reads the durable deployment records for the active project
 * (/api/studio-projects/{id}/deployments) and offers the canonical deploy
 * paths: LiTT's project.deploy flow (approval-gated) on LiTT Hosting —
 * the default — or, at the user's explicit choice, to their own Netlify
 * account (also via project.deploy, also approval-gated; the approval
 * card names the target before anything publishes).
 *
 * Never fabricates a success state — "Deployed" only renders when the
 * server record for THAT target says so. When Netlify is selected but
 * not connected, the surface offers the connect step instead of a deploy
 * button that would only fail.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Rocket, Server } from "lucide-react";
import type { DeployTargetChoice } from "@/lib/deployments/deploy-targets";

type DeploymentRecord = {
  id: string;
  status?: string | null;
  target?: string | null;
  publicUrl?: string | null;
  urlVerified?: boolean | null;
  errorMessage?: string | null;
  fileCount?: number | null;
};

type DeployInfo = {
  deployment: DeploymentRecord | null;
  latestByTarget?: {
    "litt-static"?: DeploymentRecord | null;
    netlify?: DeploymentRecord | null;
  } | null;
  netlifyConnection?: { connected: boolean; accountName: string | null } | null;
  hosting?: { name?: string; configured?: boolean; reason?: string } | null;
};

const TARGET_OPTIONS: Array<{
  choice: DeployTargetChoice;
  label: string;
  hint: string;
}> = [
  { choice: "litt", label: "LiTT Hosting", hint: "Published on your LiTT site URL" },
  { choice: "netlify", label: "Netlify", hint: "Published to your own Netlify account" },
];

export default function StudioDeploySurface({
  projectId,
  onDeployRequest,
}: {
  projectId: string | null;
  /** Routes to the canonical deploy flow (ask-litt + approval gate). */
  onDeployRequest: (target: DeployTargetChoice) => void;
}) {
  const [target, setTarget] = useState<DeployTargetChoice>("litt");
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

  const info = state.info;
  const dep =
    target === "netlify"
      ? info?.latestByTarget?.netlify ?? null
      : info?.latestByTarget?.["litt-static"] ?? info?.deployment ?? null;
  const live = dep?.status === "ready";
  const netlifyConnected = info?.netlifyConnection?.connected === true;
  const netlifyBlocked = target === "netlify" && !netlifyConnected;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 overflow-y-auto p-8" data-testid="studio-deploy-surface">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center gap-2">
          <Rocket size={16} style={{ color: "var(--litt-primary)" }} />
          <h2 className="text-[15px] font-extrabold" style={{ color: "var(--text-main)" }}>Deploy</h2>
        </div>

        {/* Publish target — chosen here, named again on the approval card. */}
        <div className="mb-4" role="radiogroup" aria-label="Publish target">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Publish to
          </p>
          <div className="grid grid-cols-2 gap-2">
            {TARGET_OPTIONS.map((option) => {
              const selected = target === option.choice;
              return (
                <button
                  key={option.choice}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`deploy-target-${option.choice}`}
                  onClick={() => setTarget(option.choice)}
                  className="rounded-xl border px-3 py-2.5 text-left transition-colors"
                  style={{
                    borderColor: selected ? "rgba(190,145,255,0.55)" : "rgba(155,77,255,0.14)",
                    backgroundColor: selected ? "rgba(139,92,246,0.14)" : "transparent",
                  }}
                >
                  <span className="block text-[12px] font-extrabold" style={{ color: "var(--text-main)" }}>
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {option.choice === "netlify" && netlifyConnected && info?.netlifyConnection?.accountName
                      ? info.netlifyConnection.accountName
                      : option.hint}
                  </span>
                </button>
              );
            })}
          </div>
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
                    style={{ backgroundColor: live ? "var(--litt-primary)" : dep.status === "failed" ? "#f87171" : "#f5b544" }}
                    aria-hidden
                  />
                  <span className="text-[12px] font-bold capitalize" style={{ color: "var(--text-main)" }}>
                    {dep.status ?? "unknown"}
                  </span>
                  <span className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>
                    · {target === "netlify" ? "Netlify" : "LiTT Hosting"}
                  </span>
                </div>
                {live && dep.publicUrl && (
                  <a
                    href={dep.publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold underline-offset-2 hover:underline"
                    style={{ color: "var(--litt-primary)" }}
                  >
                    {dep.publicUrl.replace(/^https?:\/\//, "")}
                    <ExternalLink size={11} />
                  </a>
                )}
                {dep.status === "failed" && dep.errorMessage && (
                  <p className="mt-2 text-[11px]" style={{ color: "#fca5a5" }}>{dep.errorMessage}</p>
                )}
              </div>
            ) : (
              <p className="mb-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
                This project has not been deployed to {target === "netlify" ? "Netlify" : "LiTT Hosting"} yet.
              </p>
            )}

            {target === "litt" && state.info?.hosting?.configured === false && (
              <p className="mb-4 flex items-start gap-2 text-[11px]" style={{ color: "#f5b544" }}>
                <Server size={12} className="mt-0.5 shrink-0" />
                Hosting is not configured{state.info.hosting.reason ? `: ${state.info.hosting.reason}` : "."}
              </p>
            )}

            {netlifyBlocked ? (
              <div data-testid="deploy-netlify-connect-first">
                <p className="mb-3 flex items-start gap-2 text-[11px]" style={{ color: "#f5b544" }}>
                  <Server size={12} className="mt-0.5 shrink-0" />
                  Netlify isn&apos;t connected yet. Connect your Netlify account first — publishing uses your own Netlify token, stored securely.
                </p>
                <Link
                  href="/settings/connections"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-extrabold transition-colors"
                  style={{ borderColor: "rgba(190,145,255,0.35)", backgroundColor: "rgba(139,92,246,0.12)", color: "var(--text-main)" }}
                >
                  Connect Netlify in Settings
                </Link>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onDeployRequest(target)}
                data-testid="deploy-surface-deploy"
                className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-extrabold transition-colors"
                style={{ borderColor: "rgba(190,145,255,0.35)", backgroundColor: "rgba(139,92,246,0.12)", color: "var(--text-main)" }}
              >
                <Rocket size={14} className="pointer-events-none" style={{ color: "var(--litt-primary)" }} />
                {dep
                  ? target === "netlify" ? "Redeploy to Netlify" : "Redeploy with LiTT"
                  : target === "netlify" ? "Deploy to Netlify" : "Deploy with LiTT"}
              </button>
            )}
            <p className="mt-3 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
              Deploys run through LiTT and require your approval before they go live.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
