"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  FileCode,
  CheckCircle,
  XCircle,
  Loader2,
  Rocket,
  Eye,
  GitBranch,
  AlertTriangle,
  RotateCcw,
  ArrowRight,
} from "lucide-react";

interface RunData {
  id: string;
  status: string;
  prompt: string;
  plan: { summary?: string; steps?: { description: string; tool: string }[] } | null;
  files_changed: string[];
  validation_result: { buildOk?: boolean; testOk?: boolean; errors?: string[] } | null;
  preview_url: string | null;
  preview_status: string | null;
  deployment_url: string | null;
  deployment_status: string | null;
  deployment_provider: string | null;
  deployment_error: string | null;
  error_code: string | null;
  error_message: string | null;
  checkpoint_id: string | null;
  queued_at: string;
  completed_at: string | null;
}

interface ApprovalData {
  id: string;
  approval_type: "plan" | "deploy";
  status: "pending" | "approved" | "rejected" | "expired";
  summary: unknown;
}

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  planning: "Planning",
  awaiting_approval: "Awaiting Plan Approval",
  executing: "Executing",
  previewing: "Starting Preview",
  awaiting_deploy_approval: "Awaiting Deploy Approval",
  deploying: "Deploying",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  queued: "text-neutral-400",
  planning: "text-blue-400",
  awaiting_approval: "text-amber-400",
  executing: "text-blue-400",
  previewing: "text-blue-400",
  awaiting_deploy_approval: "text-amber-400",
  deploying: "text-blue-400",
  completed: "text-green-400",
  failed: "text-red-400",
  cancelled: "text-neutral-400",
};

