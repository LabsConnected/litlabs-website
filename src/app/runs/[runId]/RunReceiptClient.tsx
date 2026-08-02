"use client";

import Link from "next/link";
import {
  CheckCircle,
  XCircle,
  Loader2,
  Rocket,
  Eye,
  GitBranch,
  AlertTriangle,
  FileCode,
  Shield,
  Clock,
  ArrowRight,
  RotateCcw,
} from "lucide-react";

interface RunReceiptClientProps {
  run: {
    id: string;
    prompt: string;
    status: string;
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
    created_at: string;
  };
  agent: { name: string; slug: string } | null;
  approvals: {
    id: string;
    approval_type: string;
    status: string;
    created_at: string;
    resolved_at: string | null;
  }[];
  events: {
    event_type: string;
    event_data: Record<string, unknown>;
    created_at: string;
  }[];
  deployments: {
    id: string;
    provider: string;
    provider_deployment_id: string | null;
    status: string;
    preview_url: string | null;
    production_url: string | null;
    created_at: string;
    completed_at: string | null;
    error_message: string | null;
  }[];
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

export function RunReceiptClient({ run, agent, approvals, events, deployments }: RunReceiptClientProps) {
  const isCompleted = run.status === "completed";
  const isFailed = run.status === "failed";
  const isActive = ["queued", "planning", "executing", "previewing", "deploying"].includes(run.status);

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* Header */}
        <div className="mb-8 border-b border-neutral-800 pb-6">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <Link href="/dashboard" className="text-neutral-500 hover:text-neutral-300">Dashboard</Link>
            <span className="text-neutral-700">/</span>
            <span className="text-neutral-300">Run {run.id.slice(0, 8)}</span>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-black text-white">Run Receipt</h1>
              {agent && <p className="mt-1 text-sm text-neutral-500">{agent.name}</p>}
            </div>
            <div className={`flex items-center gap-2 text-sm font-bold ${
              isCompleted ? "text-green-400" : isFailed ? "text-red-400" : "text-cyan-400"
            }`}>
              {isActive && <Loader2 className="h-4 w-4 animate-spin" />}
              {isCompleted && <CheckCircle className="h-4 w-4" />}
              {isFailed && <XCircle className="h-4 w-4" />}
              {STATUS_LABELS[run.status] ?? run.status}
            </div>
          </div>
        </div>

        {/* Original request */}
        <Section title="Original Request" icon={<FileCode className="h-4 w-4" />}>
          <p className="text-sm text-neutral-300">{run.prompt}</p>
        </Section>

        {/* Timeline */}
        <Section title="Timeline" icon={<Clock className="h-4 w-4" />}>
          <div className="space-y-2">
            <TimelineItem label="Created" date={run.created_at} />
            <TimelineItem label="Queued" date={run.queued_at} />
            {run.completed_at && <TimelineItem label="Completed" date={run.completed_at} />}
          </div>
        </Section>

        {/* Plan */}
        {run.plan && (
          <Section title="Plan" icon={<GitBranch className="h-4 w-4" />}>
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
          </Section>
        )}

        {/* Approvals */}
        {approvals.length > 0 && (
          <Section title="Approvals" icon={<Shield className="h-4 w-4" />}>
            <div className="space-y-2">
              {approvals.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm">
                  <div>
                    <span className="font-bold capitalize text-neutral-300">{a.approval_type}</span>
                    <span className="ml-2 text-xs text-neutral-500">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </div>
                  <span className={`text-xs font-bold ${
                    a.status === "approved" ? "text-green-400" :
                    a.status === "rejected" ? "text-red-400" :
                    "text-amber-400"
                  }`}>
                    {a.status}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Files changed */}
        {run.files_changed.length > 0 && (
          <Section title="Files Changed" icon={<FileCode className="h-4 w-4" />}>
            <div className="space-y-1">
              {run.files_changed.map((file) => (
                <div key={file} className="flex items-center gap-2 text-xs text-neutral-400">
                  <FileCode className="h-3 w-3 text-neutral-600" />
                  {file}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Validation */}
        {run.validation_result && (
          <Section title="Build & Test" icon={<CheckCircle className="h-4 w-4" />}>
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-2">
                {run.validation_result.buildOk ? <CheckCircle className="h-4 w-4 text-green-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                <span className={run.validation_result.buildOk ? "text-green-400" : "text-red-400"}>Build</span>
              </div>
              <div className="flex items-center gap-2">
                {run.validation_result.testOk ? <CheckCircle className="h-4 w-4 text-green-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                <span className={run.validation_result.testOk ? "text-green-400" : "text-red-400"}>Tests</span>
              </div>
            </div>
          </Section>
        )}

        {/* Preview */}
        {run.preview_url && (
          <Section title="Preview" icon={<Eye className="h-4 w-4" />}>
            <a href={run.preview_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-400 hover:underline">
              <Eye className="h-4 w-4" />
              {run.preview_url}
            </a>
          </Section>
        )}

        {/* Deployments */}
        {deployments.length > 0 && (
          <Section title="Deployments" icon={<Rocket className="h-4 w-4" />}>
            <div className="space-y-2">
              {deployments.map((d) => (
                <div key={d.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-neutral-300">{d.provider}</span>
                    <span className={`text-xs font-bold ${
                      d.status === "ready" || d.status === "live" ? "text-green-400" :
                      d.status === "failed" || d.status === "canceled" ? "text-red-400" :
                      "text-neutral-400"
                    }`}>
                      {d.status}
                    </span>
                  </div>
                  {d.production_url && (
                    <a href={d.production_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-green-400 hover:underline">
                      <ArrowRight className="h-3 w-3" />
                      {d.production_url}
                    </a>
                  )}
                  {d.error_message && (
                    <p className="mt-2 text-xs text-red-400">{d.error_message}</p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Error */}
        {isFailed && run.error_message && (
          <Section title="Error" icon={<AlertTriangle className="h-4 w-4" />}>
            <div className="rounded-lg border border-red-900 bg-red-950/50 p-3">
              <div className="mb-1 text-xs font-bold text-red-400">{run.error_code ?? "Error"}</div>
              <p className="text-sm text-red-300">{run.error_message}</p>
            </div>
          </Section>
        )}

        {/* Event log */}
        {events.length > 0 && (
          <Section title="Event Log" icon={<Clock className="h-4 w-4" />}>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              {events.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-neutral-500">
                  <span className="text-neutral-600">{new Date(e.created_at).toLocaleTimeString()}</span>
                  <span className="font-mono text-neutral-400">{e.event_type}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Actions */}
        <div className="mt-12 flex gap-3 border-t border-neutral-800 pt-6">
          {run.deployment_url && isCompleted && (
            <a
              href={run.deployment_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-xs font-bold text-white hover:bg-green-500"
            >
              <ArrowRight className="h-3 w-3" />
              Visit Live Site
            </a>
          )}
          {isFailed && run.checkpoint_id && (
            <button className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-4 py-2 text-xs font-bold text-neutral-300 hover:bg-neutral-800">
              <RotateCcw className="h-3 w-3" />
              Roll Back
            </button>
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

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-neutral-500">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}

function TimelineItem({ label, date }: { label: string; date: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-neutral-400">{label}</span>
      <span className="text-neutral-600">{new Date(date).toLocaleString()}</span>
    </div>
  );
}
