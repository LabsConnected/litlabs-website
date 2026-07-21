"use client";

/**
 * LiTT Base Station — `useAgentActivity` hook.
 *
 * Polls the agent_tasks table for the Base Station's mission-activity feed.
 * Phase 2 added the `completed_at` and `source` columns; this hook reads
 * them and surfaces a sorted, agent-filtered view to the MissionDock UI.
 *
 * Polling at 10s is enough for the human-time Base Station. Phase 5 will
 * switch this to SSE (the `/api/agents/stream` endpoint already exists in
 * the docs; only the route file is missing).
 */

import { useEffect, useRef, useState } from "react";
import type { Mission } from "./useAgentMission";

const POLL_INTERVAL_MS = 10_000;

export interface UseAgentActivityResult {
  recent: Mission[];
  byAgent: Record<string, Mission[]>;
  totalCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAgentActivity(limit = 50): UseAgentActivityResult {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agent-tasks?limit=${limit}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load activity");
      const data = await res.json();
      if (!aliveRef.current) return;
      setMissions((data.tasks || []) as Mission[]);
      setError(null);
    } catch (err) {
      if (aliveRef.current) {
        setError(err instanceof Error ? err.message : "Could not load activity");
      }
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  const recent = [...missions]
    .sort((a, b) => {
      const at = a.completed_at ?? a.updated_at;
      const bt = b.completed_at ?? b.updated_at;
      return new Date(bt).getTime() - new Date(at).getTime();
    })
    .slice(0, limit);

  const byAgent: Record<string, Mission[]> = {};
  for (const m of recent) {
    const list = byAgent[m.assigned_to] ?? [];
    list.push(m);
    byAgent[m.assigned_to] = list;
  }

  return {
    recent,
    byAgent,
    totalCount: missions.length,
    loading,
    error,
    refresh,
  };
}