export default function LaunchAgentRunPage() {
  const params = useParams();
  const runId = params.runId as string;
  const { getToken } = useClerkAuth();
  const [run, setRun] = useState<RunData | null>(null);
  const [approvals, setApprovals] = useState<ApprovalData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const authHeaders = useCallback(
    async (json = false): Promise<HeadersInit> => {
      const token = await getToken?.();
      return {
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
    },
    [getToken],
  );

  const loadRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/revenue/runs/${runId}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) {
        if (res.status === 401) {
          setError("Your session expired. Please sign in again.");
        } else if (res.status === 404) {
          setError("Run not found.");
        } else {
          setError(`Failed to load run (${res.status}).`);
        }
        return;
      }
      const data = (await res.json()) as { run: RunData; approvals: ApprovalData[] };
      setRun(data.run);
      setApprovals(data.approvals);
    } catch {
      setError("Failed to load run.");
    } finally {
      setLoading(false);
    }
  }, [runId, authHeaders]);

  useEffect(() => {
    loadRun();
  }, [loadRun]);

  useEffect(() => {
    if (!run) return;
    const activeStates = ["queued", "planning", "executing", "previewing", "deploying"];
    if (!activeStates.includes(run.status)) return;
    const interval = setInterval(loadRun, 3000);
    return () => clearInterval(interval);
  }, [run, loadRun]);

  const resolveApproval = async (approvalId: string, decision: "approved" | "rejected") => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/revenue/runs/${runId}/approvals`, {
        method: "POST",
        headers: await authHeaders(true),
        body: JSON.stringify({ approvalId, decision }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Failed to resolve approval.");
        return;
      }
      await loadRun();
    } catch {
      setError("Failed to resolve approval.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !run) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading run...
      </div>
    );
  }

  if (error && !run) {
    return <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-red-400">{error}</div>;
  }

  if (!run) return null;

  const statusLabel = STATUS_LABELS[run.status] ?? run.status;
  const statusColor = STATUS_COLORS[run.status] ?? "text-neutral-400";
  const isActive = ["queued", "planning", "executing", "previewing", "deploying"].includes(run.status);
  const isFailed = run.status === "failed";
  const isCompleted = run.status === "completed";
  const canRollback = isFailed && !!run.checkpoint_id;
  const pendingPlanApproval = approvals.find((a) => a.approval_type === "plan" && a.status === "pending");
  const pendingDeployApproval = approvals.find((a) => a.approval_type === "deploy" && a.status === "pending");

  return (
    <div className="min-h-screen bg-neutral-950 p-6">
      <div className="mx-auto max-w-2xl space-y-6 rounded-xl border border-neutral-800 bg-neutral-950 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Launch Agent Workspace</h2>
            <p className="text-xs text-neutral-500">Run {run.id.slice(0, 8)}</p>
          </div>
          <div className={`flex items-center gap-2 text-sm font-medium ${statusColor}`}>
            {isActive && <Loader2 className="h-4 w-4 animate-spin" />}
            {isCompleted && <CheckCircle className="h-4 w-4" />}
            {isFailed && <XCircle className="h-4 w-4" />}
            {statusLabel}
          </div>
        </div>

        <div>
          <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-neutral-500">Launch Brief</div>
          <p className="text-sm text-neutral-300">{run.prompt}</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {isFailed && run.error_message && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-bold text-red-400">
              <AlertTriangle className="h-3 w-3" />
              {run.error_code ?? "Error"}
            </div>
            <p className="text-sm text-red-300">{run.error_message}</p>
          </div>
        )}

        {run.plan && (
          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-neutral-500">Plan</div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <p className="mb-2 text-sm text-neutral-300">{run.plan.summary}</p>
              {run.plan.steps && (
                <ol className="space-y-1">
                  {run.plan.steps.map((step, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-neutral-400">
                      <span className="text-neutral-600">{i + 1}.</span>
                      {step.description}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}

        {pendingPlanApproval && (
          <div className="rounded-lg border border-amber-900 bg-amber-950/30 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              Plan Approval Required
            </div>
            <p className="mb-3 text-xs text-neutral-400">
              Review the plan above. The agent will not make any changes until you approve.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => resolveApproval(pendingPlanApproval.id, "approved")}
                disabled={actionLoading}
                className="rounded-lg bg-green-600 px-4 py-2 text-xs font-bold text-white hover:bg-green-500 disabled:opacity-50"
              >
                Approve Plan
              </button>
              <button
                onClick={() => resolveApproval(pendingPlanApproval.id, "rejected")}
                disabled={actionLoading}
                className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-bold text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {run.files_changed && run.files_changed.length > 0 && (
          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-neutral-500">Files Changed</div>
            <div className="space-y-1">
              {run.files_changed.map((file) => (
                <div key={file} className="flex items-center gap-2 text-xs text-neutral-400">
                  <FileCode className="h-3 w-3 text-neutral-600" />
                  {file}
                </div>
              ))}
            </div>
          </div>
        )}

        {run.validation_result && (
          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-neutral-500">Build & Test</div>
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-2">
                {run.validation_result.buildOk ? (
                  <CheckCircle className="h-4 w-4 text-green-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <span className={run.validation_result.buildOk ? "text-green-400" : "text-red-400"}>Build</span>
              </div>
              <div className="flex items-center gap-2">
                {run.validation_result.testOk ? (
                  <CheckCircle className="h-4 w-4 text-green-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <span className={run.validation_result.testOk ? "text-green-400" : "text-red-400"}>Tests</span>
              </div>
            </div>
            {run.validation_result.errors && run.validation_result.errors.length > 0 && (
              <div className="mt-2 rounded-lg border border-red-900 bg-red-950/30 p-2 text-xs text-red-300">
                {run.validation_result.errors.join("\n")}
              </div>
            )}
          </div>
        )}

        {run.preview_url && (
          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-neutral-500">Preview</div>
            <a
              href={run.preview_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-blue-400 hover:underline"
            >
              <Eye className="h-4 w-4" />
              {run.preview_url}
            </a>
          </div>
        )}

        {pendingDeployApproval && (
          <div className="rounded-lg border border-amber-900 bg-amber-950/30 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-400">
              <Rocket className="h-4 w-4" />
              Deploy Approval Required
            </div>
            <p className="mb-3 text-xs text-neutral-400">
              The preview is ready. Approve to deploy to production.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => resolveApproval(pendingDeployApproval.id, "approved")}
                disabled={actionLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Approve Deploy
              </button>
              <button
                onClick={() => resolveApproval(pendingDeployApproval.id, "rejected")}
                disabled={actionLoading}
                className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-bold text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {run.deployment_status && (
          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-neutral-500">Deployment</div>
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="h-4 w-4 text-neutral-600" />
              <span className="text-neutral-400">Provider:</span>
              <span className="text-neutral-300">{run.deployment_provider ?? "vercel"}</span>
              <span className="text-neutral-600">|</span>
              <span className="text-neutral-400">Status:</span>
              <span
                className={
                  run.deployment_status === "ready" || run.deployment_status === "live"
                    ? "text-green-400"
                    : "text-neutral-400"
                }
              >
                {run.deployment_status}
              </span>
            </div>
          </div>
        )}

        {run.deployment_url && (run.deployment_status === "ready" || run.deployment_status === "live") && (
          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-neutral-500">Live URL</div>
            <a
              href={run.deployment_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-green-400 hover:underline"
            >
              <ArrowRight className="h-4 w-4" />
              {run.deployment_url}
            </a>
          </div>
        )}

        {run.deployment_error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-400">
            {run.deployment_error}
          </div>
        )}

        {(isFailed || isCompleted) && (
          <div className="flex gap-2 border-t border-neutral-800 pt-4">
            {canRollback && (
              <button className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-4 py-2 text-xs font-bold text-neutral-300 hover:bg-neutral-800">
                <RotateCcw className="h-3 w-3" />
                Roll Back to Checkpoint
              </button>
            )}
            {isFailed && (
              <button
                onClick={loadRun}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-4 py-2 text-xs font-bold text-neutral-300 hover:bg-neutral-800"
              >
                <RotateCcw className="h-3 w-3" />
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
