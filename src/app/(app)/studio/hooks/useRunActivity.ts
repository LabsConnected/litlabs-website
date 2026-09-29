"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import type { ActionEvent } from "@/lib/action-runtime/types";

/**
 * useRunActivity — read the persisted run events (action_events) for one
 * ActionRun. This is the Activity truth: the events the agent loop wrote
 * to the durable run log while working. localStorage (useActivityStore) is
 * a write-through cache only and is never read here.
 */
export function useRunActivity(runId: string | null, busy: boolean) {
  const { getToken } = useClerkAuth();
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const wasBusyRef = useRef(false);
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
      const data = (await res.json()) as { events?: ActionEvent[] };
      if (Array.isArray(data.events)) {
        setEvents(data.events);
        setState("ready");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }, [runId]);

  useEffect(() => {
    setEvents([]);
    setState(runId ? "loading" : "idle");
    wasBusyRef.current = false;
    if (!runId) return;
    let cancelled = false;
    void load();
    // While the run is live, poll so the feed grows as events persist.
    const timer = busy ? setInterval(() => { if (!cancelled) void load(); }, 2500) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [runId, busy, load]);

  // The loop persists events asynchronously — a run can finish a beat
  // before its last events land. Take one trailing fetch after the run
  // ends so the feed reflects them.
  useEffect(() => {
    if (wasBusyRef.current && !busy && runId) {
      const timer = setTimeout(() => { void load(); }, 3000);
      wasBusyRef.current = false;
      return () => clearTimeout(timer);
    }
    wasBusyRef.current = busy;
    return undefined;
  }, [busy, runId, load]);

  return { events, state };
}
