"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown, CircleCheck, Clock3, Loader2, Play, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useProjectRuntime } from "../hooks/useProjectRuntime";
import { runtimePhaseLabel, runtimeRecoveryActions } from "@/lib/projects/runtime-state";

type CheckId = "build" | "typecheck" | "lint" | "test" | "security" | "accessibility" | "performance";
type CheckStatus = "not_run" | "running" | "passed" | "failed" | "unavailable" | "not_configured";

interface HealthCheck {
  id: CheckId;
  label: string;
  status: CheckStatus;
  source: string;
  timestamp: string | null;
  durationMs?: number | null;
  output?: string | null;
  error?: string | null;
  exitCode?: number | null;
  suggestedFix?: string | null;
}

interface PendingApproval {
  id: string;
  actionType?: string;
  affectedFiles?: string[];
  riskLevel?: string;
  diff?: string | null;
  createdAt?: string;
  expiresAt?: string | null;
}

interface HealthPayload {
  checks: HealthCheck[];
  changedFiles: string[];
  pendingApprovals: PendingApproval[];
  checkpoints: Array<{ id?: string; label?: string; gitSha?: string; createdAt?: string }>;
  project?: { workspaceStatus?: string; runtimeStatus?: string; runtimeError?: string | null };
  summary?: { total: number; passed: number; failed: number; notConfigured: number; changedFileCount: number };
}

const CHECK_IDS: CheckId[] = ["build", "typecheck", "lint", "test", "security", "accessibility", "performance"];
const RUNNABLE_CHECKS = new Set<CheckId>(["build", "typecheck", "lint", "test"]);

function isCheck(value: unknown): value is HealthCheck {
  if (!value || typeof value !== "object") return false;
  const check = value as Partial<HealthCheck>;
  return typeof check.id === "string" && CHECK_IDS.includes(check.id as CheckId) && typeof check.status === "string" && typeof check.source === "string";
}

