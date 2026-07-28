/**
 * LeftRail — LiTT conversation + Plan/timeline tabs.
 *
 * Phase 1: conversation tab shows a truthful "ready" state (no AI yet).
 * Plan tab lists existing Canvas artifacts and checkpoints from real APIs.
 */

import { useState } from "react";
import { useCanvasesData } from "./hooks";
import { EmptyState, ErrorState, LoadingState } from "./StateViews";
import type { CanvasSummary } from "./types";

interface ThemeColors {
  borderColor: string;
}

type LeftTab = "conversation" | "plan";

export function LeftRail({
  projectId,
  T,
}: {
  projectId: string;
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
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5">
              <span className="text-sm">LiTT</span>
            </div>
            <p className="text-xs font-bold text-white/60">
              Conversation ready
            </p>
            <p className="max-w-xs text-[11px] leading-relaxed text-white/40">
              The canonical LiTT run API arrives in Phase 2. Until then, this
              shell shows real project, file, preview, and canvas state. Type
              below — the composer will connect to{" "}
              <code className="text-white/50">/api/litt/run</code> once it
              exists.
            </p>
          </div>
        ) : (
          <PlanTab
            canvases={canvases}
            canvasesStatus={canvasesStatus}
          />
        )}
      </div>
    </div>
  );
}

function PlanTab({
  canvases,
  canvasesStatus,
}: {
  canvases: CanvasSummary[];
  canvasesStatus: "idle" | "loading" | "ready" | "error";
}) {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
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
          body="Canvas artifacts created by LiTT runs will appear here. No runs have been executed yet."
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
          body="Build plans created by LiTT will appear here once Phase 4 (plan mode) is implemented."
        />
      </div>
    </div>
  );
}
