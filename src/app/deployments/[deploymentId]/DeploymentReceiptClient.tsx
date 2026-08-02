"use client";

import Link from "next/link";
import {
  CheckCircle,
  XCircle,
  Loader2,
  GitBranch,
  AlertTriangle,
  ArrowRight,
  Clock,
} from "lucide-react";

interface DeploymentReceiptClientProps {
  deployment: {
    id: string;
    user_id: string;
    project_id: string;
    agent_run_id: string | null;
    provider: string;
    provider_deployment_id: string | null;
    environment: string;
    status: string;
    preview_url: string | null;
    production_url: string | null;
    source_revision: string | null;
    checkpoint_id: string | null;
    error_code: string | null;
    error_message: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  };
}

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "Preparing", color: "text-neutral-400", icon: <Clock className="h-4 w-4" /> },
  queued: { label: "Queued", color: "text-neutral-400", icon: <Clock className="h-4 w-4" /> },
  building: { label: "Building", color: "text-blue-400", icon: <Loader2 className="h-4 w-4 animate-spin" /> },
  deploying: { label: "Deploying", color: "text-blue-400", icon: <Loader2 className="h-4 w-4 animate-spin" /> },
  ready: { label: "Ready", color: "text-green-400", icon: <CheckCircle className="h-4 w-4" /> },
  live: { label: "Live", color: "text-green-400", icon: <CheckCircle className="h-4 w-4" /> },
  failed: { label: "Failed", color: "text-red-400", icon: <XCircle className="h-4 w-4" /> },
  canceled: { label: "Canceled", color: "text-neutral-400", icon: <XCircle className="h-4 w-4" /> },
};

export function DeploymentReceiptClient({ deployment }: DeploymentReceiptClientProps) {
  const statusMeta = STATUS_LABELS[deployment.status] ?? STATUS_LABELS.pending;
  const isReady = deployment.status === "ready" || deployment.status === "live";
  const isFailed = deployment.status === "failed" || deployment.status === "canceled";
  const isActive = ["pending", "queued", "building", "deploying"].includes(deployment.status);

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-2xl px-6 py-12">
        {/* Header */}
        <div className="mb-8 border-b border-neutral-800 pb-6">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <Link href="/dashboard" className="text-neutral-500 hover:text-neutral-300">Dashboard</Link>
            <span className="text-neutral-700">/</span>
            <span className="text-neutral-300">Deployment {deployment.id.slice(0, 8)}</span>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-black text-white">Deployment</h1>
              <p className="mt-1 text-sm text-neutral-500 capitalize">
                {deployment.provider} · {deployment.environment}
              </p>
            </div>
            <div className={`flex items-center gap-2 text-sm font-bold ${statusMeta.color}`}>
              {statusMeta.icon}
              {statusMeta.label}
            </div>
          </div>
        </div>

        {/* Truthful status notice */}
        {isActive && (
          <div className="mb-6 rounded-lg border border-blue-900/50 bg-blue-950/20 p-3 text-sm text-blue-300">
            This deployment is in progress. The status will update when the provider reports back.
            No fake completion — we wait for real provider status.
          </div>
        )}

        {/* Provider details */}
        <div className="mb-6 space-y-3">
          <Row label="Provider" value={deployment.provider} />
          <Row label="Environment" value={deployment.environment} />
          <Row label="Provider Deployment ID" value={deployment.provider_deployment_id ?? "Not yet assigned"} />
          {deployment.source_revision && (
            <Row label="Source Revision" value={deployment.source_revision.slice(0, 12)} />
          )}
          {deployment.checkpoint_id && (
            <Row label="Checkpoint" value={deployment.checkpoint_id.slice(0, 12)} />
          )}
        </div>

        {/* URLs */}
        {(deployment.production_url || deployment.preview_url) && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-black uppercase tracking-wider text-neutral-500">URLs</h2>
            {deployment.production_url && (
              <a
                href={deployment.production_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-2 flex items-center gap-2 rounded-lg border border-green-900/50 bg-green-950/20 p-3 text-sm text-green-300 hover:bg-green-950/40"
              >
                <ArrowRight className="h-4 w-4" />
                {deployment.production_url}
              </a>
            )}
            {deployment.preview_url && (
              <a
                href={deployment.preview_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-blue-400 hover:bg-neutral-800"
              >
                <ArrowRight className="h-4 w-4" />
                {deployment.preview_url}
              </a>
            )}
          </div>
        )}

        {/* Error */}
        {isFailed && deployment.error_message && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-black uppercase tracking-wider text-neutral-500">Error</h2>
            <div className="rounded-lg border border-red-900 bg-red-950/50 p-3">
              {deployment.error_code && (
                <div className="mb-1 flex items-center gap-2 text-xs font-bold text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  {deployment.error_code}
                </div>
              )}
              <p className="text-sm text-red-300">{deployment.error_message}</p>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-black uppercase tracking-wider text-neutral-500">Timeline</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400">Created</span>
              <span className="text-neutral-600">{new Date(deployment.created_at).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400">Updated</span>
              <span className="text-neutral-600">{new Date(deployment.updated_at).toLocaleString()}</span>
            </div>
            {deployment.completed_at && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400">Completed</span>
                <span className="text-neutral-600">{new Date(deployment.completed_at).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t border-neutral-800 pt-6">
          {isReady && deployment.production_url && (
            <a
              href={deployment.production_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-xs font-bold text-white hover:bg-green-500"
            >
              <ArrowRight className="h-3 w-3" />
              Visit Live Site
            </a>
          )}
          {deployment.agent_run_id && (
            <Link
              href={`/runs/${deployment.agent_run_id}`}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-4 py-2 text-xs font-bold text-neutral-300 hover:bg-neutral-800"
            >
              <GitBranch className="h-3 w-3" />
              View Run
            </Link>
          )}
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-4 py-2 text-xs font-bold text-neutral-300 hover:bg-neutral-800"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="font-mono text-neutral-300">{value}</span>
    </div>
  );
}
