import { useEffect, useRef, useState } from "react";
import {
  deriveWorktabBadge,
  useExecutionStore,
  type ExecutionPhase,
  type WorktabBadge,
  type WorktabBadgeSnapshot,
} from "../stores/useExecutionStore";
import type { ActionRunDisplayState } from "../components/ActionRunStatusPanel";
import type { Worktab } from "../hooks/useServerWorktabs";

/* ── F1: per-worktab status badges ────────────────────────────────────
   Badges derive ONLY from machine evidence:
   1. the execution store's per-task phase (SSE-fed, real states), and
   2. the server action-run projection polled per conversation.
   Never optimistic: "ready" requires execution phase "done" AND the
   action-run projection "completed"; anything unknown is "idle".

   Polling is bounded: projections fetch once per conversation and
   re-poll on a 20s interval ONLY while at least one tab has live work.
   Liveness keys off the CANONICAL PROJECTION as well as the local phase
   (R4/E3-S3): after a reload the in-memory store is empty (phase
   "idle"), and keying liveness to it alone cleared the interval at its
   first tick — the tab froze on the mount fetch's state while the
   server run settled terminal a minute later.
*/

/** Projection states in which the run is over — polling may stop. */
const TERMINAL_DISPLAY_STATES: ReadonlySet<ActionRunDisplayState> = new Set([
  "completed",
  "failed",
  "stopped",
]);

const LIVE_PHASES: ReadonlySet<ExecutionPhase> = new Set([
  "planning",
  "researching",
  "creating",
  "inspecting",
  "editing",
  "browsing",
  "running",
  "testing",
  "verifying",
  "deploying",
  "awaiting_input",
  "awaiting_approval",
]);

async function fetchDisplayState(
  conversationId: string,
): Promise<ActionRunDisplayState | null> {
  try {
    const response = await fetch(
      `/api/studio/conversations/${encodeURIComponent(conversationId)}/action-run`,
      { cache: "no-store", credentials: "include" },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      projection?: { displayState?: ActionRunDisplayState } | null;
    };
    return body.projection?.displayState ?? null;
  } catch {
    return null;
  }
}

export function useWorktabBadges(tabs: Worktab[]): Record<string, WorktabBadge> {
  // Subscribe to the per-task phase mirror so SSE events re-render badges.
  const taskPhases = useExecutionStore((s) => s.taskPhases);
  const [projections, setProjections] = useState<
    Record<string, ActionRunDisplayState | null>
  >({});
  // The interval reads the LATEST projections through a ref — the state
  // variable captured by the effect closure goes stale after the first
  // load (R4).
  const projectionsRef = useRef<Record<string, ActionRunDisplayState | null>>({});
  useEffect(() => {
    projectionsRef.current = projections;
  }, [projections]);

  const convIds = tabs.map((t) => t.conversationId).filter(Boolean).join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = tabs
      .map((t) => t.conversationId)
      .filter((id): id is string => !!id);
    if (ids.length === 0) {
      setProjections({});
      return;
    }
    const load = async () => {
      const entries = await Promise.all(
        ids.map(async (id) => [id, await fetchDisplayState(id)] as const),
      );
      if (!cancelled) {
        setProjections((prev) => {
          const next = { ...prev };
          for (const [id, state] of entries) next[id] = state;
          return next;
        });
      }
    };
    void load();

    // Keep polling while some tab has live or unconfirmed work — where
    // "live" includes a NON-TERMINAL canonical projection, so a tab
    // whose local store was emptied by a reload still follows its run
    // to its terminal badge (R4/E3-S3).
    const interval = setInterval(() => {
      const st = useExecutionStore.getState();
      const live = tabs.some((t) => {
        const phase = st.phaseForTask(t.id);
        if (LIVE_PHASES.has(phase)) return true;
        const proj = t.conversationId
          ? (projectionsRef.current[t.conversationId] ?? null)
          : null;
        if (proj !== null && !TERMINAL_DISPLAY_STATES.has(proj)) return true;
        if (phase === "done") return proj !== "completed";
        return false;
      });
      if (live) void load();
      else clearInterval(interval);
    }, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convIds]);

  const snapshots: Record<string, WorktabBadgeSnapshot | undefined> = {};
  for (const tab of tabs) {
    snapshots[tab.id] = {
      executionPhase: taskPhases[tab.id] ?? "idle",
      actionRunDisplayState: tab.conversationId
        ? (projections[tab.conversationId] ?? null)
        : null,
    };
  }
  const badges: Record<string, WorktabBadge> = {};
  for (const tab of tabs) badges[tab.id] = deriveWorktabBadge(tab.id, snapshots);
  return badges;
}
