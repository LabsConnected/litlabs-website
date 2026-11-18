"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import type { ActionEvent, ActionRun } from "@/lib/action-runtime/types";

/**
 * Terminal ActionRun row statuses — mirrors isTerminalActionRunStatus in
 * src/lib/action-runtime/state-machine.ts. The projection's displayState
 * is terminal for exactly these row statuses (completed / failed /
 * stopped-from-cancelled) and active for every other, so "the run row is
 * non-terminal" is the same liveness condition ActionRunStatusPanel
 * polls on — readable from the row this hook already fetches, with no
 * second endpoint.
 */
const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

/**
 * useRunActivity — read the persisted run events (action_events) for one
 * ActionRun. This is the Activity truth: the events the agent loop wrote
 * to the durable run log while working. localStorage (useActivityStore) is
 * a write-through cache only and is never read here.
 *
 * Polling follows the RUN, not the chat turn. A run parked at an approval
 * gate (its turn ended as awaiting_approval) or resumed detached
 * server-side after an approval keeps persisting events while
 * conversation.busy is false — polling only on busy froze the feed for
 * exactly those windows while the status panel (polling on the
 * projection's active displayState) kept tracking the runtime.
 */
export function useRunActivity(runId: string | null, busy: boolean) {
  const { getToken } = useClerkAuth();
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [run, setRun] = useState<ActionRun | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const wasLiveRef = useRef(false);
  // getToken rides a ref so the fetch effect below re-fires only on
  // runId/busy changes — never on an unstable getToken identity.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  });

  const load = useCallback(async () => {
    if (!runId) return;
    try {
      const token = await getTokenRef.current?.();
      const res = await fetch(`/api/action-runs/${encodeURIComponent(runId)}`, {
        cache: "no-store",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      const data = (await res.json()) as { events?: ActionEvent[]; run?: ActionRun | null };
      if (Array.isArray(data.events)) {
        setEvents(data.events);
        if (data.run && typeof data.run === "object") setRun(data.run);
        setState("ready");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }, [runId]);

  // Live while the chat turn is running OR the run row is non-terminal —
  // the parked-gate and detached-resume windows are busy=false but the
  // run is still producing events.
  const runLive = run !== null && !TERMINAL_RUN_STATUSES.has(run.status);
  const live = busy || runLive;

  // Reset + first fetch when the selected run changes.
  useEffect(() => {
    setEvents([]);
    setRun(null);
    setState(runId ? "loading" : "idle");
    wasLiveRef.current = false;
    if (!runId) return;
    void load();
  }, [runId, load]);

  // While the run is live, poll so the feed grows as events persist.
  useEffect(() => {
    if (!runId || !live) return;
    const timer = setInterval(() => { void load(); }, 2500);
    return () => clearInterval(timer);
  }, [runId, live, load]);

  // The loop persists events asynchronously — a run can finish a beat
  // before its last events land. Take one trailing fetch after liveness
  // ends so the feed reflects them.
  useEffect(() => {
    if (wasLiveRef.current && !live && runId) {
      const timer = setTimeout(() => { void load(); }, 3000);
      wasLiveRef.current = false;
      return () => clearTimeout(timer);
    }
    wasLiveRef.current = live;
    return undefined;
  }, [live, runId, load]);

  return { events, state, run };
}
