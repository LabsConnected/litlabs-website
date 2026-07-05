"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

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

export function useAgentSubscription(sessionId: string) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  useEffect(() => {
    if (!sessionId || !supabase) return;

    // 1. Fetch initial pipeline snapshot
    supabase
      .from("agent_tasks")
      .select("*")
      .eq("session_id", sessionId)
      .order("sequence_order", { ascending: true })
      .then(({ data }) => {
        if (data) setTasks(data as TaskItem[]);
      });

    // 2. Open live listening channel for orchestration state mutations
    const pipelineChannel = supabase
      .channel(`active-pipeline:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_tasks",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          setTasks((prev) => {
            const index = prev.findIndex(
              (t) => t.id === (payload.new as TaskItem).id,
            );

            // If the row exists, update it; otherwise, append a new task entry
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = payload.new as TaskItem;
              return updated;
            }

            return [...prev, payload.new as TaskItem].sort(
              (a, b) => a.sequence_order - b.sequence_order,
            );
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(pipelineChannel);
    };
  }, [sessionId]);

  return tasks;
}
