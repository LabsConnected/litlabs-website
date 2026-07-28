/**
 * LeftRail — LiTT conversation + Plan/timeline tabs.
 *
 * Phase 2: conversation tab shows live messages from useLiTTRun.
 * Plan tab displays Kernel mode and run events in the timeline.
 */

"use client";

import { useState } from "react";
import { useCanvasesData } from "./hooks";
import { EmptyState, ErrorState, LoadingState } from "./StateViews";
import type { CanvasSummary } from "./types";
import type { RunState } from "./useLiTTRun";

interface ThemeColors {
  borderColor: string;
}

type LeftTab = "conversation" | "plan";

export function LeftRail({
  projectId,
  runState,
  T,
}: {
  projectId: string;
  runState: RunState;
  T: ThemeColors;
}) {
  const [tab, setTab] = useState<LeftTab>("conversation");
  const { canvases, status: canvasesStatus } = useCanvasesData(projectId);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
        style={{ borderColor: `${T.borderColor}30` }}
      >
        {(["conversation", "plan"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
              tab === t
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {t === "conversation" ? "LiTT" : "Plan / Timeline"}
          </button>
        ))}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {tab === "conversation" ? (
          <ConversationTab runState={runState} />
        ) : (
          <PlanTab
            canvases={canvases}
            canvasesStatus={canvasesStatus}
            runState={runState}
          />
        )}
      </div>
    </div>
  );
}

function ConversationTab({ runState }: { runState: RunState }) {
  const { userMessage, assistantMessage, status, error } = runState;

  if (!userMessage && status === "idle") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5">
          <span className="text-sm">LiTT</span>
        </div>
        <p className="text-xs font-bold text-white/60">
          Conversation ready
        </p>
        <p className="max-w-xs text-[11px] leading-relaxed text-white/40">
          Type a message below to start a conversation with LiTT. Your message
          will be sent to <code className="text-white/50">/api/litt/run</code>{" "}
          and the response will stream back in real time.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      {/* User message */}
      {userMessage && (
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">
              You
            </span>
          </div>
          <p className="whitespace-pre-wrap text-[12px] text-white/80">
            {userMessage.content}
          </p>
        </div>
      )}

      {/* Assistant message (streaming or complete) */}
      {assistantMessage && (
        <div className="rounded-lg border border-white/10 bg-blue-500/5 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-blue-300/60">
              LiTT
            </span>
            {assistantMessage.status === "streaming" && (
              <span className="h-1 w-1 animate-pulse rounded-full bg-blue-400" />
            )}
            {assistantMessage.status === "failed" && (
              <span className="text-[9px] font-bold text-red-400/70">Failed</span>
            )}
            {assistantMessage.status === "cancelled" && (
              <span className="text-[9px] font-bold text-amber-400/70">Cancelled</span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-[12px] text-white/80">
            {assistantMessage.content || (status === "streaming" ? "…" : "")}
          </p>
          {assistantMessage.status === "failed" && error && (
            <p className="mt-1.5 text-[10px] text-red-400/60">
              {error.message}
            </p>
          )}
        </div>
      )}

      {/* Error without assistant message (e.g., run creation failed) */}
      {!assistantMessage && error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
          <p className="text-[10px] font-bold text-red-400/70">Error</p>
          <p className="mt-0.5 text-[11px] text-red-300/60">{error.message}</p>
        </div>
      )}
    </div>
  );
}

function PlanTab({
  canvases,
  canvasesStatus,
  runState,
}: {
  canvases: CanvasSummary[];
  canvasesStatus: "idle" | "loading" | "ready" | "error";
  runState: RunState;
}) {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      {/* Kernel decision summary */}
      {runState.kernelDecision && (
        <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">
            Kernel Decision
          </p>
          <div className="mt-1 space-y-0.5 text-[10px] text-white/60">
            <p>Mode: <span className="text-white/80">{runState.kernelDecision.mode}</span></p>
            <p>Risk: <span className="text-white/80">{runState.kernelDecision.risk}</span></p>
            <p>Approval: <span className="text-white/80">{runState.kernelDecision.approvalRequired ? "Required" : "Not required"}</span></p>
            {runState.kernelDecision.requiresProject && (
              <p className="text-amber-400/60">Requires project</p>
            )}
          </div>
        </div>
      )}

      {/* Run status */}
      {runState.runId && (
        <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">
            Run Status
          </p>
          <p className="mt-0.5 text-[10px] text-white/60">
            <span className={
              runState.status === "completed" ? "text-green-400/70" :
              runState.status === "failed" ? "text-red-400/70" :
              runState.status === "streaming" ? "text-blue-400/70" :
              runState.status === "cancelled" ? "text-amber-400/70" :
              "text-white/60"
            }>
              {runState.status}
            </span>
          </p>
        </div>
      )}

      <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">
        Canvas artifacts
      </p>
      {canvasesStatus === "loading" ? (
        <LoadingState label="Loading canvases…" />
      ) : canvasesStatus === "error" ? (
        <ErrorState message="Failed to load canvases" />
      ) : canvases.length === 0 ? (
        <EmptyState
          title="No canvases"
          body="Canvas artifacts created by LiTT runs will appear here."
        />
      ) : (
        <ul className="space-y-1">
          {canvases.map((c) => (
            <li
              key={c.id}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5"
            >
              <p className="text-[11px] font-bold text-white/70">{c.title}</p>
              <p className="text-[9px] text-white/40">
                {c.type} · {c.status} · {new Date(c.updatedAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto pt-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">
          Plan
        </p>
        <EmptyState
          title="No active plan"
          body="Build plans created by LiTT will appear here once plan mode is implemented."
        />
      </div>
    </div>
  );
}
