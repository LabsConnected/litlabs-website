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
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Rocket, Server, XCircle } from "lucide-react";
import type { DeployTargetChoice } from "@/lib/deployments/deploy-targets";
import {
  useBoardPanelStatusStore,
  type BoardPanelStatus,
} from "../../stores/useBoardPanelStatusStore";

type DeploymentRecord = {
  id: string;
  status?: string | null;
  target?: string | null;
  publicUrl?: string | null;
  urlVerified?: boolean | null;
  errorMessage?: string | null;
  fileCount?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type DeployInfo = {
  deployment: DeploymentRecord | null;
  /**
   * ACC-01 F8a: the project's ONE stable public address (LiTT Hosting
   * only) — always serves the latest ready publish. Presented as the
   * project's public address; per-deployment publicUrls remain the
   * immutable snapshot links shown in History.
   */
  stablePublicUrl?: string | null;
  latestByTarget?: {
    "litt-static"?: DeploymentRecord | null;
    netlify?: DeploymentRecord | null;
  } | null;
  history?: DeploymentRecord[] | null;
  netlifyConnection?: { connected: boolean; accountName: string | null } | null;
  hosting?: { name?: string; configured?: boolean; reason?: string } | null;
  project?: { workspaceStatus?: string | null } | null;
};

/** The real deployment lifecycle, as staged steps (Kimi wiring item 5).
 *  Stage state maps ONLY from the record's own status — building →
 *  Building, deploying → Publishing, ready → Live. No stage is ever
 *  shown complete before the record says so. */
const DEPLOY_STAGES = [
  { key: "building", label: "Building" },
  { key: "deploying", label: "Publishing" },
  { key: "ready", label: "Live" },
] as const;

function stageState(stageKey: string, status: string | null | undefined): "done" | "current" | "todo" {
  const order = DEPLOY_STAGES.findIndex((s) => s.key === status);
  const mine = DEPLOY_STAGES.findIndex((s) => s.key === stageKey);
  if (order < 0) return "todo";
  if (mine < order) return "done";
  if (mine === order) return status === "ready" ? "done" : "current";
  return "todo";
}

function targetLabel(target: string | null | undefined): string {
  return target === "netlify" ? "Netlify" : "LiTT Hosting";
}

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

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
  // ACC-01 F8b: a click used to vanish silently — the request pre-fills
  // the Chat panel's composer, and nothing on THIS surface said so.
  // The surface now acknowledges the hand-off where the click happened.
  const [requestSent, setRequestSent] = useState(false);
  const [state, setState] = useState<{ loading: boolean; info: DeployInfo | null; error: string | null }>({
    loading: true,
    info: null,
    error: null,
  });
  // The project's build-check state, read from the same checks payload
  // the Checks panel renders (Kimi wiring item 5 readiness). Null when
  // the read fails or no build check exists — readiness then claims
  // nothing about the build rather than inventing a pass or a failure.
  const [buildCheckStatus, setBuildCheckStatus] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const loadedForProjectRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setState({ loading: false, info: null, error: null });
      setBuildCheckStatus(null);
      loadedForProjectRef.current = null;
      return;
    }
    let cancelled = false;
    let pollTimer: number | null = null;
    // Poll refreshes stay silent (no loading flicker over live staged
    // progress); a first load — or a project switch — shows loading so
    // one project's records never render under another's name.
    const isInitialLoad = refreshTick === 0 || loadedForProjectRef.current !== projectId;
    loadedForProjectRef.current = projectId;
    setState((s) => ({ ...s, loading: isInitialLoad, error: null }));
    fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/deployments`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Deployments request failed (${res.status})`);
        return res.json() as Promise<DeployInfo>;
      })
      .then((info) => {
        if (cancelled) return;
        setState({ loading: false, info, error: null });
        // Staged progress is LIVE progress: while any target's latest
        // record is mid-flight, keep re-reading the real records.
        const inFlight = [info?.latestByTarget?.["litt-static"], info?.latestByTarget?.netlify, info?.deployment]
          .some((record) => record?.status === "building" || record?.status === "deploying");
        if (inFlight) {
          pollTimer = window.setTimeout(() => setRefreshTick((tick) => tick + 1), 3000);
        }
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, info: null, error: err instanceof Error ? err.message : "Failed to load deployments" });
      });
    fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/checks`, { credentials: "include", cache: "no-store" })
      .then(async (res) => (res.ok ? (res.json() as Promise<{ checks?: Array<{ id?: string; status?: string }> }>) : null))
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.checks)) return;
        const build = data.checks.find((check) => check.id === "build");
        setBuildCheckStatus(typeof build?.status === "string" ? build.status : null);
      })
      .catch(() => { /* readiness simply claims nothing about the build */ });
    return () => {
      cancelled = true;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
    };
  }, [projectId, refreshTick]);

  const info = state.info;
  const dep =
    target === "netlify"
      ? info?.latestByTarget?.netlify ?? null
      : info?.latestByTarget?.["litt-static"] ?? info?.deployment ?? null;
  const live = dep?.status === "ready";
  // The address presented for the selected target: LiTT Hosting shows
  // the project's STABLE address (F8a) so the link a user shares never
  // rotates; Netlify's own URL is already stable per site.
  const displayUrl =
    target === "netlify" ? dep?.publicUrl ?? null : info?.stablePublicUrl ?? dep?.publicUrl ?? null;
  const netlifyConnected = info?.netlifyConnection?.connected === true;
  const netlifyBlocked = target === "netlify" && !netlifyConnected;

  // ── Readiness (Kimi wiring item 5) ─────────────────────────────────
  // Blockers derive ONLY from facts this surface actually read: the
  // project row's workspace status (deployments payload), the hosting
  // configuration, the build check's real status, and an in-flight
  // deployment record. The publish itself still runs through
  // onDeployRequest → LiTT → Larry's approval card, exactly as before;
  // readiness only decides whether the button may offer it.
  const blockers: string[] = [];
  if (info) {
    const workspaceStatus = info.project?.workspaceStatus ?? null;
    if (workspaceStatus !== "ready") {
      blockers.push(
        workspaceStatus
          ? `Workspace is ${workspaceStatus} — it must be ready before deploying`
          : "Workspace status is unknown — reconnect the workspace before deploying",
      );
    }
    if (target === "litt" && info.hosting?.configured === false) {
      blockers.push(`LiTT Hosting is not configured${info.hosting.reason ? `: ${info.hosting.reason}` : ""}`);
    }
    if (buildCheckStatus === "failed") {
      blockers.push("The last build check failed — fix it before deploying");
    }
    if (dep && (dep.status === "building" || dep.status === "deploying")) {
      blockers.push("A deployment is already in progress");
    }
  }
  const readyToDeploy = Boolean(info) && !netlifyBlocked && blockers.length === 0;
  const inFlight = dep?.status === "building" || dep?.status === "deploying";
  const history = Array.isArray(info?.history) ? info.history : [];

  // Kimi wiring item 2: publish the selected target's deployment state
  // as this panel's own board-header status.
  const setPanelStatus = useBoardPanelStatusStore((s) => s.setPanelStatus);
  useEffect(() => {
    if (!info) return;
    const status: BoardPanelStatus =
      dep?.status === "ready"
        ? { tone: "live", label: `Live on ${targetLabel(target)}` }
        : dep?.status === "building" || dep?.status === "deploying"
          ? { tone: "working", label: dep.status === "building" ? "Building deployment" : "Publishing deployment", pulse: true }
          : dep?.status === "failed"
            ? { tone: "error", label: "Last deploy failed" }
            : { tone: "idle", label: "Not deployed yet" };
    setPanelStatus("deploy", status);
  }, [info, dep?.status, target, setPanelStatus]);
  useEffect(() => () => setPanelStatus("deploy", null), [setPanelStatus]);

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
                  onClick={() => {
                    setTarget(option.choice);
                    setRequestSent(false);
                  }}
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
                {live && displayUrl && (
                  <a
                    href={displayUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="deploy-live-url"
                    className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold underline-offset-2 hover:underline"
                    style={{ color: "var(--litt-primary)" }}
                  >
                    {displayUrl.replace(/^https?:\/\//, "")}
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

            {/* Staged progress (Kimi wiring item 5): the selected
                target's real record status, staged. Renders while a
                deploy is in flight and once it is live. */}
            {dep && (inFlight || live) && (
              <div className="mb-4 flex items-center gap-2" data-testid="deploy-stages" aria-label="Deployment progress">
                {DEPLOY_STAGES.map((stage) => {
                  const stateForStage = stageState(stage.key, dep.status);
                  return (
                    <div key={stage.key} className="flex items-center gap-1.5">
                      <span
                        className={`h-1 w-6 rounded-full ${stateForStage === "current" ? "animate-pulse" : ""}`}
                        style={{
                          backgroundColor:
                            stateForStage === "done"
                              ? "var(--litt-primary)"
                              : stateForStage === "current"
                                ? "var(--color-accent)"
                                : "var(--studio-border-strong)",
                        }}
                        aria-hidden
                      />
                      <span
                        className="text-[10px] font-bold"
                        style={{ color: stateForStage === "todo" ? "var(--text-muted)" : "var(--text-main)" }}
                      >
                        {stage.label}
                      </span>
                    </div>
                  );
                })}
                {inFlight && <Loader2 size={11} className="animate-spin" style={{ color: "var(--text-muted)" }} />}
              </div>
            )}

            {/* Readiness card (Kimi wiring item 5): every blocker is a
                fact read from the real systems above — never a guess.
                The netlify-not-connected case keeps its own
                connect-first surface below instead of a blocker row. */}
            {!netlifyBlocked && (
              <div className="glass-shell mb-4 rounded-xl border p-4" style={{ borderColor: "rgba(155,77,255,0.14)" }} data-testid="deploy-readiness">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  Publish readiness
                </p>
                {blockers.length > 0 ? (
                  <ul className="space-y-1.5">
                    {blockers.map((blocker) => (
                      <li key={blocker} className="flex items-start gap-1.5 text-[11px]" style={{ color: "#fca5a5" }}>
                        <XCircle size={12} className="mt-0.5 shrink-0" />
                        {blocker}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="space-y-1.5">
                    <li className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      <CheckCircle2 size={12} className="mt-0.5 shrink-0" style={{ color: "var(--litt-primary)" }} />
                      Workspace is ready
                    </li>
                    {buildCheckStatus === "passed" && (
                      <li className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        <CheckCircle2 size={12} className="mt-0.5 shrink-0" style={{ color: "var(--litt-primary)" }} />
                        Build check passing
                      </li>
                    )}
                    <li className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      <CheckCircle2 size={12} className="mt-0.5 shrink-0" style={{ color: "var(--litt-primary)" }} />
                      Target: {target === "netlify" ? "Netlify" : "LiTT Hosting"}
                    </li>
                  </ul>
                )}
              </div>
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
              <>
                <button
                  type="button"
                  onClick={() => {
                    setRequestSent(true);
                    onDeployRequest(target);
                  }}
                  disabled={!readyToDeploy}
                  data-testid="deploy-surface-deploy"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ borderColor: "rgba(190,145,255,0.35)", backgroundColor: "rgba(139,92,246,0.12)", color: "var(--text-main)" }}
                >
                  <Rocket size={14} className="pointer-events-none" style={{ color: "var(--litt-primary)" }} />
                  {dep
                    ? target === "netlify" ? "Redeploy to Netlify" : "Redeploy with LiTT"
                    : target === "netlify" ? "Deploy to Netlify" : "Deploy with LiTT"}
                </button>
                {/* The first blocker, printed where the disabled
                    button's reason belongs (Kimi wiring item 5). */}
                {blockers.length > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px]" style={{ color: "#f5b544" }} data-testid="deploy-first-blocker">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    {blockers[0]}
                  </p>
                )}
                {/* F8b hand-off note: the deploy request lives in the
                    Chat panel now (composer pre-filled, approval still
                    gated) — say so here, where the click happened. */}
                {requestSent && blockers.length === 0 && (
                  <p className="mt-2 text-[11px]" style={{ color: "var(--text-secondary)" }} data-testid="deploy-request-sent">
                    Sent to LiTT — your deploy request is waiting in the Chat panel. Press Send there, and LiTT will ask for your approval before anything goes live.
                  </p>
                )}
              </>
            )}
            <p className="mt-3 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
              Deploys run through LiTT and require your approval before they go live.
            </p>

            {/* History (Kimi wiring item 5): the project's real
                deployment records, newest first. No rollback buttons —
                no rollback path exists in this system, so none is
                offered. */}
            {history.length > 0 && (
              <div className="mt-5" data-testid="deploy-history">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  History
                </p>
                <ul className="space-y-1.5">
                  {history.slice(0, 8).map((record) => {
                    const when = formatWhen(record.createdAt);
                    return (
                      <li
                        key={record.id}
                        className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
                        style={{ borderColor: "var(--studio-border)" }}
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              record.status === "ready"
                                ? "var(--litt-primary)"
                                : record.status === "failed"
                                  ? "#f87171"
                                  : "#f5b544",
                          }}
                          aria-hidden
                        />
                        <span className="text-[11px] font-bold capitalize" style={{ color: "var(--text-main)" }}>
                          {record.status ?? "unknown"}
                        </span>
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {targetLabel(record.target)}
                        </span>
                        {when && (
                          <span className="ml-auto shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>
                            {when}
                          </span>
                        )}
                        {record.status === "ready" && record.publicUrl && (
                          <a
                            href={record.publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 hover:underline"
                            style={{ color: "var(--litt-primary)" }}
                            aria-label={`Open the ${targetLabel(record.target)} deployment`}
                          >
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
