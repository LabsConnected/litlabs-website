"use client";

/**
 * LiTT Base Station — `useAgentMission` hook.
 *
 * The single source of truth for queuing and submitting missions. Replaces
 * the previous ad-hoc fetch in `AgentsPageClient.tsx` so the Base Station,
 * the Studio launcher, and any other surface can all call the same hook.
 *
 * Phase 4 baseline. Phase 5 will add optimistic local state and an SSE
 * subscription that updates the mission log live as the task moves from
 * `queued` → `processing` → `success` / `failed`.
 */

import { useCallback, useState } from "react";

export type MissionStatus = "queued" | "processing" | "success" | "failed" | "cancelled";

export interface Mission {
  id: string;
  session_id: string;
  assigned_to: string;
  dispatcher: string;
  task_input: { prompt?: string; context?: Record<string, unknown>; agentSlug?: string };
  task_output?: { text?: string; critical_fault?: string };
  status: MissionStatus;
  created_at: string;
  updated_at: string;
  source?: string | null;
  completed_at?: string | null;
}

export type AgentSlug = "litt" | "spark" | "director" | "auto";

export interface SubmitOptions {
  agent: AgentSlug;
  prompt: string;
  source?: string;
  context?: Record<string, unknown>;
}

export interface UseAgentMissionResult {
  missions: Mission[];
  activeMissions: Mission[];
  completedCount: number;
  loading: boolean;
  error: string | null;
  submit: (opts: SubmitOptions) => Promise<Mission | null>;
  refresh: () => Promise<void>;
}

interface UseAgentMissionOptions {
  initialMissions?: Mission[];
  installedCount?: number;
}

export function useAgentMission(
  options: UseAgentMissionOptions = {},
): UseAgentMissionResult {
  const { initialMissions = [], installedCount = 0 } = options;
  const [missions, setMissions] = useState<Mission[]>(initialMissions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agent-tasks", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load missions");
      const data = await res.json();
      setMissions(data.tasks || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load missions");
    } finally {
      setLoading(false);
    }
  }, []);

  const submit = useCallback(
    async (opts: SubmitOptions): Promise<Mission | null> => {
      const prompt = opts.prompt.trim();
      if (prompt.length < 4) {
        setError("Mission prompt must be at least 4 characters.");
        return null;
      }
      const effectiveAgent: AgentSlug = opts.agent === "auto" ? "litt" : opts.agent;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/agent-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: crypto.randomUUID(),
            assignedTo: effectiveAgent,
            dispatcher: "user",
            taskInput: {
              prompt,
              context: { ...(opts.context ?? {}), source: opts.source ?? "agents-page" },
              agentSlug: effectiveAgent,
            },
            meta: { source: opts.source ?? "agents-page" },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Mission could not be queued");
        }
        // Optimistic append; the next refresh() will reconcile.
        if (data.task) {
          setMissions((prev) => [data.task, ...prev]);
        } else {
          await refresh();
        }
        return data.task ?? null;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Mission could not be queued");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [refresh],
  );

  const activeMissions = missions.filter(
    (m) => m.status === "queued" || m.status === "processing",
  );
  const completedCount = missions.filter((m) => m.status === "success").length;

  return {
    missions,
    activeMissions,
    completedCount: completedCount + installedCount,
    loading,
    error,
    submit,
    refresh,
  };
}
