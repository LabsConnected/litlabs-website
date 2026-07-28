/**
 * BottomDrawer — collapsible Canvas | Terminal drawer (desktop only, ≥1024px).
 *
 * Canvas tab lists existing checkpoints from /api/studio-projects/[id]/checkpoints.
 * Terminal tab shows a truthful "Phase 3" state.
 */

import { useState } from "react";
import { useCheckpointsData } from "./hooks";
import { EmptyState, ErrorState, LoadingState } from "./StateViews";

interface ThemeColors {
  borderColor: string;
}

type DrawerTab = "canvas" | "terminal";

export function BottomDrawer({
  projectId,
  T,
}: {
  projectId: string;
  T: ThemeColors;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DrawerTab>("canvas");
  const { checkpoints, status: checkpointsStatus } =
    useCheckpointsData(projectId);

  return (
    <div
      className="flex shrink-0 flex-col border-t"
      style={{
        borderColor: `${T.borderColor}30`,
        height: open ? "30%" : "auto",
        maxHeight: "40vh",
      }}
    >
      <div
        className="flex shrink-0 items-center gap-2 px-3 py-1.5"
        style={{ borderBottom: `1px solid ${T.borderColor}20` }}
      >
        <button
          type="button"
          onClick={() => setTab("canvas")}
          className={`text-[10px] font-bold uppercase tracking-wider ${
            tab === "canvas" ? "text-white" : "text-white/40"
          }`}
        >
          Canvas
        </button>
        <button
          type="button"
          onClick={() => setTab("terminal")}
          className={`text-[10px] font-bold uppercase tracking-wider ${
            tab === "terminal" ? "text-white" : "text-white/40"
          }`}
        >
          Terminal
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-[10px] text-white/40 hover:text-white/70"
          aria-label={open ? "Collapse drawer" : "Expand drawer"}
        >
          {open ? "▼" : "▲"}
        </button>
      </div>
      {open && (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {tab === "canvas" ? (
            <CanvasTab
              checkpoints={checkpoints}
              status={checkpointsStatus}
            />
          ) : (
            <EmptyState
              title="Terminal"
              body="Terminal execution with recorded exit codes arrives in Phase 3. The existing /api/litt/command route will be wrapped as a structured workspace tool."
            />
          )}
        </div>
      )}
    </div>
  );
}

function CanvasTab({
  checkpoints,
  status,
}: {
  checkpoints: { id: string; label: string; createdAt: string }[];
  status: "idle" | "loading" | "ready" | "error";
}) {
  if (status === "loading") return <LoadingState label="Loading checkpoints…" />;
  if (status === "error") return <ErrorState message="Failed to load checkpoints" />;
  if (checkpoints.length === 0)
    return (
      <EmptyState
        title="No checkpoints"
        body="Checkpoints created before risky changes will appear here. Phase 4 wires checkpoint creation into the run flow."
      />
    );
  return (
    <ul className="space-y-1">
      {checkpoints.map((c) => (
        <li
          key={c.id}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1"
        >
          <p className="text-[11px] text-white/70">{c.label}</p>
          <p className="text-[9px] text-white/40">
            {new Date(c.createdAt).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}
