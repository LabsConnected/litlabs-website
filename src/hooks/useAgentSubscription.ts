"use client";

import { useEffect, useState, useCallback } from "react";

interface TaskItem {
  id: string;
  session_id: string;
  assigned_to: string;
  dispatcher: string;
  status: "queued" | "processing" | "success" | "failed";
  sequence_order: number;
  task_input: Record<string, unknown>;
  task_output: Record<string, unknown>;
}

/**
 * Subscribe to agent tasks for a given orchestration session.
 *
 * This hook polls the authenticated /api/agent-tasks/[sessionId] endpoint
 * instead of accessing Supabase directly from the browser. The server
 * endpoint uses Clerk identity → service-role Supabase, keeping all
 * database access server-side.
 *
 * Polls every 2 seconds while the session has active (queued/processing) tasks.
 * Stops polling when all tasks are terminal (success/failed) or after 5 minutes.
 */
export function useAgentSubscription(sessionId: string) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  const fetchTasks = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/agent-tasks/${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.tasks) setTasks(data.tasks as TaskItem[]);
    } catch {
      // Network error — keep existing state, will retry on next poll
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    const startTime = Date.now();
    const MAX_DURATION = 5 * 60 * 1000; // 5 minutes

    // Initial fetch
    fetchTasks();

    // Poll every 2 seconds
    interval = setInterval(() => {
      // Stop after max duration
      if (Date.now() - startTime > MAX_DURATION) {
        if (interval) clearInterval(interval);
        return;
      }
      fetchTasks();
    }, 2000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [sessionId, fetchTasks]);

  return tasks;
}
