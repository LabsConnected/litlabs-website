"use client";

import { useEffect, useState } from "react";

interface TaskView {
  title: string;
  status: string;
  conversationId: string | null;
  activeActionRunId: string | null;
  plan: unknown;
}

export function TaskWindowBody({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<TaskView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/studio/tasks/${taskId}`, { credentials: "include" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error || "Task could not be loaded.");
          return;
        }
        setTask(body.task);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Task could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (error) return <p className="p-3 text-[12px] text-red-300">{error}</p>;
  if (!task) return <p className="p-3 text-[12px] text-white/40">Loading task…</p>;
  const steps = Array.isArray(task.plan) ? task.plan.length : 0;
  return (
    <div className="space-y-2 p-3 text-[12px] leading-5 text-white/80">
      <p>Status: {task.status}</p>
      <p>Plan steps: {steps}</p>
      <p>{task.activeActionRunId ? `Run ${task.activeActionRunId}` : "No active run"}</p>
      <p>{task.conversationId ? "Linked to a conversation" : "Not linked to a conversation"}</p>
    </div>
  );
}