function formatTime(timestamp: string | null | undefined): string {
  if (!timestamp) return "Not run";
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function statusColor(status: CheckStatus): string {
  if (status === "passed") return "var(--litt-primary)";
  if (status === "failed") return "#ef4444";
  if (status === "running") return "#a78bfa";
  if (status === "unavailable") return "#e3b341";
  if (status === "not_configured") return "var(--text-muted)";
  return "var(--text-muted)";
}

function statusLabel(status: CheckStatus): string {
  if (status === "not_run") return "Not run";
  if (status === "not_configured") return "Not configured";
  return status[0].toUpperCase() + status.slice(1).replace("_", " ");
}

export default function StudioHealthPanel({
  mode,
  projectId,
  refreshKey = 0,
  runTrigger = 0,
}: {
  mode: "checks" | "approvals";
  projectId: string | null;
  refreshKey?: number;
  /** Incremented externally to trigger run-all checks */
  runTrigger?: number;
}) {
  const { getToken } = useClerkAuth();
  const { state: runtime } = useProjectRuntime();
  const [payload, setPayload] = useState<HealthPayload>({ checks: [], changedFiles: [], pendingApprovals: [], checkpoints: [] });
  const [loading, setLoading] = useState(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<CheckId | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  const authHeaders = useCallback(async (json = false): Promise<HeadersInit> => {
    const token = await getToken?.();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [getToken]);

  const load = useCallback(async () => {
    if (!projectId) {
      setPayload({ checks: [], changedFiles: [], pendingApprovals: [], checkpoints: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/checks`, { cache: "no-store", credentials: "include", headers: await authHeaders() });
      const data = await response.json().catch(() => null) as Partial<HealthPayload> | null;
      if (!response.ok || !data || !Array.isArray(data.checks)) throw new Error(typeof (data as { error?: unknown } | null)?.error === "string" ? String((data as { error: string }).error) : `Checks request failed (${response.status})`);
      setPayload({
        checks: data.checks.filter(isCheck),
        changedFiles: Array.isArray(data.changedFiles) ? data.changedFiles.filter((value): value is string => typeof value === "string") : [],
        pendingApprovals: Array.isArray(data.pendingApprovals) ? data.pendingApprovals.filter((value): value is PendingApproval => Boolean(value && typeof value === "object" && typeof (value as PendingApproval).id === "string")) : [],
        checkpoints: Array.isArray(data.checkpoints) ? data.checkpoints.filter((value): value is NonNullable<HealthPayload["checkpoints"]>[number] => Boolean(value && typeof value === "object")) : [],
        project: data.project,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load project checks");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, projectId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (refreshKey > 0) void load(); }, [load, refreshKey]);

  // External trigger: when runTrigger increments, run all checks automatically
  const lastRunTrigger = useRef(0);
  useEffect(() => {
    if (runTrigger > 0 && runTrigger !== lastRunTrigger.current && mode === "checks" && projectId) {
      lastRunTrigger.current = runTrigger;
      void runAllChecks();
    }
  }, [runTrigger, mode, projectId]);

  const runCheck = async (id: CheckId) => {
    if (!projectId || !RUNNABLE_CHECKS.has(id)) return;
    setRunning(id);
    setError(null);
    setPayload((current) => ({ ...current, checks: current.checks.map((check) => check.id === id ? { ...check, status: "running" } : check) }));
    try {
      const response = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/checks`, { method: "POST", credentials: "include", headers: await authHeaders(true), body: JSON.stringify({ check: id }) });
      const data = await response.json().catch(() => null) as { check?: HealthCheck; error?: string } | null;
      if (!data?.check || !isCheck(data.check)) throw new Error(data?.error ?? `Malformed ${id} check response`);
      setPayload((current) => ({ ...current, checks: current.checks.map((check) => check.id === id ? data.check! : check) }));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : `Failed to run ${id}`);
      setPayload((current) => ({ ...current, checks: current.checks.map((check) => check.id === id ? { ...check, status: "failed", timestamp: new Date().toISOString(), error: runError instanceof Error ? runError.message : `Failed to run ${id}` } : check) }));
    } finally {
      setRunning(null);
    }
  };

  const runAllChecks = async () => {
    if (!projectId) return;
    setRunningAll(true);
    setError(null);
    // Mark all runnable checks as running
    setPayload((current) => ({
      ...current,
      checks: current.checks.map((check) => RUNNABLE_CHECKS.has(check.id as CheckId) ? { ...check, status: "running" as CheckStatus } : check),
    }));
    try {
      const response = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/checks/run-all`, {
        method: "POST",
        credentials: "include",
        headers: await authHeaders(true),
      });
      const data = await response.json().catch(() => null) as Partial<HealthPayload> | null;
      if (!data || !Array.isArray(data.checks)) {
        throw new Error(typeof (data as { error?: unknown } | null)?.error === "string" ? String((data as { error: string }).error) : "Run-all failed");
      }
      setPayload({
        checks: data.checks.filter(isCheck),
        changedFiles: Array.isArray(data.changedFiles) ? data.changedFiles.filter((value): value is string => typeof value === "string") : [],
        pendingApprovals: Array.isArray(data.pendingApprovals) ? data.pendingApprovals.filter((value): value is PendingApproval => Boolean(value && typeof value === "object" && typeof (value as PendingApproval).id === "string")) : [],
        checkpoints: Array.isArray(data.checkpoints) ? data.checkpoints.filter((value): value is NonNullable<HealthPayload["checkpoints"]>[number] => Boolean(value && typeof value === "object")) : [],
        project: data.project,
        summary: data.summary,
      });
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to run all checks");
    } finally {
      setRunningAll(false);
    }
  };

  const resolveApproval = async (approvalId: string, decision: "approved" | "denied") => {
    setResolving(approvalId);
    setError(null);
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(approvalId)}`, { method: "POST", credentials: "include", headers: await authHeaders(true), body: JSON.stringify({ decision }) });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? `Approval request failed (${response.status})`);
      await load();
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "Failed to resolve approval");
    } finally {
      setResolving(null);
    }
  };

  const checks = useMemo(() => CHECK_IDS.map((id) => payload.checks.find((check) => check.id === id) ?? {
    id,
    label: id === "typecheck" ? "TypeScript" : id[0].toUpperCase() + id.slice(1),
    status: "not_run" as const,
    source: "No result returned",
    timestamp: null,
    output: null,
    error: null,
  }), [payload.checks]);

  if (!projectId) return <div className="flex h-full min-h-40 items-center justify-center px-4 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>{mode === "checks" ? "Select a project to run checks." : "Select a project to view approvals."}</div>;

  if (mode === "approvals") {
    return (
      <div className="space-y-3" data-testid="studio-approvals-panel">
        <div className="flex items-center justify-between"><div><div className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>Pending approvals</div><div className="mt-1 text-[9px]" style={{ color: "var(--text-muted)" }}>Server-enforced actions for this project.</div></div><button type="button" onClick={() => void load()} disabled={loading} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-white/8 disabled:opacity-40" aria-label="Refresh approvals"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button></div>
        {error && <div className="rounded-lg border px-2.5 py-2 text-[9px]" style={{ borderColor: "rgba(239,68,68,0.3)", color: "#fca5a5" }}>{error}</div>}
        {loading ? <div className="flex items-center justify-center gap-2 py-8 text-[10px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> Loading approvals…</div> : payload.pendingApprovals.length === 0 ? <div className="flex flex-col items-center gap-2 py-8 text-[10px]" style={{ color: "var(--text-muted)" }}><ShieldCheck size={20} style={{ color: "var(--litt-primary)" }} /> No pending approvals.</div> : <div className="space-y-2">{payload.pendingApprovals.map((approval) => <div key={approval.id} className="rounded-xl border p-2.5" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}><div className="flex items-center justify-between"><span className="text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{approval.actionType ?? "Action"}</span>{approval.riskLevel && <span className="rounded px-1.5 py-0.5 text-[8px] font-black uppercase" style={{ backgroundColor: approval.riskLevel === "high" ? "rgba(239,68,68,0.15)" : "rgba(227,179,65,0.15)", color: approval.riskLevel === "high" ? "#fca5a5" : "#e3b341" }}>{approval.riskLevel}</span>}</div>{approval.affectedFiles && approval.affectedFiles.length > 0 && <div className="mt-1.5 space-y-0.5">{approval.affectedFiles.slice(0, 5).map((file) => <div key={file} className="truncate font-mono text-[8px]" style={{ color: "var(--text-muted)" }}>{file}</div>)}</div>}{approval.diff && <details className="mt-1.5"><summary className="cursor-pointer text-[8px] font-bold" style={{ color: "var(--text-secondary)" }}>View diff</summary><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border p-2 text-[7px] leading-3" style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}>{approval.diff}</pre></details>}<div className="mt-2 flex gap-2"><button type="button" onClick={() => void resolveApproval(approval.id, "approved")} disabled={resolving !== null} className="flex-1 rounded-lg px-2 py-1.5 text-[9px] font-bold transition-colors hover:opacity-80 disabled:opacity-40" style={{ backgroundColor: "rgba(182,255,74,0.1)", color: "var(--litt-primary)" }}>Approve</button><button type="button" onClick={() => void resolveApproval(approval.id, "denied")} disabled={resolving !== null} className="flex-1 rounded-lg px-2 py-1.5 text-[9px] font-bold transition-colors hover:opacity-80 disabled:opacity-40" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "#fca5a5" }}>Deny</button></div></div>)}</div>}
      </div>
    );
  }

  // Runtime status banner — shows recovery actions instead of "workspace is not ready"
  const showRuntimeBanner = runtime.phase !== "ready" && runtime.phase !== "idle" && runtime.phase !== "resolving";
  const recoveryActions = runtimeRecoveryActions(runtime.phase);

  return (
    <div className="space-y-3" data-testid="studio-health-panel">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-secondary)" }}>Project health</div>
          <div className="mt-1 text-[9px]" style={{ color: "var(--text-muted)" }}>
            {runtime.repository ? `${runtime.repository}` : "No repository"} · {runtime.branch ?? "no branch"}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void runAllChecks()}
            disabled={runningAll || runtime.phase !== "ready"}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[9px] font-bold transition-colors hover:opacity-80 disabled:opacity-30"
            style={{ backgroundColor: "rgba(168,85,247,0.12)", color: "#a78bfa", border: "1px solid rgba(168,85,247,0.2)" }}
            aria-label="Run all checks"
            title="Run TypeScript, lint, tests, build, and security audit"
          >
            {runningAll ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
            Run all
          </button>
          <button type="button" onClick={() => void load()} disabled={loading} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-white/8 disabled:opacity-40" aria-label="Refresh project checks"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </div>

      {/* Runtime status banner with recovery actions */}
      {showRuntimeBanner && (
        <div className="rounded-xl border px-2.5 py-2.5" style={{ borderColor: "rgba(239,68,68,0.25)", backgroundColor: "rgba(239,68,68,0.04)" }}>
          <div className="flex items-start gap-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0" style={{ color: "#fca5a5" }} />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold" style={{ color: "#fca5a5" }}>{runtimePhaseLabel(runtime.phase)}</div>
              <div className="mt-0.5 text-[9px] leading-4" style={{ color: "var(--text-muted)" }}>
                {runtime.error?.message ?? "The workspace is not fully connected."}
              </div>
              {recoveryActions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {recoveryActions.map((action) => (
                    <a
                      key={action.action}
                      href={action.href ?? "#"}
                      onClick={(e) => {
                        if (!action.href) e.preventDefault();
                      }}
                      className="rounded-lg px-2 py-1 text-[9px] font-bold transition-colors hover:opacity-80"
                      style={{ backgroundColor: "rgba(168,85,247,0.12)", color: "#a78bfa", border: "1px solid rgba(168,85,247,0.2)" }}
                    >
                      {action.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Summary after run-all */}
      {payload.summary && (
        <div className="flex items-center gap-3 rounded-xl border px-2.5 py-2 text-[9px]" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
          <span style={{ color: "var(--litt-primary)" }}>{payload.summary.passed} passed</span>
          {payload.summary.failed > 0 && <span style={{ color: "#ef4444" }}>{payload.summary.failed} failed</span>}
          {payload.summary.notConfigured > 0 && <span style={{ color: "var(--text-muted)" }}>{payload.summary.notConfigured} not configured</span>}
          <span style={{ color: "var(--text-muted)" }}>· {payload.summary.changedFileCount} changed files</span>
        </div>
      )}

      {error && <div className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[9px]" style={{ borderColor: "rgba(239,68,68,0.3)", color: "#fca5a5" }}><AlertCircle size={12} className="shrink-0" />{error}</div>}
      <div className="space-y-1.5">
        {checks.map((check) => (
          <div key={check.id} className="rounded-xl border px-2.5 py-2" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: statusColor(check.status), boxShadow: check.status === "passed" ? `0 0 6px ${statusColor(check.status)}` : undefined }} aria-hidden />
              <span className="min-w-0 flex-1 text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{check.label}</span>
              <span className="shrink-0 text-[9px] font-bold" style={{ color: statusColor(check.status) }}>{statusLabel(check.status)}</span>
              {RUNNABLE_CHECKS.has(check.id) && (
                <button type="button" onClick={() => void runCheck(check.id)} disabled={running !== null || runningAll} className="grid h-9 w-9 shrink-0 place-items-center rounded-md hover:bg-white/8 disabled:opacity-35" aria-label={`Run ${check.label}`} title={`Run ${check.label}`}>
                  {running === check.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                </button>
              )}
            </div>
            <div className="mt-1 text-[9px] leading-4" style={{ color: "var(--text-muted)" }}>{check.source} · {formatTime(check.timestamp)}</div>
            {check.error && <div className="mt-1 text-[9px] leading-4" style={{ color: check.status === "unavailable" ? "#e3b341" : "#fca5a5" }}>{check.error}</div>}
            {check.suggestedFix && <div className="mt-1 text-[9px] leading-4" style={{ color: "#a78bfa" }}>Fix: {check.suggestedFix}</div>}
            {check.output && (
              <details className="mt-1.5">
                <summary className="flex cursor-pointer items-center gap-1 text-[9px] font-bold" style={{ color: "var(--text-secondary)" }}>
                  <ChevronDown size={11} /> Output{check.durationMs ? ` · ${check.durationMs}ms` : ""}{check.exitCode != null ? ` · exit ${check.exitCode}` : ""}
                </summary>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border p-2 text-[8px] leading-4" style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}>{check.output}</pre>
              </details>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}><CircleCheck size={11} /> Changed files</div>
          {payload.changedFiles.length ? <div className="space-y-1">{payload.changedFiles.map((file) => <div key={file} className="truncate rounded-md border px-2 py-1.5 font-mono text-[9px]" style={{ borderColor: "var(--studio-border)", color: "var(--text-secondary)" }}>{file}</div>)}</div> : <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>No changed files reported by Git.</div>}
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}><Clock3 size={11} /> Checkpoints</div>
          {payload.checkpoints.length ? <div className="space-y-1">{payload.checkpoints.slice(0, 4).map((checkpoint, index) => <div key={checkpoint.id ?? `${checkpoint.gitSha}-${index}`} className="flex items-center gap-2 rounded-md border px-2 py-1.5" style={{ borderColor: "var(--studio-border)" }}><span className="min-w-0 flex-1 truncate text-[9px]" style={{ color: "var(--text-secondary)" }}>{checkpoint.label ?? checkpoint.gitSha ?? "Checkpoint"}</span><span className="shrink-0 text-[8px]" style={{ color: "var(--text-muted)" }}>{formatTime(checkpoint.createdAt)}</span></div>)}</div> : <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>No checkpoints reported.</div>}
        </div>
      </div>
    </div>
  );
}
