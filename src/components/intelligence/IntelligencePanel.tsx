"use client";

/**
 * Intelligence Panel — Research and Tool UI
 *
 * Renders research findings, candidate evaluations, tool actions,
 * and approval requests in the LiTT chat interface.
 *
 * This component is designed to be embedded in the chat message stream
 * or shown as a side panel. It does NOT expose internal chain-of-thought.
 */

import { useState, useCallback } from "react";
import type {
  IntegrationRecommendation,
  LiTTActionPlan,
  ActionPhase,
} from "@/lib/litt-intelligence/types";
import type { ResearchResult } from "@/lib/litt-intelligence/research-engine";
import type { ApprovalRequest } from "@/lib/litt-intelligence/approval-system";

// ─── Research Panel ─────────────────────────────────────────────

export function ResearchPanel({ result }: { result: ResearchResult }) {
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  const toggleSource = useCallback((url: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }, []);

  const verified = result.results.filter((r) => r.verification?.verified);
  const unverified = result.results.filter((r) => r.source && !r.verification?.verified);
  const failed = result.results.filter((r) => !r.source);

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-white/80">
        <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
        Research Results
      </div>

      {result.summary && (
        <p className="text-xs text-white/60">{result.summary}</p>
      )}

      {verified.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-green-400">
            Verified Sources ({verified.length})
          </p>
          {verified.map((item, i) => (
            <div key={i} className="text-xs space-y-1">
              <button
                type="button"
                onClick={() => toggleSource(item.search.url)}
                className="text-white/70 hover:text-white underline-offset-2 hover:underline"
              >
                {item.search.title}
              </button>
              <span className="text-white/30 ml-2">({item.search.sourceType})</span>
              {expandedSources.has(item.search.url) && item.source && (
                <div className="mt-1 p-2 rounded bg-black/30 text-white/50 max-h-32 overflow-y-auto">
                  <p className="text-xs">{item.source.content.slice(0, 500)}...</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {unverified.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-yellow-400">
            Unverified Sources ({unverified.length})
          </p>
          {unverified.map((item, i) => (
            <div key={i} className="text-xs">
              <span className="text-white/60">{item.search.title}</span>
              <span className="text-white/30 ml-2">({item.search.sourceType})</span>
              {item.verification?.warnings && item.verification.warnings.length > 0 && (
                <p className="text-yellow-400/60 ml-4">
                  ⚠ {item.verification.warnings.join("; ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {failed.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-red-400/60">
            Failed to Fetch ({failed.length})
          </p>
          {failed.map((item, i) => (
            <div key={i} className="text-xs text-white/40">
              {item.search.title} — {item.search.url}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Recommendation Panel ───────────────────────────────────────

export function RecommendationPanel({
  recommendation,
  onApprove,
  onReject,
}: {
  recommendation: IntegrationRecommendation;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const [showRejected, setShowRejected] = useState(false);

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-white/80">
        <span className="inline-block w-2 h-2 rounded-full bg-purple-400" />
        Recommendation
      </div>

      <p className="text-xs text-white/60">
        <span className="text-white/40">Problem:</span> {recommendation.problem}
      </p>

      {recommendation.projectConstraints.length > 0 && (
        <div className="text-xs text-white/50">
          <span className="text-white/40">Constraints:</span>{" "}
          {recommendation.projectConstraints.join(", ")}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-green-400">Recommended:</p>
        <div className="p-2 rounded bg-green-400/5 border border-green-400/20">
          <p className="text-sm text-white/80">
            {recommendation.candidates.find(
              (c) => c.candidateId === recommendation.recommendation.candidateId,
            )?.name ?? "Unknown"}
          </p>
          <p className="text-xs text-white/50 mt-1">
            {recommendation.recommendation.reason}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-white/40">Confidence:</span>
            <div className="flex-1 h-1 rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-green-400"
                style={{ width: `${recommendation.recommendation.confidence * 100}%` }}
              />
            </div>
            <span className="text-xs text-white/60">
              {(recommendation.recommendation.confidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      {recommendation.risks.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-yellow-400">Risks:</p>
          {recommendation.risks.map((risk, i) => (
            <p key={i} className="text-xs text-yellow-400/70 ml-4">⚠ {risk}</p>
          ))}
        </div>
      )}

      {recommendation.proposedIntegration.steps.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-white/60">Proposed Steps:</p>
          <ol className="text-xs text-white/50 ml-4 list-decimal space-y-0.5">
            {recommendation.proposedIntegration.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {recommendation.rejectedCandidates.length > 0 && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setShowRejected(!showRejected)}
            className="text-xs text-white/40 hover:text-white/60"
          >
            {showRejected ? "Hide" : "Show"} rejected candidates ({recommendation.rejectedCandidates.length})
          </button>
          {showRejected && (
            <div className="space-y-1 ml-4">
              {recommendation.rejectedCandidates.map((c, i) => (
                <p key={i} className="text-xs text-white/40">
                  {recommendation.candidates.find((cc) => cc.candidateId === c.candidateId)?.name}: {c.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {recommendation.approvalRequired && onApprove && onReject && (
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onApprove}
            className="px-3 py-1.5 text-xs font-medium rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 transition-colors"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={onReject}
            className="px-3 py-1.5 text-xs font-medium rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Action Plan Panel ──────────────────────────────────────────

const PHASE_COLORS: Record<ActionPhase, string> = {
  understand: "bg-blue-400",
  scan: "bg-blue-400",
  research: "bg-blue-400",
  plan: "bg-purple-400",
  awaiting_approval: "bg-yellow-400",
  executing: "bg-orange-400",
  observing: "bg-orange-400",
  verifying: "bg-orange-400",
  repairing: "bg-red-400",
  completed: "bg-green-400",
  failed: "bg-red-500",
  cancelled: "bg-gray-400",
};

export function ActionPlanPanel({ plan }: { plan: LiTTActionPlan }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-white/80">
        <span className={`inline-block w-2 h-2 rounded-full ${PHASE_COLORS[plan.phase]}`} />
        Action Plan
      </div>

      <p className="text-xs text-white/60">
        <span className="text-white/40">Goal:</span> {plan.goal}
      </p>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-white/40">Phase:</span>
        <span className="text-white/70 capitalize">{plan.phase.replace(/_/g, " ")}</span>
        <span className="text-white/20">|</span>
        <span className="text-white/40">Risk:</span>
        <span className={`capitalize ${plan.risk === "critical" || plan.risk === "high" ? "text-red-400" : plan.risk === "medium" ? "text-yellow-400" : "text-green-400"}`}>
          {plan.risk}
        </span>
      </div>

      {plan.assumptions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-white/40">Assumptions:</p>
          {plan.assumptions.map((a) => (
            <div key={a.id} className="text-xs text-white/50 ml-4">
              • {a.text}
              {a.verificationRequired && (
                <span className="text-yellow-400/60 ml-1">(needs verification)</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium text-white/40">Steps:</p>
        <div className="space-y-1">
          {plan.steps.map((step, i) => (
            <div key={step.id} className="flex items-start gap-2 text-xs ml-4">
              <span className="text-white/30 mt-0.5">{i + 1}.</span>
              <div className="flex-1">
                <span className="text-white/60">{step.toolId}</span>
                <span className="text-white/20 mx-1">|</span>
                <span className={`capitalize ${
                  step.actualStatus === "success" ? "text-green-400"
                  : step.actualStatus === "failed" ? "text-red-400"
                  : "text-white/40"
                }`}>
                  {step.actualStatus ?? "pending"}
                </span>
                {step.risk === "high" || step.risk === "critical" ? (
                  <span className="text-red-400/60 ml-2">⚠ {step.risk} risk</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Approval Request Panel ─────────────────────────────────────

export function ApprovalRequestPanel({
  request,
  onApprove,
  onDeny,
}: {
  request: ApprovalRequest;
  onApprove?: () => void;
  onDeny?: () => void;
}) {
  const isPending = request.status === "pending";
  const isExpired = request.status === "expired";

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${
      isPending ? "border-yellow-400/30 bg-yellow-400/5"
      : request.status === "approved" ? "border-green-400/30 bg-green-400/5"
      : request.status === "denied" ? "border-red-400/30 bg-red-400/5"
      : "border-white/10 bg-black/20"
    }`}>
      <div className="flex items-center gap-2 text-sm font-medium text-white/80">
        <span className={`inline-block w-2 h-2 rounded-full ${
          isPending ? "bg-yellow-400"
          : request.status === "approved" ? "bg-green-400"
          : request.status === "denied" ? "bg-red-400"
          : "bg-gray-400"
        }`} />
        Approval Required
      </div>

      <p className="text-xs text-white/60">
        <span className="text-white/40">Goal:</span> {request.goal}
      </p>

      <p className="text-xs text-yellow-400/80">{request.reason}</p>

      <div className="space-y-1">
        <p className="text-xs font-medium text-white/40">Steps requiring approval:</p>
        {request.steps.map((step) => (
          <div key={step.stepId} className="text-xs text-white/50 ml-4">
            • {step.toolId} —{" "}
            <span className={`capitalize ${
              step.risk === "critical" ? "text-red-400"
              : step.risk === "high" ? "text-orange-400"
              : "text-white/50"
            }`}>
              {step.risk} risk
            </span>
            <span className="text-white/30 ml-2">{step.inputsSummary}</span>
          </div>
        ))}
      </div>

      {isPending && !isExpired && onApprove && onDeny && (
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onApprove}
            className="px-3 py-1.5 text-xs font-medium rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 transition-colors"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={onDeny}
            className="px-3 py-1.5 text-xs font-medium rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
          >
            Deny
          </button>
        </div>
      )}

      {!isPending && (
        <p className="text-xs text-white/40">
          Status: <span className="capitalize">{request.status}</span>
          {request.decidedBy && ` by ${request.decidedBy}`}
        </p>
      )}

      {isExpired && (
        <p className="text-xs text-red-400/60">This approval request has expired.</p>
      )}
    </div>
  );
}
